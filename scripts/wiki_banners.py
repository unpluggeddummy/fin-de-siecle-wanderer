#!/usr/bin/env python3
"""게임 데이터로 만든 모집 배너에 위키(fandom)의 네모난 배너 그림을 붙인다.

  python scripts/wiki_banners.py --out .

- 대상: 그림이 없거나 게임 원본에서 오린 그림(assets/img/summon/<풀>.webp)을 쓰는 배너
- 위키 파일 이름 규칙: "<영문 배너 이름> <버전> Banner.png", "<이름> Rerun Banner.png", "<이름> Banner.png"
- 가로로 긴(네모난 카드) 그림만 쓴다. 찾으면 assets/img/summon/w<풀>.webp 로 저장하고 bannerSrc 를 wiki 로 적는다
- 못 찾으면 그대로 두고 다음 주에 다시 찾는다
출처: Reverse: 1999 Wiki (reverse1999.fandom.com, CC BY-SA 3.0)
"""
import argparse
import io
import json
import os
import re

import requests
from PIL import Image

API = "https://reverse1999.fandom.com/api.php"
UA = {"User-Agent": "fin-de-siecle-wanderer/1.0 (personal archive; github.com/unpluggeddummy)"}
FIX = {"lron": "Iron"}  # 게임 데이터 영문 오타


def en_name(s):
    en = (s.get("name") or {}).get("en") or ""
    en = re.sub(r"\s*\((Rerun|Re-run)\)\s*$", "", en, flags=re.I).strip()
    for a, b in FIX.items():
        en = re.sub(rf"\b{a}\b", b, en)
    return en


def candidates(s, vid):
    en = en_name(s)
    if not en:
        return []
    out = []
    num = vid if re.match(r"^\d+\.\d+$", vid) else None
    if num:
        out.append(f"{en} {num} Banner.png")
    if s.get("rerun"):
        if num:
            out.append(f"{en} Rerun {num} Banner.png")
        out += [f"{en} Rerun Banner.png", f"{en} (Rerun) Banner.png"]
    if s.get("kind") not in ("ripples", "double", "select") or not num:  # 매번 열리는 호수 배너는 버전 것만
        out.append(f"{en} Banner.png")
    if en.startswith("Ripples on the Water") and num:  # 위키에서 in/on 이 섞여 있다
        out.append(f"Ripples in the Water {num} Banner.png")
    return ["File:" + t for t in out]


def lookup(titles):
    """파일 이름 → (url, w, h)"""
    found = {}
    for i in range(0, len(titles), 40):
        part = titles[i:i + 40]
        r = requests.get(API, params={"action": "query", "titles": "|".join(part), "prop": "imageinfo",
                                      "iiprop": "url|size", "format": "json", "formatversion": 2},
                         headers=UA, timeout=60)
        r.raise_for_status()
        q = r.json().get("query", {})
        back = {}
        for n in q.get("normalized", []):
            back[n["to"]] = n["from"]
        for p in q.get("pages", []):
            ii = (p.get("imageinfo") or [None])[0]
            if p.get("missing") or not ii:
                continue
            found[back.get(p["title"], p["title"])] = (ii["url"], ii.get("width", 0), ii.get("height", 0))
            found[p["title"]] = found[back.get(p["title"], p["title"])]
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=".")
    a = ap.parse_args()
    vp = os.path.join(a.out, "data", "game", "versions.json")
    versions = json.load(open(vp, encoding="utf-8"))
    todo = []
    for v in versions:
        for s in v.get("summons", []):
            b = s.get("banner") or ""
            if s.get("bannerSrc") == "wiki" or (b and not b.startswith("assets/img/summon/")):
                continue
            c = candidates(s, v["id"])
            if c:
                todo.append((v, s, c))
    if not todo:
        print("위키 배너: 찾을 것 없음")
        return
    found = lookup(sorted({t for _, _, c in todo for t in c}))
    got = 0
    for v, s, c in todo:
        hit = next((found[t] for t in c if t in found and found[t][1] >= found[t][2] * 1.4), None)
        if not hit:
            continue
        url = hit[0]
        try:
            r = requests.get(url, headers=UA, timeout=60)
            r.raise_for_status()
            im = Image.open(io.BytesIO(r.content))
            im.load()
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGBA")
            if im.width > 1200:
                im = im.resize((1200, round(im.height * 1200 / im.width)), Image.LANCZOS)
            key = s.get("pool") or re.sub(r"[^\w.-]", "-", s["id"])
            rel = f"assets/img/summon/w{key}.webp"
            os.makedirs(os.path.join(a.out, "assets", "img", "summon"), exist_ok=True)
            im.save(os.path.join(a.out, rel), "WEBP", quality=82, method=5)
            s["banner"], s["bannerSrc"] = rel, "wiki"
            got += 1
        except Exception as e:
            print(f"  ! {url}: {e}")
    with open(vp, "w", encoding="utf-8") as f:
        json.dump(versions, f, ensure_ascii=False, separators=(",", ":"))
    print(f"위키 배너: 대상 {len(todo)}개 중 {got}개 붙임")


if __name__ == "__main__":
    main()
