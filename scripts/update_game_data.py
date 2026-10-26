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

    def base_art(sid):
        """기본·통찰 스킨 그림: 예전부터 있던 카드형(328×460) 그림만 쓴다.
        중국 서버 자료의 store/skin(이벤트 포스터)·characterskin(전신 스프라이트)은 카드에 맞지 않아서
        새로 만들지 않고, 그렇게 만들어진 파일이 있으면 지운다 → 사이트는 대표 이미지(char/)를 쓴다."""
        dest = os.path.join(a.out, "assets", "img", "skin", f"{sid}.webp")
        if not os.path.exists(dest):
            return None
        if Image is None:
            return f"assets/img/skin/{sid}.webp"
        try:
            with Image.open(dest) as im:
                w, h = im.size
        except Exception:
            w, h = 0, 0
        if w and w <= 340 and 1.3 <= h / w <= 1.6:
            return f"assets/img/skin/{sid}.webp"
        try:
            os.remove(dest)
            print(f"  · 카드에 맞지 않는 기본/통찰 그림 지움: skin/{sid}.webp ({w}×{h})")
        except OSError:
            pass
        return None

    def skin_images(sid, base=False):
        if base:
            portrait = imgs.put([
                os.path.join(avatar_dir, f"{sid}.webp"),
                os.path.join(CN, "headicon_middle", f"{sid}.png"),
                os.path.join(CN, "headskinicon_middle", f"{sid}.png"),
                os.path.join(CN, "headicon_small", f"{sid}.png"),
            ], f"char/{sid}.webp", max_w=360)
            return portrait, base_art(sid)
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
            t = acquire_type(s)
            portrait, art = skin_images(s["id"], base=t in ("default", "insight"))
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
            portrait, art = skin_images(sid, base=s["type"] in ("default", "insight"))
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

    # ── 공명변조·광상 (이미지 포함) ──────────────────────────
    print("· 공명변조·광상 정리 중")
    attach_tunings_euphorias(characters, G, CN, a.kornblume, kb_chars, tr, imgs, load_json)
    attach_versions(characters, G, load_json)
    enrich_skins(skins_out, characters, G, tr, load_json)
    apply_simulator(characters, skins_out, os.path.join(a.out, "data", "raw", "simulator.json"), load_json, imgs, CN)
    apply_collabs(characters, skins_out)

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
        item = {"id": e["id"], "name": nm, "rarity": e["rare"] + 1, "icon": icon,
                "skill": tr(e.get("skillName")) or ""}
        if e.get("isSpRefine"):  # 도철·탐욕: 증폭 재료 (개수로 센다)
            item["refine"] = True
        psychubes.append(item)
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
            "frequency": kb.get("Frequency", []),
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
            # 6자리 활동 번호는 콜라보 기간 시즌 (1305xx = S01 어쌔신 크리드, 1385xx = S02 아토믹 하트)
            ver = {"1305": "S01", "1385": "S02"}.get(s[:4]) if len(s) >= 6 else None
            seasons[aid] = {"id": aid, "version": ver or f"{s[1]}.{s[2]}", "bosses": []}
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


def attach_tunings_euphorias(characters, G, CN, kb_root, kb_chars, tr, imgs, load_json):
    """캐릭터마다 공명변조(tunings)와 광상(euphorias) 목록을 이미지와 함께 붙인다.
    공명변조: kornblume Frequency(Type, Id=게임 tagicon) + 게임 talent_style 이름
    광상: 게임 character_destiny + facets_consume 이름, 이미지는 kornblume 또는 CN 에셋"""
    gj = lambda n: load_json(os.path.join(G, "json", f"{n}.json"))
    try:
        styles = gj("talent_style")
        hero_mould = {t["heroId"]: t["talentMould"] for t in gj("character_talent")}
    except FileNotFoundError:
        styles, hero_mould = [], {}
    style_name = {}   # (mould, tagicon) -> 이름
    any_name = {}     # tagicon -> 이름
    for st in styles:
        nm = tr(st["name"]) or ""
        style_name[(st["talentMould"], str(st["tagicon"]))] = nm
        any_name.setdefault(str(st["tagicon"]), nm)
    default_name = next((tr(st["name"]) for st in styles if st["styleId"] == 0), "평화")
    try:
        facet_name = {f["facetsId"]: tr(f["name"]) or "" for f in gj("character_destiny_facets_consume")}
        destiny = {d["heroId"]: [int(x) for x in str(d["facetsId"]).split("#") if x] for d in gj("character_destiny")}
    except FileNotFoundError:
        facet_name, destiny = {}, {}
    freq_dir = os.path.join(kb_root, "public", "images", "arcanists", "misc", "frequency")
    eu_dir = os.path.join(kb_root, "public", "images", "arcanists", "euphoria")

    for c in characters:
        kb = kb_chars.get(c.get("kb")) if c.get("kb") else None
        mould = hero_mould.get(c["id"])
        tunings = []
        freqs = (kb or {}).get("Frequency") or []
        if freqs:
            ftype = freqs[0].get("Type") or ""
            icon0 = imgs.put([os.path.join(freq_dir, f"{ftype}_0.webp")], f"tuning/{ftype}_0.webp", max_w=160)
            tunings.append({"id": 0, "name": default_name, "icon": icon0})
            for f in freqs:
                fid = f["Id"]
                ft = f.get("Type") or ftype
                name = style_name.get((mould, str(fid))) or any_name.get(str(fid)) or f"변조 {fid}"
                icon = imgs.put([os.path.join(freq_dir, f"{ft}_{fid}.webp")], f"tuning/{ft}_{fid}.webp", max_w=160)
                tunings.append({"id": fid, "name": name, "icon": icon})
        c["tunings"] = tunings
        euph = []
        for i, fid in enumerate(destiny.get(c["id"], []), start=1):
            srcs = []
            if kb and kb.get("Id"):
                srcs.append(os.path.join(eu_dir, f"{kb['Id']}_{i}.webp"))
            srcs.append(os.path.join(CN, "characterdestiny", "stone", f"{fid}.png"))
            icon = imgs.put(srcs, f"euphoria/{fid}.webp", max_w=200)
            euph.append({"id": i, "facetsId": fid, "name": facet_name.get(fid, ""), "icon": icon})
        if not euph and kb and kb.get("Euphoria"):  # 글로벌 데이터에 없는 신규 캐릭터
            for e in kb["Euphoria"]:
                i = e["Id"]
                icon = imgs.put([os.path.join(eu_dir, f"{kb['Id']}_{i}.webp")], f"euphoria/{c['id']}{i:02d}.webp", max_w=200)
                euph.append({"id": i, "facetsId": None, "name": "", "icon": icon})
        c["euphorias"] = euph
        if euph:
            c["euphoria"] = len(euph)


def _ver_from_id(n):
    """이벤트(활동) id로 버전 읽기: 12006 → 2.0, 13115 → 3.1 (10xxx 같은 초기 id는 알 수 없음)"""
    s = str(n)
    if len(s) >= 5 and s[0] == "1" and s[1] in "123456789" and s[2].isdigit():
        return f"{s[1]}.{s[2]}"
    return None


def _ver_from_pool(n):
    """모집 배너 id로 버전 읽기: 10121 → 1.0, 31111 → 3.1"""
    s = str(n)
    if len(s) == 5 and s[0] in "123456789":
        return f"{s[0]}.{s[1]}"
    return None


def _vkey(v):
    a, b = v.split(".")
    return (int(a), int(b))


def attach_versions(characters, G, load_json):
    """출품작 출시 버전: 처음 픽업된 모집 배너의 버전.
    배너에 없던 출품작(상시·무료 등)은 'ID가 더 큰 출품작 중 가장 이른 버전'으로 추정한다."""
    try:
        pools = load_json(os.path.join(G, "json", "summon_pool.json"))
    except FileNotFoundError:
        return
    ids = {c["id"] for c in characters}
    first = {}
    for pl in sorted(pools, key=lambda x: x["id"]):
        v = _ver_from_pool(pl["id"])
        if not v:
            continue
        for x in str(pl.get("upWeight") or "").replace("#", "|").split("|"):
            if x.isdigit() and int(x) in ids and int(x) not in first:
                first[int(x)] = v
    # 픽업 배너가 있으면 그 버전, 없으면 ID가 가장 가까운 앞쪽 출품작의 버전으로 추정
    known = sorted((c["id"], first[c["id"]]) for c in characters if c["id"] in first)
    for c in characters:
        if c["id"] in first:
            c["version"], c["versionEstimated"] = first[c["id"]], False
        else:
            prev = [v for i, v in known if i < c["id"]]
            c["version"] = prev[-1] if prev else (known[0][1] if known else None)
            c["versionEstimated"] = True


SKIN_GROUPS = {  # 스킨 도감 대분류 → 사이트 분류
    11001: "tarot", 12001: "collab", 10008: "dushuo", 13001: "anniv",
}


def enrich_skins(skins_out, characters, G, tr, load_json):
    """스킨 분류(타로카드·콜라보·도삭절·세월의 책갈피·테마 시리즈·이벤트·상점), 등급, 시리즈, 버전(알 수 있는 것만)"""
    gj = lambda n: load_json(os.path.join(G, "json", f"{n}.json"))
    try:
        high = {h["id"]: h for h in gj("handbook_skin_high")}
        low = gj("handbook_skin_low")
    except FileNotFoundError:
        high, low = {}, []
    series = {}
    for l in low:
        for x in str(l.get("skinContain") or "").split("|"):
            if x.isdigit():
                series[int(x)] = (l["highId"], tr(l["name"]) or "", tr(high.get(l["highId"], {}).get("name", "")) or "")
    try:
        g_skin = {x["id"]: x for x in gj("skin")}
        goods = gj("store_goods")
    except FileNotFoundError:
        g_skin, goods = {}, []
    linkage, goods_order, goods_ver = set(), {}, {}
    for gd in goods:
        for part in str(gd.get("product") or "").split("|"):
            a = part.split("#")
            if len(a) >= 2 and a[1].isdigit() and int(a[1]) in g_skin:
                sid = int(a[1])
                if gd.get("islinkageSkin"):
                    linkage.add(sid)
                goods_order[sid] = min(goods_order.get(sid, 10**9), gd["id"] if len(str(gd["id"])) == 6 else 10**8)
                gs = str(gd["id"])
                if len(gs) == 7 and gs[3].isdigit() and gs[4].isdigit():  # 5102804 → 2.8
                    goods_ver[sid] = f"{gs[3]}.{gs[4]}"
    char_ver = {c["id"]: c.get("version") for c in characters}
    for s in skins_out:
        g = g_skin.get(s["id"], {})
        hi, sname, hname = series.get(s["id"], (None, "", ""))
        gain = g.get("gainApproach", s.get("gain"))
        if s["type"] in ("default", "insight"):
            cat = s["type"]
        elif s["id"] in linkage or SKIN_GROUPS.get(hi) == "collab":
            cat = "collab"
        elif hi in SKIN_GROUPS:
            cat = SKIN_GROUPS[hi]
        elif isinstance(gain, int) and gain >= 10000:
            cat = "event"
        elif hi:
            cat = "series"
        elif gain == 3:
            cat = "other"
        else:
            cat = "shop"
        s["cat"] = cat
        s["series"] = sname
        s["seriesGroup"] = hname
        s["grade"] = g.get("skinLevel", 0) or 0
        ver = _ver_from_id(gain) if isinstance(gain, int) and gain >= 10000 else None
        ver = ver or goods_ver.get(s["id"])
        if s["type"] in ("default", "insight"):
            ver = char_ver.get(s["char"])
        s["version"] = ver
        s["order"] = goods_order.get(s["id"])


def apply_simulator(characters, skins_out, path, load_json, imgs=None, CN=None):
    """reverse1999-simulator.com 에서 정리한 자료(data/raw/simulator.json)가 있으면
    한섭 기준 출시 버전·역할, 스킨 버전·등급(Garment/Advanced/Unique)·획득처·타로 번호를 덮어쓴다."""
    if not os.path.exists(path):
        return
    sim = load_json(path)
    clean = lambda t: re.sub(r"[\s'‘’\"“”·.,!?~\-<>]", "", t or "")
    by_name = {clean(c["name"]["ko"]): c for c in characters}
    for x in sim.get("characters", []):
        c = by_name.get(clean(x["name"]))
        if not c:
            continue
        c["version"] = x.get("version") or c.get("version")
        c["versionEstimated"] = False
        c["released"] = True
        c["role"] = x.get("role")
        if not re.search("[가-힣]", c["name"].get("ko") or ""):
            c["name"]["ko"] = x["name"]
    char_by_id = {c["id"]: c for c in characters}
    idx = {}
    for s in skins_out:
        ch = char_by_id.get(s["char"])
        if ch:
            key = (clean(ch["name"]["ko"]), "insight" if s["type"] == "insight" else clean(s["name"]))
            idx[key] = s
    grade_order = {"Garment": 1, "Advanced Garment": 2, "Unique": 3}
    known_ids = {s["id"] for s in skins_out}
    cn_cache = {}

    def cn_candidates(cid):
        """CN 에셋에 있지만 아직 목록에 없는 그 출품작의 스킨 번호"""
        if cid in cn_cache:
            return cn_cache[cid]
        found = set()
        for d in ("store/skin", "characterskin", "headicon_middle"):
            full = os.path.join(CN or "", d)
            if CN and os.path.isdir(full):
                for f in os.listdir(full):
                    if f[:6].isdigit() and int(f[:6]) // 100 == cid and int(f[:6]) not in known_ids:
                        found.add(int(f[:6]))
        cn_cache[cid] = sorted(found)
        return cn_cache[cid]

    for x in sorted(sim.get("skins", []), key=lambda x: x.get("id", 0)):
        key = (clean(x["character"]), "insight" if x.get("type") == "Insight" else clean(x["name"]))
        s = idx.get(key)
        if not s and x.get("type") != "Insight":
            ch = by_name.get(clean(x["character"]))
            if ch:
                # 1) 이름이 한국어가 아닌(중국어 등) 기존 스킨이 있으면 그 스킨으로 본다
                cand = [k for k in skins_out if k["char"] == ch["id"] and k["type"] not in ("default", "insight")
                        and not k.get("gradeName") and (not re.search("[가-힣]", k["name"] or "") or k["name"] == ch["name"]["ko"])]
                if cand:
                    s = cand[0]
                    s["name"] = x["name"]
                # 2) 없으면 CN 에셋에서 아직 안 쓴 스킨 그림을 찾아 새로 만든다 (한섭 선행 스킨)
                elif imgs is not None and cn_candidates(ch["id"]):
                    sid = cn_candidates(ch["id"]).pop(0)
                    known_ids.add(sid)
                    portrait = imgs.put([os.path.join(CN, "headicon_middle", f"{sid}.png"),
                                         os.path.join(CN, "headskinicon_middle", f"{sid}.png")], f"char/{sid}.webp", max_w=360)
                    art = imgs.put([os.path.join(CN, "store", "skin", f"{sid}.png"),
                                    os.path.join(CN, "characterskin", f"{sid}.png")], f"skin/{sid}.webp", max_w=640)
                    s = {"id": sid, "char": ch["id"], "type": "shop", "name": x["name"], "nameEn": "", "rare": 0, "gain": None,
                         "portrait": portrait or art, "art": art, "cat": "shop", "series": "", "seriesGroup": "", "grade": 0,
                         "version": None, "order": None}
                    skins_out.append(s)
                    ch.setdefault("skins", []).append(sid)
        if not s:
            continue
        s["version"] = x.get("version") or s.get("version")
        s["source"] = x.get("source")
        if x.get("type") in grade_order:
            s["gradeName"] = x["type"]
            s["grade"] = grade_order[x["type"]]
        if x.get("tarot") is not None:
            s["tarot"] = x["tarot"]
            s["cat"] = "tarot"
        elif "콜라보" in (x.get("source") or ""):
            s["cat"] = "collab"


# 콜라보 버전: 시뮬레이터에는 '콜라보'로만 적혀 있어서 위키(버전별 의상·출시 버전) 기준으로 나눈다.
# S01 = 2.7과 2.8 사이(2025.08.07~09.19), S02 = 3.6과 3.7 사이(2026.07.23~)
COLLABS = {
    "S01": {"name": "어쌔신 크리드", "chars": {"에지오 아디토레", "카산드라", "알렉시오스"},
            "series": {"올림포스를 나는 독수리처럼"}, "skins": {305104}},
    "S02": {"name": "아토믹 하트", "chars": {"쌍둥이", "노라"},
            "series": {"조립식 미래"}, "skins": {307705, 312606}},
}


def apply_collabs(characters, skins_out):
    char_ver = {}
    for c in characters:
        for v, info in COLLABS.items():
            if c["name"]["ko"] in info["chars"]:
                c["version"] = v
                c["collab"] = info["name"]
                c["versionEstimated"] = False
                char_ver[c["id"]] = v
    for s in skins_out:
        v = None
        if s.get("version") in (None, "콜라보") or s["char"] in char_ver:
            for key, info in COLLABS.items():
                if s["id"] in info["skins"] or (s.get("series") in info["series"]):
                    v = key
            if not v and s["char"] in char_ver:
                v = char_ver[s["char"]]
        if v:
            s["version"] = v
            s["collab"] = COLLABS[v]["name"]


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
