#!/usr/bin/env python3
"""게임 속 출품작 '전시 정보'(한국어)를 data/game/profiles.json 에 더한다.

  python3 scripts/game_profiles.py --global <re1999-data-global 폴더> --out .

- exhibit: 전시 소개 (언제 어디서 출품됐는지)
- size / heightCm: 규격(인치) 원문과, 첫 숫자(키)를 cm로 바꾼 값
- medium / scent / inspiration: 매개체, 조향 노트, 영감 (한국어)
"""
import argparse
import json
import os
import re
import subprocess
from fractions import Fraction


def load(G, name):
    p = os.path.join(G, "data", "json", f"{name}.json")
    if os.path.exists(p):
        return json.load(open(p, encoding="utf-8"))
    return json.loads(subprocess.run(["git", "-C", G, "show", f"HEAD:data/json/{name}.json"], capture_output=True, check=True).stdout)


def inches(s):
    m = re.match(r"\s*(\d+)(?:\s+(\d+)\s*/\s*(\d+))?", s)
    if not m:
        return None
    v = Fraction(int(m.group(1)))
    if m.group(2):
        v += Fraction(int(m.group(2)), int(m.group(3)))
    return float(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--global", dest="G", required=True)
    ap.add_argument("--out", default=".")
    a = ap.parse_args()
    lp = os.path.join(a.G, "data", "configs", "language", "language_kr.json")
    kr = {x["key"]: x["content"] for x in json.load(open(lp, encoding="utf-8"))}
    path = os.path.join(a.out, "data", "game", "profiles.json")
    prof = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
    n = 0
    for x in load(a.G, "character_data"):
        if x.get("type") != 1:
            continue
        t = kr.get(x.get("text")) or ""
        if "규격" not in t:
            continue
        parts = [p.strip() for p in re.split(r"\\&", t)]
        rec = prof.setdefault(str(x["heroId"]), {})
        rec["exhibit"] = re.sub(r"\s*\n\s*", " ", parts[0]).strip()
        for p in parts[1:]:
            m = re.match(r"([^：:]+)[：:]\s*(.*)", p, re.S)
            if not m:
                continue
            k, v = m.group(1).strip(), re.sub(r"\s*\n\s*", " ", m.group(2)).strip()
            if k == "규격":
                rec["size"] = v
                h = inches(v)
                if h:
                    rec["heightCm"] = round(h * 2.54, 1)
            elif k.startswith("매개"):
                rec["medium"] = v
            elif k.startswith("조향"):
                rec["scent"] = v
            elif k.startswith("영감"):
                rec["inspiration"] = v
        n += 1
    with open(path, "w", encoding="utf-8") as f:
        json.dump(prof, f, ensure_ascii=False, separators=(",", ":"))
    hs = sorted(v["heightCm"] for v in prof.values() if v.get("heightCm"))
    print(f"전시 정보 {n}명 · 키 {len(hs)}명 ({hs[0] if hs else '-'}~{hs[-1] if hs else '-'}cm)")


if __name__ == "__main__":
    main()
