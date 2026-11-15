#!/usr/bin/env python3
"""팬덤 위키 Category:NPCs 에서 NPC 대화 아이콘(표정별)과 전신 그림을 받아 사이트에 넣기.

  python3 scripts/fetch_wiki_npcs.py [--all] [--only 이름]

- 위키의 Category:NPCs 문서를 모두 돌면서 "<이름>_Icon.png", "<이름>_<표정>_Icon.png" 그림을 찾는다.
- data/game/npcs.json 에 이미 있는 NPC: 비어 있는 대표 아이콘을 채우고, 없던 표정 아이콘을 더한다.
  (손으로 넣은 아이콘 — 예: 버틴 — 은 그대로 둔다)
- npcs.json 에 없는 새 NPC: 이름(영어)·아이콘·전신 그림·위키 주소로 새로 만든다. 한국어 이름은 나중에 이름표에서.
- 이미 받은 그림은 data/raw/wiki/npc-images-done.json 에 적어 두고 건너뛴다 (--all 이면 다시 받기).
- 샌드박스에서는 위키에 접속할 수 없어서 GitHub Actions(fetch-wiki-npcs.yml)에서 돌린다.
그림 출처: Reverse: 1999 Wiki (CC BY-SA 3.0), 게임 그림의 권리는 Bluepoch.
"""
import argparse
import io
import json
import os
import re
import sys
import time
import unicodedata

import requests
from PIL import Image

API = "https://reverse1999.fandom.com/api.php"
WIKI = "https://reverse1999.fandom.com/wiki/"
UA = "Mozilla/5.0 (fin-de-siecle-wanderer personal fan archive; GitHub Actions)"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

S = requests.Session()
S.headers["User-Agent"] = UA


def api(**params):
    params = {"format": "json", "formatversion": "2", **params}
    for attempt in range(4):
        try:
            r = S.get(API, params=params, timeout=40)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt == 3:
                raise
            print(f"  … 다시 시도 ({e})")
            time.sleep(3 * (attempt + 1))


def slugify(t):
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-") or "npc"


def category_members():
    out, cont = [], {}
    while True:
        d = api(action="query", list="categorymembers", cmtitle="Category:NPCs", cmnamespace=0, cmlimit=500, **cont)
        out += [m["title"] for m in d["query"]["categorymembers"]]
        if "continue" not in d:
            return out
        cont = d["continue"]


def files_for(title):
    """문서에 쓰인 그림 + '<이름>_' 로 시작하는 그림 파일 → {파일 이름: 주소}"""
    files = {}
    cont = {}
    while True:
        d = api(action="query", titles=title, generator="images", gimlimit="max", prop="imageinfo", iiprop="url", **cont)
        for p in d.get("query", {}).get("pages", []):
            ii = (p.get("imageinfo") or [{}])[0]
            if ii.get("url"):
                files[p["title"].split(":", 1)[1].replace(" ", "_")] = ii["url"]
        if "continue" not in d:
            break
        cont = d["continue"]
    # 문서에 안 붙은 표정 아이콘도 있어서, 이름으로 시작하는 파일을 따로 찾는다
    prefix = title.replace(" ", "_") + "_"
    cont = {}
    while True:
        d = api(action="query", list="allimages", aiprefix=prefix, ailimit=500, aiprop="url", **cont)
        for im in d.get("query", {}).get("allimages", []):
            files.setdefault(im["name"], im["url"])
        if "continue" not in d:
            break
        cont = d["continue"]
    return files


def icon_files(title, files):
    """'<이름>_Icon.png' → 기본, '<이름>_NPC_Icon.png' → 기본, '<이름>_<표정>_Icon.png' → 표정"""
    base = title.replace(" ", "_")
    out = []
    for f, url in files.items():
        m = re.match(re.escape(base) + r"(?:_(.+?))?_Icon\.(png|webp|jpg)$", f, re.I)
        if not m:
            continue
        mood = (m.group(1) or "").replace("_", " ").strip()
        if mood.upper() == "NPC":
            mood = ""
        out.append({"file": f, "url": url, "mood": mood or "Default"})
    out.sort(key=lambda x: (x["mood"] != "Default", x["mood"]))
    return out


def art_file(title, files):
    base = title.replace(" ", "_")
    for ext in ("png", "PNG", "webp", "jpg"):
        if f"{base}.{ext}" in files:
            return f"{base}.{ext}", files[f"{base}.{ext}"]
    return None, None


def fetch(url, dst, done, redo, max_w=None, max_h=None):
    rel = os.path.relpath(dst, ROOT)
    if not redo and done.get(rel) == url and os.path.exists(dst):
        return rel
    r = S.get(url, timeout=40)
    r.raise_for_status()
    im = Image.open(io.BytesIO(r.content))
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA")
    w, h = im.size
    ratio = min((max_w or w) / w, (max_h or h) / h, 1)
    if ratio < 1:
        im = im.resize((round(w * ratio), round(h * ratio)), Image.LANCZOS)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    im.save(dst, "WEBP", quality=88, method=6)
    done[rel] = url
    return rel


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="받았던 그림도 다시 받기")
    ap.add_argument("--only", default="", help="이름에 이 글자가 들어간 NPC만")
    a = ap.parse_args()

    npcs_path = os.path.join(ROOT, "data/game/npcs.json")
    npcs = json.load(open(npcs_path, encoding="utf-8"))
    by_en = {n["name"]["en"].lower(): n for n in npcs if n.get("name", {}).get("en")}
    done_path = os.path.join(ROOT, "data/raw/wiki/npc-images-done.json")
    done = json.load(open(done_path)) if os.path.exists(done_path) else {}

    titles = category_members()
    print(f"위키 NPC 문서 {len(titles)}개")
    stat = {"new": 0, "icon": 0, "moods": 0, "fail": 0}
    for title in titles:
        if a.only and a.only.lower() not in title.lower():
            continue
        try:
            files = files_for(title)
        except Exception as e:
            print(f"✗ {title}: 문서 읽기 실패 ({e})")
            stat["fail"] += 1
            continue
        icons = icon_files(title, files)
        n = by_en.get(title.lower())
        slug = (n["id"][4:] if n and n["id"].startswith("npc-") else slugify(title))
        if n is None:
            art_name, art_url = art_file(title, files)
            if not icons and not art_url:
                continue
            n = {"id": f"npc-{slug}", "name": {"ko": title, "en": title, "zh": None, "ja": None}, "nameChecked": False,
                 "affiliation": None, "intro": None, "icon": None, "art": None, "arts": [], "moods": [],
                 "gender": None, "status": None, "first": None, "firstVersion": None, "cv": {}, "stories": [],
                 "wiki": WIKI + title.replace(" ", "_")}
            if art_url:
                try:
                    src = fetch(art_url, os.path.join(ROOT, f"assets/img/npc/{slug}/full-initial.webp"), done, a.all, max_h=900)
                    n["art"] = src
                    n["arts"] = [{"src": src, "label": "initial"}]
                except Exception as e:
                    print(f"  ✗ 전신 그림 {art_name}: {e}")
            npcs.append(n)
            by_en[title.lower()] = n
            stat["new"] += 1
            print(f"+ 새 NPC: {title}")
        have = {(m.get("form"), m.get("mood")) for m in n.get("moods") or []}
        for ic in icons:
            try:
                if ic["mood"] == "Default" and not n.get("icon"):
                    n["icon"] = fetch(ic["url"], os.path.join(ROOT, f"assets/img/npc/{slug}.webp"), done, a.all, max_w=160)
                    stat["icon"] += 1
                    print(f"  ✓ {title} 대표 아이콘")
                if ("Default", ic["mood"]) in have:
                    continue
                key = "default--" + slugify(ic["mood"])
                src = fetch(ic["url"], os.path.join(ROOT, f"assets/img/npc/{slug}/icons/{key}.webp"), done, a.all, max_w=136)
                n.setdefault("moods", []).append({"src": src, "form": "Default", "mood": ic["mood"]})
                have.add(("Default", ic["mood"]))
                stat["moods"] += 1
            except Exception as e:
                print(f"  ✗ {ic['file']}: {e}")
                stat["fail"] += 1
        # 대표 아이콘이 없고 표정 아이콘만 있으면 첫 표정을 대표로
        if not n.get("icon") and n.get("moods"):
            n["icon"] = n["moods"][0]["src"]
            stat["icon"] += 1
        time.sleep(0.3)  # 위키에 부담 주지 않게

    npcs.sort(key=lambda x: x["name"]["ko"])
    with open(npcs_path, "w", encoding="utf-8") as f:
        json.dump(npcs, f, ensure_ascii=False, separators=(",", ":"))
    os.makedirs(os.path.dirname(done_path), exist_ok=True)
    with open(done_path, "w", encoding="utf-8") as f:
        json.dump(done, f, ensure_ascii=False, indent=1)
    noicon = [x["name"]["ko"] for x in npcs if not x.get("icon")]
    print(f"\n새 NPC {stat['new']}명 · 대표 아이콘 {stat['icon']}개 · 표정 아이콘 {stat['moods']}개 · 실패 {stat['fail']}건")
    print(f"아이콘이 아직 없는 NPC {len(noicon)}명: {', '.join(noicon[:60])}")


if __name__ == "__main__":
    sys.exit(main())
