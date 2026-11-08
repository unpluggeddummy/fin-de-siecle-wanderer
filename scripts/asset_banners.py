#!/usr/bin/env python3
"""
게임 데이터(모집 풀)에 아직 없는 버전의 모집 배너를 중섭 에셋의 배너 원화로 만든다.

  python scripts/asset_banners.py --cn ../src/cn --out .

- 대상: manual-versions.json 의 모집 배너 중 그림이 없거나 빌리빌리 임시 그림인 것
- 에셋 폴더: singlebg/summon/heroversion_<버전>/v<X>a<Y>_<이름 병음>/
    픽업  → 6성 출품작 중국어 이름의 병음 (赫多涅 → heduonie)
    호수의 물결(6성 고르기) → *_selfselectsix,  고르기 확률업 → *_selfselectnine
- 배경(_fullbg) 위에 인물(_role)을 얹고, 다른 배너와 같은 16:7 로 잘라 assets/img/summon/a-<배너>.webp 로 저장
- 글자(_txtbg)는 얹지 않는다. 위키의 영문 배너가 생기면 wiki_banners.py 가 그쪽으로 바꾼다
그림 출처: 중섭 에셋 / © Bluepoch
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys

from PIL import Image


def pinyin(zh):
    try:
        from pypinyin import lazy_pinyin
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "pypinyin"])
        from pypinyin import lazy_pinyin
    return "".join(lazy_pinyin(zh)).lower()


def folder_for(cn, vid, s, chars):
    base = os.path.join(cn, "singlebg", "summon", f"heroversion_{vid.replace('.', '_')}")
    if not os.path.isdir(base):
        return None
    subs = [d for d in os.listdir(base) if os.path.isdir(os.path.join(base, d))]
    kind = s.get("kind")
    if kind == "ripples":
        return next((os.path.join(base, d) for d in subs if d.endswith("selfselectsix")), None)
    if kind == "select":
        return next((os.path.join(base, d) for d in subs if d.endswith("selfselectnine")), None)
    zh = []
    for cid in s.get("six") or []:
        c = chars.get(cid)
        if c and c["name"].get("zhCN"):
            zh.append(c["name"]["zhCN"])
    for n in s.get("sixNames") or []:
        c = next((c for c in chars.values() if n in (c["name"].get("ko"), c["name"].get("en"))), None)
        if c and c["name"].get("zhCN"):
            zh.append(c["name"]["zhCN"])
    for z in zh:
        py = pinyin(z)
        # 폴더 이름은 이름 전체(赫多涅 → heduonie)이거나 이름 끝부분(狩勋女巫红弩箭 → hongnujian)
        hits = [d for d in subs if (lambda t: t == py or (len(t) >= 4 and py.endswith(t)))(d.split("_", 1)[-1])]
        if hits:
            return os.path.join(base, max(hits, key=len))
    return None


def pick(folder, part):
    fs = sorted(glob.glob(os.path.join(folder, f"*_{part}.png")))
    return fs[0] if fs else None


def compose(folder):
    bg_p, role_p = pick(folder, "fullbg"), pick(folder, "role")
    if not role_p and not bg_p:
        return None
    role = Image.open(role_p).convert("RGBA") if role_p else Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    if bg_p:
        bg = Image.open(bg_p).convert("RGBA")
    else:  # 고르기 배너처럼 배경이 따로 없으면 사이트 바탕색에 가까운 어두운 판
        bg = Image.new("RGBA", (max(role.width, round(role.height * 16 / 7)), role.height), (20, 17, 13, 255))
    if role.height > bg.height:
        role = role.resize((round(role.width * bg.height / role.height), bg.height), Image.LANCZOS)
    bg.alpha_composite(role, ((bg.width - role.width) // 2, bg.height - role.height))
    # 16:7 로 가운데 자르기
    w = min(bg.width, round(bg.height * 16 / 7))
    h = min(bg.height, round(w * 7 / 16))
    x, y = (bg.width - w) // 2, (bg.height - h) // 2
    im = bg.crop((x, y, x + w, y + h)).convert("RGB")
    if im.width > 1200:
        im = im.resize((1200, round(im.height * 1200 / im.width)), Image.LANCZOS)
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cn", required=True)
    ap.add_argument("--out", default=".")
    a = ap.parse_args()
    G = os.path.join(a.out, "data", "game")
    mp = os.path.join(G, "manual-versions.json")
    manual = json.load(open(mp, encoding="utf-8"))
    chars = {c["id"]: c for c in json.load(open(os.path.join(G, "characters.json"), encoding="utf-8"))}
    game_ids = {v["id"] for v in json.load(open(os.path.join(G, "versions.json"), encoding="utf-8")) if v.get("summons") and not v.get("stub")}
    got = 0
    for v in manual.get("versions", []):
        if v["id"] in game_ids:
            continue
        for s in v.get("summons", []):
            if s.get("banner") and s.get("bannerSrc") not in ("bilibili", "asset"):
                continue
            folder = folder_for(a.cn, v["id"], s, chars)
            if not folder:
                continue
            rel = f"assets/img/summon/a-{re.sub(r'[^0-9a-z.-]', '-', s['id'].lower())}.webp"
            dest = os.path.join(a.out, rel)
            if not os.path.exists(dest):
                im = compose(folder)
                if im is None:
                    continue
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                im.save(dest, "WEBP", quality=84, method=5)
            if s.get("banner") != rel:
                s["banner"], s["bannerSrc"] = rel, "asset"
                got += 1
                print(f"  + {v['id']} {(s.get('name') or {}).get('ko')} ← {os.path.basename(folder)}")
    if got:
        with open(mp, "w", encoding="utf-8") as f:
            json.dump(manual, f, ensure_ascii=False, indent=1)
            f.write("\n")
    print(f"에셋 배너 {got}개 붙임")


if __name__ == "__main__":
    main()
