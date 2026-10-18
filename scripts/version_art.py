#!/usr/bin/env python3
"""버전 대표 일러스트(게임 원본, 글자 없음)를 중섭 에셋에서 꺼내 연대기용으로 저장한다.

  python3 scripts/version_art.py --cn <Reverse-1999-CN-Asset 폴더> --out .

규칙: N.M 버전 → singlebg/vNaM_mainactivity_singlebg/vNaM_enterview_fullbg.png
(옛 버전·콜라보는 아래 OVERRIDE). 파일이 없으면 건너뛰고, 사이트는 위키 배너를 대신 쓴다.
CN 폴더가 sparse checkout이라 파일이 없으면 `git show`로 꺼내 본다.
결과: assets/img/ver/<버전>/key.webp, data/game/version-art.json
"""
import argparse
import io
import json
import os
import subprocess

from PIL import Image

OVERRIDE = {
    "1.3": "singlebg/v1a3_enterview_singlebg/v1a3_enterview_fullbg.png",
    "1.4": "singlebg/v1a4_enterview_singlebg/v1a4_enterview_fullbg_01.png",
    "1.5": "singlebg/v1a5_enterview_singlebg/v1a5_enterview_fullbg_1.png",
    "S01": "singlebg/v2a9_mainactivity_singlebg/v2a9_enterview_fullbg1.png",   # 중섭 2.9 = 어쌔신 크리드 콜라보
    "S02": "singlebg/sp02_mainactivity_singlebg/sp02_enterview_fullbg.png",
}
SKIP = {"1.0", "1.1", "1.2", "1.8", "2.8"}  # 쓸 만한 통짜 그림이 없음 (레이어로 나뉘어 있거나 배경뿐)


def read(cn, rel):
    p = os.path.join(cn, rel)
    if os.path.exists(p):
        return open(p, "rb").read()
    try:
        return subprocess.run(["git", "-C", cn, "show", f"HEAD:{rel}"], capture_output=True, check=True, timeout=180).stdout
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cn", required=True)
    ap.add_argument("--out", default=".")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    O = a.out
    vers = set()
    for name in ("characters", "stories", "versions"):
        p = os.path.join(O, "data", "game", f"{name}.json")
        if os.path.exists(p):
            for x in json.load(open(p, encoding="utf-8")):
                v = x.get("version") if name != "versions" else x.get("id")
                if v:
                    vers.add(v)
    vers |= set(OVERRIDE)
    art_path = os.path.join(O, "data", "game", "version-art.json")
    art = json.load(open(art_path)) if os.path.exists(art_path) else {}
    for v in sorted(vers):
        if v in SKIP:
            continue
        rel = OVERRIDE.get(v)
        if not rel:
            try:
                n, m = v.split(".")
                int(n), int(m)
            except ValueError:
                continue
            rel = f"singlebg/v{n}a{m}_mainactivity_singlebg/v{n}a{m}_enterview_fullbg.png"
        dst = f"assets/img/ver/{v}/key.webp"
        if not a.force and v in art and os.path.exists(os.path.join(O, dst)):
            continue
        data = read(a.cn, rel)
        if not data:
            continue
        try:
            im = Image.open(io.BytesIO(data)).convert("RGB")
        except Exception:
            continue
        if im.width > 1920:
            im = im.resize((1920, round(im.height * 1920 / im.width)), Image.LANCZOS)
        os.makedirs(os.path.join(O, os.path.dirname(dst)), exist_ok=True)
        im.save(os.path.join(O, dst), "WEBP", quality=86, method=6)
        art[v] = dst
        print(f"✓ {v} ← {rel}")
    with open(art_path, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(art.items())), f, ensure_ascii=False, indent=0)
    print(f"버전 대표 그림 {len(art)}개")


if __name__ == "__main__":
    main()
