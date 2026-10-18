#!/usr/bin/env python3
"""위키 원본 화질로 배너·포스터 다시 받기.

data/raw/wiki/images.json (import_wiki.py가 만든 목록)에 적힌 원본 주소에서 그림을 받아
사이트 경로(assets/img/...)에 webp로 덮어쓴다. 이미 받은 것은 images-done.json에 적어 두고 건너뛴다.
샌드박스에서는 위키에 접속할 수 없어서 GitHub Actions(fetch-wiki-images.yml)에서 돌린다.

  python3 scripts/fetch_wiki_images.py [--all] [--only ver|story]
"""
import argparse
import io
import json
import os
import sys
import time

import requests
from PIL import Image

UA = "Mozilla/5.0 (fin-de-siecle-wanderer personal fan archive; GitHub Actions)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="받았던 것도 다시 받기")
    ap.add_argument("--only", default="", help="경로에 이 글자가 들어간 것만 (예: ver, story)")
    ap.add_argument("--root", default=".")
    a = ap.parse_args()
    lst = json.load(open(os.path.join(a.root, "data/raw/wiki/images.json"), encoding="utf-8"))
    done_path = os.path.join(a.root, "data/raw/wiki/images-done.json")
    done = json.load(open(done_path)) if os.path.exists(done_path) and not a.all else {}
    s = requests.Session()
    s.headers["User-Agent"] = UA
    ok = fail = skip = 0
    for m in lst:
        if a.only and a.only not in m["dst"]:
            continue
        dst = os.path.join(a.root, m["dst"])
        rec = done.get(m["dst"])
        # 받은 뒤 파일이 다른 것(예: 낮은 화질 업데이트로 덮어씀)으로 바뀌었으면 다시 받는다
        if isinstance(rec, dict) and rec.get("url") == m["url"] and os.path.exists(dst) and os.path.getsize(dst) == rec.get("size"):
            skip += 1
            continue
        try:
            r = s.get(m["url"], timeout=40)
            r.raise_for_status()
            im = Image.open(io.BytesIO(r.content))
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGBA")
            w, h = im.size
            ratio = min((m.get("max_w") or w) / w, (m.get("max_h") or h) / h, 1)
            if ratio < 1:
                im = im.resize((round(w * ratio), round(h * ratio)), Image.LANCZOS)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            im.save(dst, "WEBP", quality=m.get("quality") or 90, method=6)
            done[m["dst"]] = {"url": m["url"], "size": os.path.getsize(dst)}
            ok += 1
            print(f"✓ {m['dst']} ({w}×{h})")
        except Exception as e:  # 하나 실패해도 계속
            fail += 1
            print(f"✗ {m['dst']}: {e}", file=sys.stderr)
        time.sleep(0.3)  # 위키 서버에 부담 주지 않게
    with open(done_path, "w") as f:
        json.dump(done, f, ensure_ascii=False, indent=0)
    print(f"받음 {ok} · 건너뜀 {skip} · 실패 {fail}")


if __name__ == "__main__":
    main()
