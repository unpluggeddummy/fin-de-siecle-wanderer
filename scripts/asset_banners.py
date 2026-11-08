#!/usr/bin/env python3
"""
게임 데이터(모집 풀)에 아직 없는 버전의 모집 배너를 중섭 에셋의 배너 원화로 만든다.

  python scripts/asset_banners.py --cn ../src/cn --out .

- 대상: 처음 열린 픽업·고르기 배너 (게임 데이터 versions.json + 손으로 적은 manual-versions.json)
  배경과 인물이 모두 있는 원화만 쓰고, 그렇지 않으면 위키 배너를 그대로 둔다
- 복각 배너는 같은 6성이 처음 등장했을 때의 배너를 그대로 쓴다
- 에셋 폴더: singlebg/summon/heroversion_<버전>/v<X>a<Y>_<이름 병음>/
    픽업  → 6성 출품작 중국어 이름의 병음 (赫多涅 → heduonie)
    호수의 물결(6성 고르기) → *_selfselectsix,  고르기 확률업 → *_selfselectnine
- 배경(_fullbg) 위에 인물(_role)을 얹고, 다른 배너와 같은 16:7 로 잘라 assets/img/summon/a-<배너>.webp 로 저장
- 글자(_txtbg)는 얹지 않는다
그림 출처: 중섭 에셋 / © Bluepoch
"""
import argparse
import difflib
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


def folder_for(cn, vid, s, chars, older=False):
    base = os.path.join(cn, "singlebg", "summon", f"heroversion_{vid.replace('.', '_')}")
    if not os.path.isdir(base):
        return None
    subs = [d for d in os.listdir(base) if os.path.isdir(os.path.join(base, d))]
    kind = s.get("kind")
    if kind == "ripples":
        return next((os.path.join(base, d) for d in subs if d.endswith("selfselectsix")), None)
    if kind == "select":
        return next((os.path.join(base, d) for d in subs if d.endswith("selfselectnine")), None)
    cs = [chars.get(cid) for cid in (s.get("six") or [])]
    for n in s.get("sixNames") or []:
        cs.append(next((c for c in chars.values() if n in (c["name"].get("ko"), c["name"].get("en"))), None))
    keys = []
    for c in filter(None, cs):
        if c["name"].get("zhCN"):
            keys.append(pinyin(c["name"]["zhCN"]))
        en = re.sub(r"[^a-z0-9]", "", (c["name"].get("en") or "").lower())
        if en:
            keys += [en, f"role{en}"]  # 영어 이름 폴더(mercury, tuesday), 숫자 이름(role37, role6)
    root = os.path.join(cn, "singlebg", "summon")
    vn = lambda d: tuple(int(x) for x in re.findall(r"\d+", d)[:2]) if re.match(r"heroversion_\d+_\d+$", d) else (0, 0)
    me = vn(os.path.basename(base))
    # 같은 버전 폴더 → 없으면(복각) 그 이전 버전 폴더를 최신순으로
    others = sorted([d for d in os.listdir(root) if d.startswith("heroversion_") and vn(d) < me], key=vn, reverse=True) if older else []

    def score(t, k):
        if t == k:
            return 3
        if len(t) >= 4 and (k.endswith(t) or k.startswith(t)):  # 红弩箭 → hongnujian, wennifuleide → wenni
            return 2
        if len(t) >= 5 and difflib.SequenceMatcher(None, t, k).ratio() >= 0.8:  # jiaxika ≈ jiexika
            return 1
        return 0
    for b in [base] + [os.path.join(root, d) for d in others]:
        ss = [d for d in os.listdir(b) if os.path.isdir(os.path.join(b, d))]
        best = max(((score(d.split("_", 1)[-1].lower() if d.startswith("v") and "_" in d else d.lower(), k), d) for d in ss for k in keys), default=(0, None))
        if best[0]:
            return os.path.join(b, best[1])
    return None


def pick(folder, part):
    fs = sorted(glob.glob(os.path.join(folder, f"*_{part}.png")))
    # 글자(NAVIGATOR 같은 제목)가 없는 halfview 배경이 있으면 그쪽을 먼저
    fs.sort(key=lambda f: 0 if "halfview" in os.path.basename(f) else 1)
    return fs[0] if fs else None


def layers(folder):
    """배너 폴더의 층을 그리는 순서대로: 배경 → 장식 배경 → 인물 배경 → 인물.
    파일 이름이 버전마다 달라서(role, role1~3, rolebg, roel 오타 등) 넓게 잡는다. 글자(txt) 층은 뺀다."""
    fs = [os.path.basename(f) for f in glob.glob(os.path.join(folder, "*.png"))]
    fs = [f for f in fs if "txt" not in f and "_bu" not in f and "filter" not in f and "ring" not in f and "piaodai" not in f]
    bgs = sorted([f for f in fs if re.search(r"_fullbg\.png$", f)], key=lambda f: 0 if "halfview" in f else 1)
    base = bgs[0] if bgs else None
    order = []
    for pat in (r"_decbg\d*\.png$", r"_rolebg\d*\.png$", r"_(role|roel)\d*\.png$"):
        got = sorted([f for f in fs if re.search(pat, f) and "halfview" not in f])
        # role 와 role01 처럼 0 으로 시작하는 번호는 같은 인물의 다른 상태 — 번호 없는 것만 쓴다
        if any(not re.search(r"\d\.png$", f) for f in got):
            got = [f for f in got if not re.search(r"_\w*?0\d\.png$", f)]
        order += got
    return base, order


# 호수의 물결(6성 고르기)·고르기 확률업 배너는 버전마다 인물만 바뀌고 배경은 2.2 때 것을 계속 쓴다
SHARED_BG = {"selfselectsix": "v2a2_selfselectsix_summon_fullbg.png", "selfselectnine": "v2a2_selfselectsix_summon_fullbg2.png"}


def shared_bg(folder):
    for k, f in SHARED_BG.items():
        if os.path.basename(folder).endswith(k):
            p = os.path.join(os.path.dirname(os.path.dirname(folder)), "heroversion_2_2", "selfselectsix", f)
            if os.path.exists(p):
                return p
    return None


def compose(folder):
    base, order = layers(folder)
    if not base and not order:
        return None
    sb = shared_bg(folder)
    if sb:  # 고르기 배너: 배경은 가장 잘 어울리는 2.2 호수의 물결 배경 하나로 통일 (버전별 배경·글자 층은 쓰지 않음)
        base = None
        order = [f for f in order if re.search(r"_(role|roel)\d*\.png$", f)]
    if base or sb:
        bg = Image.open(os.path.join(folder, base) if base else sb).convert("RGBA")
    else:  # 고르기 배너처럼 배경이 따로 없으면 사이트 바탕색에 가까운 어두운 판
        r0 = Image.open(os.path.join(folder, order[0]))
        bg = Image.new("RGBA", (max(r0.width, round(r0.height * 16 / 7)), r0.height), (20, 17, 13, 255))
    for f in order:
        layer = Image.open(os.path.join(folder, f)).convert("RGBA")
        # 층은 화면 높이에 맞춰 그려져 있다 — 배경 높이에 맞추면 잘린 경계가 생기지 않는다
        if base and layer.height != bg.height and layer.height > bg.height * 0.6:
            layer = layer.resize((round(layer.width * bg.height / layer.height), bg.height), Image.LANCZOS)
        elif layer.height > bg.height:
            layer = layer.resize((round(layer.width * bg.height / layer.height), bg.height), Image.LANCZOS)
        bg.alpha_composite(layer, ((bg.width - layer.width) // 2, bg.height - layer.height))
    # 16:7 로 가운데 자르기
    w = min(bg.width, round(bg.height * 16 / 7))
    h = min(bg.height, round(w * 7 / 16))
    x, y = (bg.width - w) // 2, (bg.height - h) // 2
    im = bg.crop((x, y, x + w, y + h)).convert("RGB")
    if im.width > 1200:
        im = im.resize((1200, round(im.height * 1200 / im.width)), Image.LANCZOS)
    return im


def is_full(folder, kind):
    """배경과 인물이 모두 있는 '완성된' 배너인지. 고르기 배너는 인물 단체 그림만 있어도 된다."""
    base, order = layers(folder)
    roles = [f for f in order if re.search(r"_(role|roel|rolebg)\d*\.png$", f)]
    has_role = bool(roles)
    if shared_bg(folder) and len(roles) > 1:
        return False  # 인물이 여러 장으로 나뉜 고르기 배너는 자리를 알 수 없어서 위키 배너를 그대로 둔다
    return has_role and (base is not None or kind in ("ripples", "select"))


def vkey(vid):
    m = re.match(r"^(\d+)\.(\d+)$", vid)
    return int(m.group(1)) * 100 + int(m.group(2)) if m else {"S01": 300.5, "S02": 308.5}.get(vid, 999)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cn", required=True)
    ap.add_argument("--out", default=".")
    a = ap.parse_args()
    G = os.path.join(a.out, "data", "game")
    mp, vp = os.path.join(G, "manual-versions.json"), os.path.join(G, "versions.json")
    manual = json.load(open(mp, encoding="utf-8"))
    versions = json.load(open(vp, encoding="utf-8"))
    chars = {c["id"]: c for c in json.load(open(os.path.join(G, "characters.json"), encoding="utf-8"))}
    game_ids = {v["id"] for v in versions if v.get("summons") and not v.get("stub")}
    vlist = [v for v in versions if v.get("summons")] + [v for v in manual.get("versions", []) if v["id"] not in game_ids]
    vlist.sort(key=lambda v: vkey(v["id"]))
    got = 0

    # 1) 처음 열린 배너(복각 아님): 그 버전 폴더의 원화로
    for v in vlist:
        for s in v.get("summons", []):
            if s.get("rerun") or s.get("kind") not in ("pickup", "collab", "ripples", "select"):
                continue
            if s.get("bannerSrc") not in (None, "asset", "bilibili", "wiki", "game") and s.get("banner"):
                continue
            folder = folder_for(a.cn, v["id"], s, chars)
            if not folder or not is_full(folder, s.get("kind")):
                continue
            rel = f"assets/img/summon/a5-{re.sub(r'[^0-9a-z.-]', '-', s['id'].lower())}.webp"
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

    # 2) 복각: 같은 6성이 처음 등장했을 때의 배너를 그대로
    first = {}
    for v in vlist:
        for s in v.get("summons", []):
            key = tuple(sorted(s.get("six") or []))
            if not key or s.get("kind") not in ("pickup", "collab"):
                continue
            if not s.get("rerun") and s.get("banner") and key not in first:
                first[key] = (s["banner"], s.get("bannerSrc"))
            elif s.get("rerun") and key in first and s.get("bannerSrc") in (None, "asset", "wiki", "game", "rerun") and s.get("banner") != first[key][0]:
                s["banner"], s["bannerSrc"] = first[key][0], "rerun"
                got += 1

    with open(mp, "w", encoding="utf-8") as f:
        json.dump(manual, f, ensure_ascii=False, indent=1)
        f.write("\n")
    with open(vp, "w", encoding="utf-8") as f:
        json.dump(versions, f, ensure_ascii=False, separators=(",", ":"))
    print(f"에셋 배너 {got}개 붙임")


if __name__ == "__main__":
    main()
