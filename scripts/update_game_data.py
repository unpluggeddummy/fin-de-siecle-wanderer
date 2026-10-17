#!/usr/bin/env python3
"""
리버스 1999 기록 사이트 — 게임 데이터 갱신 스크립트

공식 글로벌 클라이언트 데이터, CN 클라이언트 에셋, kornblume, r1999-roster를 합쳐
data/game/*.json 과 assets/img/** 이미지를 만든다.

  python scripts/update_game_data.py \
      --global  <re1999-data-global 경로> \
      --cn      <Reverse-1999-CN-Asset 경로> \
      --kornblume <kornblume 경로> \
      --roster  <r1999-roster 경로> \
      --out     .

깃허브 액션(.github/workflows/update-game-data.yml)이 이 스크립트를 실행한다.
사용자 기록(data/user/*.json)은 절대 건드리지 않는다.
"""
import argparse
import difflib
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone

try:
    from PIL import Image
except ImportError:  # 이미지 변환 없이 데이터만 갱신할 수 있게
    Image = None

AFFLATUS = {1: "mineral", 2: "star", 3: "plant", 4: "beast", 5: "spirit", 6: "intellect", 101: "mineral-star"}
KB_AFFLATUS = {"Mineral": "mineral", "Star": "star", "Plant": "plant", "Beast": "beast",
               "Spirit": "spirit", "Intellect": "intellect", "Mineral & star": "mineral-star"}
LANGS = {"ko": "kr", "en": "en", "ja": "jp", "zhCN": "zh", "zhTW": "tw"}


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, path)


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


class Images:
    """원본 PNG/WEBP를 받아 webp로 변환해 저장한다. 이미 있으면 건너뛴다."""

    def __init__(self, out_dir, enabled=True, force=False):
        self.out = out_dir
        self.enabled = enabled and Image is not None
        self.force = force
        self.written = 0

    def put(self, sources, rel, max_w=None, quality=82):
        """sources 중 처음 존재하는 파일을 rel(assets/img 기준)로 저장. 저장 경로(사이트 기준) 반환."""
        dest = os.path.join(self.out, "assets", "img", rel)
        site_path = "assets/img/" + rel
        if os.path.exists(dest) and not self.force:
            return site_path
        if not self.enabled:
            return None
        for src in sources:
            if src and os.path.exists(src):
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                try:
                    im = Image.open(src)
                    im.load()
                    if im.mode not in ("RGB", "RGBA"):
                        im = im.convert("RGBA")
                    if max_w and im.width > max_w:
                        h = round(im.height * max_w / im.width)
                        im = im.resize((max_w, h), Image.LANCZOS)
                    im.save(dest, "WEBP", quality=quality, method=5)
                    self.written += 1
                    return site_path
                except Exception as e:  # 손상된 파일은 무시
                    print(f"  ! 이미지 변환 실패 {src}: {e}", file=sys.stderr)
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--global", dest="glob", required=True)
    ap.add_argument("--cn", required=True)
    ap.add_argument("--kornblume", required=True)
    ap.add_argument("--roster", required=True)
    ap.add_argument("--out", default=".")
    ap.add_argument("--no-images", action="store_true")
    ap.add_argument("--force-images", action="store_true")
    a = ap.parse_args()

    G = os.path.join(a.glob, "data")
    CN = os.path.join(a.cn, "singlebg")
    imgs = Images(a.out, enabled=not a.no_images, force=a.force_images)

    print("· 언어 테이블 읽는 중")
    lang = {}
    for code, suffix in LANGS.items():
        p = os.path.join(G, "configs", "language", f"language_{suffix}.json")
        lang[code] = {x["key"]: x["content"] for x in load_json(p)} if os.path.exists(p) else {}

    def tr(key, code="ko"):
        if not isinstance(key, str) or not key.startswith("language_"):
            return key
        return lang[code].get(key) or None

    def names_of(key):
        return {c: (tr(key, c) or "").strip() for c in LANGS}

    gj = lambda n: load_json(os.path.join(G, "json", f"{n}.json"))
    g_chars = gj("character")
    g_skins = gj("skin")
    g_equips = gj("equip")
    g_items = gj("item")
    g_currency = gj("currency")
    g_destiny = gj("character_destiny")
    g_bulletin = gj("activity128_stage")

    kb_chars = {c["Name"]: c for c in load_json(os.path.join(a.kornblume, "public", "data", "arcanists.json"))}
    kb_items = load_json(os.path.join(a.kornblume, "public", "data", "items.json"))
    roster = load_json(os.path.join(a.roster, "src", "data", "characters.json"))
    roster_by_base = {r["baseId"]: r for r in roster}
    avatar_dir = os.path.join(a.roster, "public", "assets", "characters", "avatars")

    # 기존 데이터(수동 보정 이름 등)를 보존하기 위해 읽어 둔다
    old_chars_path = os.path.join(a.out, "data", "game", "characters.json")
    old_chars = {c["id"]: c for c in load_json(old_chars_path)} if os.path.exists(old_chars_path) else {}

    euphoria_count = {d["heroId"]: len(str(d["facetsId"]).split("#")) for d in g_destiny}

    # ── 스킨 ────────────────────────────────────────────────
    print("· 스킨 정리 중")
    skins_by_char = {}
    for s in g_skins:
        skins_by_char.setdefault(s["characterId"], []).append(s)

    def acquire_type(s):
        g = s["gainApproach"]
        sid = s["id"]
        if sid % 100 == 1 or g == 0:
            return "default"
        if g == 1:
            return "insight"
        if g in (2, 4, 5):
            return "shop"
        if g == 3:
            return "shop-art"
        if g >= 10000:
            return "event"
        return "other"

    def skin_images(sid):
        portrait = imgs.put([
            os.path.join(avatar_dir, f"{sid}.webp"),
            os.path.join(CN, "headicon_middle", f"{sid}.png"),
            os.path.join(CN, "headskinicon_middle", f"{sid}.png"),
            os.path.join(CN, "headicon_small", f"{sid}.png"),
        ], f"char/{sid}.webp", max_w=360)
        art = imgs.put([
            os.path.join(CN, "store", "skin", f"{sid}.png"),
            os.path.join(CN, "characterskin", f"{sid}.png"),
        ], f"skin/{sid}.webp", max_w=640)
        return portrait, art

    # ── 캐릭터 ──────────────────────────────────────────────
    print("· 캐릭터 정리 중")
    characters, skins_out = [], []
    seen = set()

    def kb_lookup(en):
        if en in kb_chars:
            return kb_chars[en]
        n = norm(en)
        for k, v in kb_chars.items():
            if norm(k) == n:
                return v
        return None

    for c in g_chars:
        cid = c["id"]
        if c.get("isOnline") != "1" or cid >= 9000:
            continue
        seen.add(cid)
        nm = names_of(c["name"])
        if not nm["en"]:
            nm["en"] = c.get("nameEng", "")
        r = roster_by_base.get(cid)
        if r:  # 글로벌에 없는 언어는 로스터 이름으로 채운다
            rn = r.get("names", {})
            for code, key in (("zhCN", "zh-CN"), ("zhTW", "zh-TW"), ("ja", "ja-JP")):
                if not nm[code] and rn.get(key):
                    nm[code] = rn[key]
        kb = kb_lookup(nm["en"] or c.get("nameEng", ""))
        char_skins = sorted(skins_by_char.get(cid, []), key=lambda s: s["id"])
        sk_ids = []
        for s in char_skins:
            portrait, art = skin_images(s["id"])
            t = acquire_type(s)
            skin_name = names_of(s["name"])
            skins_out.append({
                "id": s["id"], "char": cid, "type": t,
                "name": skin_name["ko"] or nm["ko"], "nameEn": skin_name["en"] or s.get("nameEng") or "",
                "rare": s.get("rare", 0), "gain": s["gainApproach"],
                "portrait": portrait, "art": art,
            })
            sk_ids.append(s["id"])
        insight_skin = next((s["id"] for s in char_skins if s["gainApproach"] == 1), None)
        characters.append({
            "id": cid,
            "name": nm,
            "rarity": c["rare"] + 1,
            "afflatus": AFFLATUS.get(c["career"], "unknown"),
            "dmg": "reality" if c["dmgType"] == 1 else "mental",
            "released": True,
            "euphoria": euphoria_count.get(cid, len(kb["Euphoria"]) if kb and kb.get("Euphoria") else 0),
            "defaultSkin": c["skinId"],
            "insightSkin": insight_skin,
            "skins": sk_ids,
            "kb": kb["Name"] if kb else None,
            "nameChecked": True,
        })

    # 글로벌 데이터에 아직 없는 캐릭터(신규·중섭 선행)는 로스터 데이터로 보충
    for r in roster:
        cid = r["baseId"]
        if cid in seen or not r.get("enabled", True):
            continue
        rn = r.get("names", {})
        kb = kb_lookup(rn.get("en-US", ""))
        prev = old_chars.get(cid, {})
        ko = (prev.get("name", {}) or {}).get("ko") if prev.get("nameChecked") else None
        nm = {"ko": ko or rn.get("ko-KR") or rn.get("en-US") or r["name"], "en": rn.get("en-US", ""),
              "ja": rn.get("ja-JP", ""), "zhCN": rn.get("zh-CN", r["name"]), "zhTW": rn.get("zh-TW", "")}
        sk_ids = []
        for s in r["skins"]:
            sid = int(s["variantId"])
            portrait, art = skin_images(sid)
            skins_out.append({
                "id": sid, "char": cid, "type": "default" if s["type"] == "default" else ("insight" if s["type"] == "insight" else "shop"),
                "name": nm["ko"] if s["type"] in ("default", "insight") else (s.get("skinName") or ""),
                "nameEn": s.get("skinNameEng") or "", "rare": 0, "gain": None,
                "portrait": portrait, "art": art,
            })
            sk_ids.append(sid)
        characters.append({
            "id": cid, "name": nm,
            "rarity": r.get("rarity") or (kb["Rarity"] if kb else 6),
            "afflatus": KB_AFFLATUS.get(kb["Afflatus"], "unknown") if kb else "unknown",
            "dmg": prev.get("dmg", "unknown"),
            "released": r.get("stage") == "live",
            "euphoria": len(kb["Euphoria"]) if kb and kb.get("Euphoria") else 0,
            "defaultSkin": int(r["defaultVariant"]),
            "insightSkin": next((int(s["variantId"]) for s in r["skins"] if s["type"] == "insight"), None),
            "skins": sk_ids, "kb": kb["Name"] if kb else None,
            "nameChecked": bool(ko or rn.get("ko-KR")),
        })

    characters.sort(key=lambda c: (-c["rarity"], c["name"]["ko"]))

    # ── 의지 ────────────────────────────────────────────────
    print("· 의지 정리 중")
    psychubes = []
    for e in g_equips:
        if e.get("isExpEquip") or e.get("rare", 0) < 2:
            continue
        nm = names_of(e["name"])
        if not nm["ko"] or nm["ko"].strip() in ("0", "?") or "테스트" in nm["ko"] or not nm["en"] or nm["en"].strip() == "0":
            continue
        icon = imgs.put([os.path.join(CN, "equipment", "icon", f"{e['icon']}.png"),
                         os.path.join(CN, "handbook", "equip", f"{e['icon']}.png")],
                        f"psychube/{e['id']}.webp", max_w=240)
        psychubes.append({"id": e["id"], "name": nm, "rarity": e["rare"] + 1, "icon": icon,
                          "skill": tr(e.get("skillName")) or ""})
    psychubes.sort(key=lambda p: (-p["rarity"], -p["id"]))

    # ── 재료(육성 계획용) ──────────────────────────────────
    print("· 재료 정리 중")
    en_index = {}
    for it in g_items:
        n = tr(it["name"], "en")
        if n:
            en_index.setdefault(norm(n), ("item", it))
    for cu in g_currency:
        n = tr(cu["name"], "en")
        if n:
            en_index[norm(n)] = ("currency", cu)
    # 이름이 바뀐 재료 별칭 (kornblume 영문명 → 글로벌 영문명)
    aliases = {"Red Lacquer Tablet": "Red Lacquer Slab"}
    for old, new in aliases.items():
        if norm(new) in en_index:
            en_index[norm(old)] = en_index[norm(new)]
    keys = list(en_index)
    materials = {}
    for k in kb_items:
        n = norm(k["Name"])
        hit = en_index.get(n)
        if not hit:
            close = difflib.get_close_matches(n, keys, n=1, cutoff=0.88)
            hit = en_index.get(close[0]) if close else None
        entry = {"en": k["Name"], "ko": k["Name"], "rarity": k.get("Rarity", 1),
                 "category": k.get("Category", ""), "icon": None}
        if hit:
            kind, obj = hit
            entry["ko"] = tr(obj["name"], "ko") or k["Name"]
            ic = str(obj.get("icon") or obj["id"])
            src = [os.path.join(CN, "currencyitem", f"{ic}.png")] if kind == "currency" else \
                  [os.path.join(CN, "propitem", "prop", f"{ic}.png")]
            entry["icon"] = imgs.put(src, f"item/{norm(k['Name'])}.webp", max_w=128)
        materials[k["Name"]] = entry
    # Dust / Sharpodonty 는 kornblume 아이템 목록에 없을 수도 있어 보강
    for en in ("Dust", "Sharpodonty"):
        if en not in materials:
            kind, obj = en_index.get(norm(en), (None, None))
            materials[en] = {"en": en, "ko": tr(obj["name"]) if obj else en, "rarity": 1, "category": "Base Item",
                             "icon": imgs.put([os.path.join(CN, "currencyitem", f"{obj.get('icon')}.png")] if obj else [],
                                              f"item/{norm(en)}.webp", max_w=128)}

    # kornblume 캐릭터별 육성 재료
    growth = {}
    for c in characters:
        kb = kb_chars.get(c["kb"]) if c["kb"] else None
        if not kb:
            continue
        growth[str(c["id"])] = {
            "insight": kb.get("Insight", []),
            "resonance": kb.get("Resonance", []),
            "euphoria": kb.get("Euphoria", []),
        }
    level_costs = None
    res_path = os.path.join(a.kornblume, "src", "constants", "resources.ts")
    if os.path.exists(res_path):
        level_costs = parse_level_costs(open(res_path, encoding="utf-8").read())

    # ── 갈기의 게시판 ──────────────────────────────────────
    print("· 갈기의 게시판 시즌 정리 중")
    seasons = {}
    order = []
    for st in g_bulletin:
        aid = st["activityId"]
        if aid not in seasons:
            s = str(aid)
            seasons[aid] = {"id": aid, "version": f"{s[1]}.{s[2]}", "bosses": []}
            order.append(aid)
        sprite = st.get("bossRushMainItemBossSprite") or ""
        img = imgs.put([
            os.path.join(CN, "bossrush", "boss", f"{sprite}_01.png"),
            os.path.join(CN, "v1a4_bossrush_bossicon_singlebg", f"{sprite}.png"),
        ], f"boss/{sprite}.webp", max_w=420) if sprite else None
        seasons[aid]["bosses"].append({
            "stage": st["stage"], "type": st["type"],
            "name": tr(st["name"]) or "", "nameEn": st.get("name_en", ""), "image": img,
        })
    bulletin = [seasons[a_] for a_ in order]
    seen_v = {}
    for b in bulletin:  # 같은 버전에 시즌이 둘이면 (2) 를 붙인다
        seen_v[b["version"]] = seen_v.get(b["version"], 0) + 1
        if seen_v[b["version"]] > 1:
            b["version"] += f" ({seen_v[b['version']]})"

    # ── 저장 ────────────────────────────────────────────────
    out = os.path.join(a.out, "data", "game")
    save_json(os.path.join(out, "characters.json"), characters)
    save_json(os.path.join(out, "skins.json"), skins_out)
    save_json(os.path.join(out, "psychubes.json"), psychubes)
    save_json(os.path.join(out, "materials.json"), {"items": materials, "growth": growth, "levels": level_costs})
    save_json(os.path.join(out, "bulletin.json"), bulletin)
    save_json(os.path.join(out, "meta.json"), {
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "counts": {"characters": len(characters), "skins": len(skins_out), "psychubes": len(psychubes),
                   "bulletinSeasons": len(bulletin)},
    })
    print(f"완료: 캐릭터 {len(characters)} · 스킨 {len(skins_out)} · 의지 {len(psychubes)} · "
          f"게시판 시즌 {len(bulletin)} · 새 이미지 {imgs.written}")


def parse_level_costs(ts):
    """kornblume resources.ts 의 levelUpResources 배열을 JSON으로 변환."""
    m = re.search(r"export const levelUpResources\s*=\s*(\[.*?\n\]);", ts, re.S)
    if not m:
        return None
    body = m.group(1)
    body = re.sub(r"//.*", "", body)
    body = re.sub(r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', body)
    body = re.sub(r"([{,]\s*)(\d+)\s*:", r'\1"\2":', body)
    body = re.sub(r",(\s*[}\]])", r"\1", body)
    try:
        return json.loads(body)
    except json.JSONDecodeError as e:
        print(f"  ! 레벨 비용 파싱 실패: {e}", file=sys.stderr)
        return None


if __name__ == "__main__":
    main()
