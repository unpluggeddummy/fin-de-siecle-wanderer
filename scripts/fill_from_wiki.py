#!/usr/bin/env python3
"""
게임 에셋에 그림이 없는 스킨을 Reverse: 1999 팬덤 위키에서 찾아 채운다.

  python scripts/fill_from_wiki.py --out .

data/game/skins.json 에서 art 가 비어 있는 스킨만 대상으로 하며,
위키 파일 검색(MediaWiki API)으로 가장 그럴듯한 그림을 받아 assets/img/skin/<id>.webp 로 저장한다.
찾지 못하면 그대로 둔다. 깃허브 액션에서 실행된다.
"""
import argparse
import io
import json
import os
import re
import sys
import time

import requests
from PIL import Image

API = "https://reverse1999.fandom.com/api.php"
UA = {"User-Agent": "r1999-archive personal fan site image sync (GitHub Actions)"}


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def search_files(q):
    r = requests.get(API, params={
        "action": "query", "list": "search", "srnamespace": 6, "srlimit": 10,
        "srsearch": q, "format": "json",
    }, headers=UA, timeout=30)
    r.raise_for_status()
    return [x["title"] for x in r.json().get("query", {}).get("search", [])]


def file_url(title):
    r = requests.get(API, params={
        "action": "query", "titles": title, "prop": "imageinfo", "iiprop": "url|size", "format": "json",
    }, headers=UA, timeout=30)
    r.raise_for_status()
    for p in r.json().get("query", {}).get("pages", {}).values():
        for ii in p.get("imageinfo", []):
            return ii.get("url"), ii.get("width", 0), ii.get("height", 0)
    return None, 0, 0


def pick(titles, char_en, skin_en):
    """캐릭터·스킨 이름이 모두 들어 있고 세로로 긴 그림을 우선한다."""
    c, s = norm(char_en), norm(skin_en)
    scored = []
    for t in titles:
        n = norm(t)
        if not n.endswith(("png", "webp", "jpg", "jpeg")):
            continue
        sc = (2 if s and s in n else 0) + (1 if c and c in n else 0)
        if any(k in n for k in ("icon", "head", "avatar", "chibi", "emoji", "sticker")):
            sc -= 2
        if sc >= 2:
            scored.append((sc, t))
    scored.sort(reverse=True)
    return [t for _, t in scored]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=".")
    ap.add_argument("--limit", type=int, default=80)
    a = ap.parse_args()
    sp = os.path.join(a.out, "data", "game", "skins.json")
    cp = os.path.join(a.out, "data", "game", "characters.json")
    skins = json.load(open(sp, encoding="utf-8"))
    chars = {c["id"]: c for c in json.load(open(cp, encoding="utf-8"))}
    # 기본·통찰 스킨은 대표 이미지(char/)가 이미 좋은 일러스트라 채우지 않는다.
    # (위키 검색으로는 모집 포스터나 전신 스프라이트가 걸려서 카드가 망가졌다)
    todo = [s for s in skins if not s.get("art") and s["type"] in ("shop", "shop-art", "event")]
    print(f"그림 없는 스킨 {len(todo)}개")
    filled = 0
    for s in todo[: a.limit]:
        en = chars.get(s["char"], {}).get("name", {}).get("en", "")
        skin_en = s.get("nameEn") if s["type"] not in ("default", "insight") else ""
        q = f"{en} {skin_en}".strip()
        try:
            titles = pick(search_files(q), en, skin_en or en)
            for t in titles[:3]:
                url, w, h = file_url(t)
                if not url or h < w or h > w * 2.2:  # 세로 그림만 (전신 스프라이트처럼 너무 긴 건 제외)
                    continue
                if any(k in norm(t) for k in ("banner", "poster", "limited", "arrival", "summon", "pv")):
                    continue
                img = requests.get(url, headers=UA, timeout=60)
                img.raise_for_status()
                im = Image.open(io.BytesIO(img.content))
                im.load()
                if im.mode not in ("RGB", "RGBA"):
                    im = im.convert("RGBA")
                if im.width > 640:
                    im = im.resize((640, round(im.height * 640 / im.width)), Image.LANCZOS)
                rel = f"skin/{s['id']}.webp"
                dest = os.path.join(a.out, "assets", "img", rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                im.save(dest, "WEBP", quality=82, method=5)
                s["art"] = "assets/img/" + rel
                s["artSource"] = "fandom"
                filled += 1
                print(f"  + {s['id']} {q} ← {t}")
                break
        except Exception as e:  # 위키가 막히거나 바뀌어도 전체 갱신은 계속
            print(f"  ! {s['id']} {q}: {e}", file=sys.stderr)
        time.sleep(0.5)
    if filled:
        with open(sp, "w", encoding="utf-8") as f:
            json.dump(skins, f, ensure_ascii=False, indent=1)
            f.write("\n")
    print(f"위키에서 채운 그림 {filled}개")


if __name__ == "__main__":
    main()
