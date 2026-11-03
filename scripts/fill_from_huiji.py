#!/usr/bin/env python3
"""
灰機 위키(res1999.huijiwiki.com, 중국어 팬 위키)에서 새 그림을 찾는다.

  python scripts/fill_from_huiji.py --out .          # 살펴보기만 (기록만 남김)
  python scripts/fill_from_huiji.py --out . --fill   # 확실한 것만 채우기

1단계(지금): 깃허브 액션 기록에 다음을 남긴다. 파일 이름 규칙을 확인한 뒤 --fill 로 바꾼다.
  - 위키 API 접속 여부
  - 최근 올라온 파일 목록 (4.1 같은 새 버전 그림이 어떤 이름으로 올라오는지)
  - 그림이 없는 스킨마다 검색 후보
팬덤 위키(fill_from_wiki.py) 다음에 실행되어, 거기서도 못 찾은 것만 다룬다.
그림 출처: 灰機 위키 / 저작권 © Bluepoch
"""
import argparse
import io
import json
import os
import re
import sys
import time

import requests

API = "https://res1999.huijiwiki.com/api.php"
UA = {"User-Agent": "Mozilla/5.0 (fin-de-siecle-wanderer personal fan archive; weekly image sync)"}


def api(**params):
    params.setdefault("format", "json")
    r = requests.get(API, params=params, headers=UA, timeout=30)
    r.raise_for_status()
    ct = r.headers.get("content-type", "")
    if "json" not in ct:
        raise RuntimeError(f"JSON이 아닌 응답 ({ct[:40]}) — 사이트가 자동 접속을 막는 듯해요")
    return r.json()


def norm(s):
    return re.sub(r"[\s_·・\-—()（）《》「」『』\.]", "", (s or "").lower())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=".")
    ap.add_argument("--fill", action="store_true")
    ap.add_argument("--limit", type=int, default=40)
    a = ap.parse_args()

    # 1. 접속 확인
    try:
        si = api(action="query", meta="siteinfo")
        print(f"灰機 위키 접속 OK: {si['query']['general'].get('sitename')}")
    except Exception as e:
        print(f"灰機 위키 접속 실패: {e}")
        return

    # 2. 최근 올라온 파일
    try:
        res = api(action="query", list="allimages", aisort="timestamp", aidir="descending", ailimit=60,
                  aiprop="timestamp|size")
        print("\n최근 올라온 파일 60개 (날짜 · 크기 · 이름)")
        for f in res["query"]["allimages"]:
            print(f"  {f['timestamp'][:10]} · {f.get('width', '?')}x{f.get('height', '?')} · {f['name']}")
    except Exception as e:
        print(f"최근 파일 목록 실패: {e}")

    # 3. 그림 없는 스킨 후보
    sp = os.path.join(a.out, "data", "game", "skins.json")
    cp = os.path.join(a.out, "data", "game", "characters.json")
    skins = json.load(open(sp, encoding="utf-8"))
    chars = {c["id"]: c for c in json.load(open(cp, encoding="utf-8"))}
    todo = [s for s in skins if not s.get("art") and s.get("type") in ("shop", "shop-art", "event")]
    print(f"\n그림 없는 스킨 {len(todo)}개 — 후보 검색")
    filled = 0
    for s in todo[: a.limit]:
        c = chars.get(s["char"], {})
        zh = (c.get("name") or {}).get("zhCN") or ""
        if not zh:
            continue
        try:
            res = api(action="query", list="search", srnamespace=6, srlimit=8, srsearch=zh)
            titles = [x["title"] for x in res.get("query", {}).get("search", [])]
            ko = (c.get("name") or {}).get("ko")
            print(f"  [{s['id']}] {ko} · {s.get('name')} ({s.get('nameEn')}) → " + (" | ".join(titles[:6]) or "없음"))
            if a.fill:
                filled += fill_one(a.out, s, zh, titles)
        except Exception as e:
            print(f"  ! {s['id']}: {e}", file=sys.stderr)
        time.sleep(0.7)
    if a.fill and filled:
        with open(sp, "w", encoding="utf-8") as f:
            json.dump(skins, f, ensure_ascii=False, indent=1)
            f.write("\n")
    print(f"\n灰機 위키에서 채운 그림 {filled}개" + ("" if a.fill else " (살펴보기 모드라 채우지 않음)"))


def fill_one(out, s, zh, titles):
    """파일 이름 규칙을 확인한 뒤 맞춘다: 지금은 캐릭터 이름 + '衣着'/'立绘'가 들어간 세로 그림만."""
    from PIL import Image
    for t in titles:
        n = norm(t)
        if norm(zh) not in n or not any(k in t for k in ("衣着", "立绘", "皮肤")):
            continue
        res = api(action="query", titles=t, prop="imageinfo", iiprop="url|size")
        for p in res.get("query", {}).get("pages", {}).values():
            for ii in p.get("imageinfo", []):
                w, h = ii.get("width", 0), ii.get("height", 0)
                if not ii.get("url") or h < w or h > w * 2.2:
                    continue
                r = requests.get(ii["url"], headers=UA, timeout=60)
                r.raise_for_status()
                im = Image.open(io.BytesIO(r.content))
                im.load()
                if im.mode not in ("RGB", "RGBA"):
                    im = im.convert("RGBA")
                if im.width > 640:
                    im = im.resize((640, round(im.height * 640 / im.width)), Image.LANCZOS)
                rel = f"skin/{s['id']}.webp"
                dest = os.path.join(out, "assets", "img", rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                im.save(dest, "WEBP", quality=82, method=5)
                s["art"], s["artSource"] = "assets/img/" + rel, "huijiwiki"
                print(f"    + {s['id']} ← {t}")
                return 1
    return 0


if __name__ == "__main__":
    main()
