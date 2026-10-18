#!/usr/bin/env python3
"""리버스 1999 위키(fandom)에서 모은 자료 묶음을 사이트용 데이터로 바꾼다.

  python3 scripts/import_wiki.py --wiki <압축 푼 reverse1999-site-assets 폴더> --global <re1999-data-global> --out .

만드는 것
  data/game/stories.json   스토리 목록(메인·버전 이벤트·캐릭터 스토리·일화) + 배너
  data/game/npcs.json      NPC 목록(필요할 때만 고르는 용도) + 얼굴·전신 그림
  data/raw/wiki/*.json     원본 JSON (나중에 기능을 더할 때 쓰려고 보관)
  assets/img/story/*.webp, assets/img/npc/*.webp

한국어 이름은 위키에 없으면 게임 언어 테이블(영문→한국어)에서 찾는다. 못 찾으면 영문 그대로 둔다.
출처: Reverse: 1999 Wiki (reverse1999.fandom.com, CC BY-SA 3.0)
"""
import argparse
import collections
import json
import os
import re
import shutil

try:
    from PIL import Image
except ImportError:  # 그림 크기 조절 없이 복사만
    Image = None

CAT = {"main": "메인 스토리", "mainevent": "버전 이벤트", "char": "캐릭터 스토리", "anec": "일화"}
# 언어 테이블로 고르기 애매한 것들
TITLE_FIX = {"The Star": "별"}
NPC_FIX = {}
NO_GUESS = {"Facao", "Urd", "Gio", "Vincent", "Prismagreen", "President"}


def norm(t):
    return re.sub(r"[^a-z0-9]", "", (t or "").lower().replace("’", "'"))


def strip_tags(t):
    return re.sub(r"<[^>]+>", "", t or "").strip().strip("<>").strip()


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def en_to_kr(G):
    base = os.path.join(G, "configs", "language")
    if not os.path.isdir(base):
        base = os.path.join(G, "data", "configs", "language")
    kr = {x["key"]: x["content"] for x in load(os.path.join(base, "language_kr.json"))}
    rev = collections.defaultdict(collections.Counter)
    for code, key in (("en", norm), ("zh", lambda t: "zh:" + t.strip())):
        for x in load(os.path.join(base, f"language_{code}.json")):
            t = strip_tags(kr.get(x["key"], ""))
            if t and len(x["content"]) < 80:
                rev[key(x["content"])][t] += 1

    def find(name, zh=None):
        for k in ([norm(name)] if name else []) + (["zh:" + zh.strip()] if zh else []):
            if rev.get(k):
                return rev[k].most_common(1)[0][0]
        return None
    return find


# 위키 원본 주소 → 사이트 경로 목록. GitHub Actions(fetch-wiki-images)가 이걸 보고 원본 화질로 다시 받는다.
MANIFEST = []


def put_image(src, dst, max_w=None, max_h=None, quality=80, url=None):
    if url:
        MANIFEST.append({"url": url, "dst": os.path.relpath(dst, OUT[0]), "max_w": max_w, "max_h": max_h, "quality": quality})
    if not src or not os.path.exists(src):
        return None
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
        return dst
    if Image and (max_w or max_h):
        im = Image.open(src)
        w, h = im.size
        r = min((max_w or w) / w, (max_h or h) / h, 1)
        if r < 1:
            im = im.resize((round(w * r), round(h * r)), Image.LANCZOS)
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGBA")
        im.save(dst, "WEBP", quality=quality, method=5)
    elif src.endswith(".webp"):
        shutil.copyfile(src, dst)
    else:
        Image.open(src).save(dst, "WEBP", quality=quality, method=5)
    return dst


OUT = ["."]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wiki", required=True)
    ap.add_argument("--global", dest="G", required=True)
    ap.add_argument("--out", default=".")
    a = ap.parse_args()
    W, O = a.wiki, a.out
    OUT[0] = O
    kr = en_to_kr(a.G)
    chars = load(os.path.join(O, "data", "game", "characters.json"))
    by_en = {norm(c["name"].get("en")): c["id"] for c in chars if c["name"].get("en")}

    os.makedirs(os.path.join(O, "data", "raw", "wiki"), exist_ok=True)
    for n in ("stories", "npcs", "versions", "characters"):
        shutil.copyfile(os.path.join(W, "data", f"{n}.json"), os.path.join(O, "data", "raw", "wiki", f"{n}.json"))

    # ── 스토리 ──
    out = []
    for i, s in enumerate(load(os.path.join(W, "data", "stories.json"))["stories"]):
        en = s["name"]
        base = re.sub(r"\s*\(Event\)$", "", en)
        ko = TITLE_FIX.get(base) or kr(base)
        banner = None
        if s.get("banner") and s["banner"].get("local"):
            rel = f"assets/img/story/{s['id']}.webp"
            if put_image(os.path.join(W, s["banner"]["local"]), os.path.join(O, rel), max_w=1600, quality=90, url=s["banner"].get("url")):
                banner = rel
        ver = s.get("version")
        vbase = ver.split(".")[0] if ver and ver.startswith("S") else ver
        stages = [{"n": st.get("n"), "en": st.get("title"), "ko": kr(st.get("title"))} for st in s.get("stages") or []]
        out.append({
            "id": s["id"], "cat": s["category"], "order": i,
            "name": {"ko": (ko + (" (이벤트)" if en != base else "")) if ko else en, "en": en},
            "nameChecked": bool(ko), "abbr": s.get("abbr"),
            "version": vbase, "part": ver if ver != vbase else None,
            "char": by_en.get(norm(s.get("character"))) if s.get("character") else None,
            "charEn": s.get("character"),
            "banner": banner, "stages": stages, "wiki": s.get("wiki"),
        })
    with open(os.path.join(O, "data", "game", "stories.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"스토리 {len(out)}개 (한국어 제목 {sum(x['nameChecked'] for x in out)}개)")

    # ── NPC ──
    def pick_icon(x):
        icons = x.get("icons") or []
        for want in (("Default", "Default"), ("NPC", "Default"), ("Default", "Normal")):
            for ic in icons:
                if (ic.get("form"), ic.get("mood")) == want:
                    return ic
        return icons[0] if icons else None

    story_by_name = {norm(re.sub(r"\s*\(Event\)$", "", st["name"]["en"])): st["id"] for st in out}
    npcs = []
    for x in load(os.path.join(W, "data", "npcs.json"))["npcs"]:
        slug = re.sub(r"[^a-z0-9]+", "-", norm_slug(x["name"])).strip("-") or "npc"
        ic = pick_icon(x)
        icon = put_image(os.path.join(W, ic["local"]), os.path.join(O, f"assets/img/npc/{slug}.webp"), max_w=160) if ic else None
        # 전신 그림: 위키 폴더의 full-*, live2d-* 전부 (full-initial 먼저)
        folder = os.path.join(W, "images", "npc", slug)
        fulls = sorted([f for f in os.listdir(folder) if f.endswith(".webp")] if os.path.isdir(folder) else [],
                       key=lambda f: (not f.startswith("full-initial"), not f.startswith("full"), f))
        arts = []
        for f in fulls:
            d = put_image(os.path.join(folder, f), os.path.join(O, f"assets/img/npc/{slug}/{f}"), max_h=900)
            if d:
                label = re.sub(r"^(full|live2d)-?", "", f[:-5]).replace("-", " ").strip() or "기본"
                arts.append({"src": os.path.relpath(d, O), "label": label})
        art = arts[0]["src"] if arts else None
        if not icon and not art:
            continue
        moods = []
        for m in x.get("icons") or []:
            if not m.get("local"):
                continue
            d = put_image(os.path.join(W, m["local"]), os.path.join(O, f"assets/img/npc/{slug}/icons/{os.path.basename(m['local'])}"), max_w=136)
            if d:
                moods.append({"src": os.path.relpath(d, O), "form": m.get("form"), "mood": m.get("mood")})
        appears = []
        for k in (x.get("gallery") or {}):
            sid = story_by_name.get(norm(k))
            if sid and sid not in appears:
                appears.append(sid)
        fa = strip_wiki(x.get("firstAppearance") or "")
        fa = fa.split("/")[0] if fa else None
        ko = x.get("name_kor") or NPC_FIX.get(x["name"]) or (None if x["name"] in NO_GUESS else kr(x["name"], x.get("name_zho")))
        if ko and not re.search("[가-힣0-9]", ko):
            ko = None
        npcs.append({
            "id": f"npc-{slug}",
            "name": {"ko": ko or x["name"], "en": x["name"], "zh": x.get("name_zho"), "ja": x.get("name_jpn")},
            "nameChecked": bool(x.get("name_kor")),
            "affiliation": strip_wiki(x.get("affiliation")), "intro": strip_wiki(x.get("intro")),
            "icon": os.path.relpath(icon, O) if icon else None,
            "art": art, "arts": arts, "moods": moods,
            "gender": x.get("gender"), "status": strip_wiki(x.get("status")), "first": fa,
            "firstVersion": x.get("firstVersion"),
            "cv": {k: v for k, v in (x.get("cv") or {}).items() if v and v != "?"},
            "stories": appears, "wiki": x.get("wiki"),
        })
    npcs.sort(key=lambda n: n["name"]["ko"])
    with open(os.path.join(O, "data", "game", "npcs.json"), "w", encoding="utf-8") as f:
        json.dump(npcs, f, ensure_ascii=False, separators=(",", ":"))
    print(f"NPC {len(npcs)}명")

    build_profiles(W, O, a.G, chars, kr)
    build_versions(W, O, a.G, chars, out, kr)
    seen = {}
    for m in MANIFEST:
        seen[m["dst"]] = m
    with open(os.path.join(O, "data", "raw", "wiki", "images.json"), "w", encoding="utf-8") as f:
        json.dump(list(seen.values()), f, ensure_ascii=False, indent=0)
    print(f"원본 화질로 다시 받을 그림 {len(seen)}개 목록 저장")


ORIGIN = {
    "United States of America": "미국", "England": "영국", "Unknown": "불명", "France": "프랑스", "Russia": "러시아",
    "China": "중국", "Germany": "독일", "Italy": "이탈리아", "Australia": "오스트레일리아", "Poland": "폴란드",
    "India": "인도", "Greece": "그리스", "Austria": "오스트리아", "Norway": "노르웨이", "Kazakhstan": "카자흐스탄",
    "Sparta": "스파르타", "Kazakh SSR": "카자흐 소비에트 사회주의 공화국", "Frankish Kingdom": "프랑크 왕국",
    "Ireland": "아일랜드", "Romania": "루마니아", "Moldova": "몰도바", "Hungary": "헝가리", "Netherlands": "네덜란드",
    "Northern Ireland": "북아일랜드", "Republic of Colombia": "콜롬비아", "Nukutaeao": "누쿠타이오", "Argentina": "아르헨티나",
    "Bulgaria": "불가리아", "Mexico": "멕시코", "Iceland": "아이슬란드", "Wales": "웨일스", "Japan": "일본",
    "Europe (Unspecified)": "유럽", "Liechtenstein": "리히텐슈타인", "Scotland": "스코틀랜드", "Brazil": "브라질",
    "Sweden": "스웨덴", "Holy Roman Empire": "신성 로마 제국", "Asia (Unspecified)": "아시아",
}
# 분류 이름은 나무위키 '마도학자(리버스: 1999)' 문서를 따른다
ROLE = {"Arcanist": "마도학자", "Arcanists": "마도학자", "The Awakened": "의식 각성자", "Awakened": "의식 각성자",
        "Human": "마도학 도구를 사용하는 인간", "The Mixed": "마도학자 혼혈종", "Mixed": "마도학자 혼혈종",
        "The Beyond": "초자연자", "Beyond": "초자연자", "The Infected": "마도학자 감염종",
        "Artificial Intelligence": "인공지능"}
MONTHS = {m: i + 1 for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August",
                                          "September", "October", "November", "December"])}


def debut_ko(t):
    if not t or t == "Unknown":
        return "불명" if t else None
    m = re.fullmatch(r"(\d{3,4})s", t)
    if m:
        return f"{m.group(1)}년대"
    m = re.fullmatch(r"(Early|Mid|Late)? ?(\d+)(?:st|nd|rd|th) Century", t)
    if m:
        pre = {"Early": "초", "Mid": "중반", "Late": "말"}.get(m.group(1), "")
        return f"{m.group(2)}세기" + (f" {pre}" if pre else "")
    m = re.fullmatch(r"2nd Half (\d+)th Century", t)
    if m:
        return f"{m.group(1)}세기 후반"
    m = re.fullmatch(r"(\d+) BCE", t)
    if m:
        return f"기원전 {m.group(1)}년"
    if t == "Middle Ages":
        return "중세"
    if t.isdigit():
        return f"{t}년"
    return t


def build_profiles(W, O, G, chars, kr):
    """출품작 프로필: 생일(게임 데이터 우선), 출신, 활동 시기, 매개, 영감, 성우, 소개, 생일 이야기, SD 그림"""
    base = os.path.join(G, "configs", "language")
    lang = {x["key"]: x["content"] for x in load(os.path.join(base, "language_kr.json"))}
    gchar = {c["id"]: c for c in load(os.path.join(G, "json", "character.json"))}
    by_en = {norm(c["name"].get("en")): c for c in chars if c["name"].get("en")}
    by_ko = {c["name"]["ko"]: c for c in chars}
    out = {}
    for w in load(os.path.join(W, "data", "characters.json"))["characters"]:
        c = by_en.get(norm(w["name"])) or by_ko.get(w.get("name_kor") or "")
        if not c:
            continue
        g = gchar.get(c["id"], {})
        bday = None
        if g.get("roleBirthday") and "/" in g["roleBirthday"]:
            mm, dd = g["roleBirthday"].split("/")[:2]
            bday = f"{int(mm):02d}-{int(dd):02d}"
        elif w.get("birthday"):
            m = re.match(r"([A-Za-z]+) (\d+)", w["birthday"])
            if m and m.group(1) in MONTHS:
                bday = f"{MONTHS[m.group(1)]:02d}-{int(m.group(2)):02d}"
        slug = os.path.basename(os.path.dirname((w.get("icon") or {}).get("local") or "")) or None
        imgs = {}
        for iv in w.get("imageVersions") or []:
            lab = (iv.get("label") or "").lower()
            if lab in ("chibi", "suitcase") and iv.get("local"):
                d = put_image(os.path.join(W, iv["local"]), os.path.join(O, f"assets/img/profile/{c['id']}-{lab}.webp"), max_w=320)
                if d:
                    imgs[lab] = os.path.relpath(d, O)
        tx = lambda k: strip_tags(lang.get(g.get(k) or "", "")) or None
        stories = [t.strip() for t in (tx("desc") or "").split("|") if t.strip()]
        medium = w.get("medium")
        out[str(c["id"])] = {
            "birthday": bday,
            "origin": ORIGIN.get(w.get("origin"), w.get("origin")),
            "debut": debut_ko(w.get("debut")),
            "role": ROLE.get(w.get("role"), w.get("role")),
            "medium": (kr(medium) if medium else None) or medium, "mediumEn": medium,
            "inspiration": w.get("inspiration"),
            "cv": {k: v for k, v in (w.get("cv") or {}).items() if v and v != "?"},
            "intro": tx("desc2"),
            "bdayStories": stories,
            "release": w.get("release"),
            "wiki": w.get("wiki"),
            **imgs,
        }
    with open(os.path.join(O, "data", "game", "profiles.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"출품작 프로필 {len(out)}명 (생일 {sum(1 for v in out.values() if v['birthday'])}명)")


def clean_time(t):
    if not t:
        return None
    t = re.sub(r'colspan="?\d+"?\s*\|\s*', "", t)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", t).strip() or None


def build_versions(W, O, G, chars, stories, kr):
    """버전 연대기: 위키 버전 문서 + 게임 모집 풀(한국어 이름, 픽업 출품작)"""
    base = os.path.join(G, "configs", "language")
    lk = {x["key"]: x["content"] for x in load(os.path.join(base, "language_kr.json"))}
    le = {x["key"]: x["content"] for x in load(os.path.join(base, "language_en.json"))}
    import difflib
    pools = collections.defaultdict(list)
    for p in load(os.path.join(G, "json", "summon_pool.json")):
        pools[norm(strip_tags(le.get(p.get("nameCn"), "")) or p.get("nameEn"))].append(p)
    # 픽업 출품작이 정해진 풀("6성|5성#5성")을 먼저
    for k in pools:
        pools[k].sort(key=lambda p: "|" not in (p.get("upWeight") or ""))
    by_en = {norm(c["name"].get("en")): c["id"] for c in chars if c["name"].get("en")}
    skins = load(os.path.join(O, "data", "game", "skins.json"))
    skin_by = {(s["char"], norm(s.get("nameEn"))): s["id"] for s in skins if s.get("nameEn")}
    story_by = {norm(re.sub(r"\s*\(Event\)$", "", st["name"]["en"])): st["id"] for st in stories}

    def pool_for(name):
        n = norm(re.sub(r"\s*\(Rerun\)\s*$", "", name))
        if n in pools:
            return pools[n][0]
        # 철자가 조금 다른 것 (of/on/in 등)
        best = max(pools, key=lambda k: difflib.SequenceMatcher(None, k, n).ratio())
        return pools[best][0] if difflib.SequenceMatcher(None, best, n).ratio() >= 0.86 else None

    def img(obj, dst, **kw):
        local = (obj or {}).get("local")
        if not local:
            return None
        d = put_image(os.path.join(W, local), os.path.join(O, dst), url=obj.get("url"), quality=90, **kw)
        return os.path.relpath(d, O) if d else None

    out = []
    for v in load(os.path.join(W, "data", "versions.json"))["versions"]:
        vid = v["version"]
        vd = f"assets/img/ver/{vid}"
        slug = lambda local: os.path.basename(local)
        periods = {}
        for p in v.get("periods") or []:
            periods["cn" if p.get("region") == "CN" else "global"] = clean_time(p.get("period"))
        poster = next((p for p in v.get("posters") or [] if "global" in (p.get("local") or "").lower()), (v.get("posters") or [None])[0])
        title_en = re.sub(r"\s*\((Event|Assassin's Creed 콜라보)\)$", "", v.get("title") or "")
        parts = [t.strip() for t in title_en.split(" / ")]
        title_ko = " / ".join(filter(None, [kr(t) for t in parts])) or None
        rec = {
            "id": vid, "title": {"en": title_en, "ko": title_ko},
            "banner": img(v.get("banner"), f"{vd}/banner.webp", max_w=1600),
            "poster": img(poster, f"{vd}/poster.webp", max_w=1000) if poster else None,
            "periods": periods, "quote": v.get("quote"), "tagline": v.get("arrivalTagline"),
            "newChars": [], "events": [], "summons": [], "garments": [],
        }
        for nc in v.get("newCharacters") or []:
            loc = (nc.get("poster") or {}).get("local")
            rec["newChars"].append({"char": by_en.get(norm(nc["name"])), "en": nc["name"],
                                    "poster": img(nc.get("poster"), f"{vd}/char-{slug(loc)}", max_w=720) if loc else None})
        for e in v.get("events") or []:
            loc = (e.get("banner") or {}).get("local")
            base_n = re.sub(r"\s*(/.*|\(.*\))$", "", e["name"]).strip()
            rec["events"].append({"name": {"en": e["name"], "ko": kr(e["name"]) or kr(base_n)},
                                  "banner": img(e.get("banner"), f"{vd}/ev-{slug(loc)}", max_w=1600) if loc else None,
                                  "time": clean_time(e.get("time")), "section": e.get("section"),
                                  "story": story_by.get(norm(e["name"])) or story_by.get(norm(base_n))})
        for su in v.get("summons") or []:
            loc = (su.get("banner") or {}).get("local")
            p = pool_for(su["name"])
            six, five = [], []
            if p and "|" in (p.get("upWeight") or ""):
                ups = p["upWeight"].split("|")
                six = [int(x) for x in ups[0].split("#") if x.isdigit()]
                five = [int(x) for x in (ups[1].split("#") if len(ups) > 1 else []) if x.isdigit()]
            ko = strip_tags(lk.get(p["nameCn"], "")) if p else None
            rerun = "(Rerun)" in su["name"]
            rec["summons"].append({"id": f"{vid}:{norm(su['name'])}", "name": {"en": su["name"], "ko": (ko + (" (복각)" if rerun else "")) if ko else None},
                                   "banner": img(su.get("banner"), f"{vd}/su-{slug(loc)}", max_w=1400) if loc else None,
                                   "time": clean_time(su.get("time")), "rerun": rerun, "six": six, "five": five,
                                   "pool": p["id"] if p else None})
        for gm in v.get("garments") or []:
            loc = (gm.get("poster") or {}).get("local")
            cid = by_en.get(norm(gm.get("character")))
            rec["garments"].append({"char": cid, "en": gm.get("garment"), "skin": skin_by.get((cid, norm(gm.get("garment")))),
                                    "poster": img(gm.get("poster"), f"{vd}/gm-{slug(loc)}", max_w=720) if loc else None})
        out.append(rec)
    with open(os.path.join(O, "data", "game", "versions.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    ns = sum(len(v["summons"]) for v in out)
    print(f"버전 {len(out)}개 · 모집 배너 {ns}개 (게임 풀과 맞춘 것 {sum(1 for v in out for s in v['summons'] if s['pool'])}개)")


def norm_slug(t):
    import unicodedata
    return unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()


def strip_wiki(t):
    if not t:
        return None
    t = re.sub(r"<ref>.*?</ref>", "", t)
    t = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\{\{[^}]*\}\}", "", t)
    return t.strip() or None


if __name__ == "__main__":
    main()
