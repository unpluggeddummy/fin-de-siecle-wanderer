#!/usr/bin/env python3
"""모집 배너를 게임 데이터(글로벌 = 한섭)에서 버전별로 만든다. 위키에 없는 버전·배너도 채운다.

  python3 scripts/summons_from_game.py --global <re1999-data-global> --cn <Reverse-1999-CN-Asset> --out .

- 배너 풀 번호 앞자리가 버전이다: 38111 → 3.8, 385111 → S02(3.8 뒤 콜라보), 305111 → S01
- 한정 픽업, 콜라보, 호수의 물결(6성 1명 고르기), 호수의 승낙·선물·계시·추억(고르기 확률업), 바람의 호수(2명 확률업)
- 배너 그림: 게임 원본(중섭 에셋)의 singlebg/summon/banner/<배너>.png
- data/game/versions.json 에 버전별 summons 로 합친다 (위키 배너와 같은 풀/이름이면 건너뜀)
- data/game/meta.json 에 krVersion(지금 한섭 버전 = 게임 데이터에 들어온 가장 최신 버전)을 적는다
"""
import argparse
import json
import os
import re
import subprocess

try:
    from PIL import Image
except ImportError:  # 그림 없이도 데이터는 만든다
    Image = None

COLLAB_PREFIX = {"305": "S01", "385": "S02"}
KIND = {3: "pickup", 6: "pickup", 21: "collab", 12: "ripples", 7: "select", 202: "double", 4: "special"}
KIND_KO = {"pickup": "한정 픽업", "collab": "콜라보 픽업", "ripples": "6성 1명 고르기", "select": "고르기 확률업",
           "double": "6성 2명 확률업", "special": "특별 모집"}


def load(G, name):
    for p in (os.path.join(G, "data", "json", f"{name}.json"), os.path.join(G, "json", f"{name}.json")):
        if os.path.exists(p):
            return json.load(open(p, encoding="utf-8"))
    out = subprocess.run(["git", "-C", G, "show", f"HEAD:data/json/{name}.json"], capture_output=True, check=True).stdout
    return json.loads(out)


def version_of(pid):
    s = str(pid)
    if len(s) == 6 and s[:3] in COLLAB_PREFIX:
        return COLLAB_PREFIX[s[:3]]
    if len(s) == 5:
        return f"{s[0]}.{s[1]}"
    return None


def vnum(v):
    if v in ("S01",):
        return 300.5
    if v in ("S02",):
        return 308.5
    a, b = v.split(".")
    return int(a) * 100 + int(b)


def clean(t):
    return re.sub(r"<[^>]+>", "", t or "").replace(" ", " ").strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--global", dest="G", required=True)
    ap.add_argument("--cn", default=None)
    ap.add_argument("--out", default=".")
    a = ap.parse_args()
    G = a.G
    lp = os.path.join(G, "data", "configs", "language", "language_kr.json")
    if not os.path.exists(lp):
        lp = os.path.join(G, "configs", "language", "language_kr.json")
    kr = {x["key"]: x["content"] for x in json.load(open(lp, encoding="utf-8"))}
    tr = lambda k: clean(kr.get(k, k)) if isinstance(k, str) else ""

    pools = []
    for p in load(G, "summon_pool"):
        v = version_of(p["id"])
        kind = KIND.get(p.get("type"))
        if not v or not kind:
            continue
        up = str(p.get("upWeight") or "")
        param = str(p.get("param") or "")
        six, five, choices, pick = [], [], [], None
        if kind in ("pickup", "collab", "special"):
            head, _, tail = up.partition("|")
            six = [int(x) for x in re.findall(r"\d{4}", head)]
            five = [int(x) for x in re.findall(r"\d{4}", tail)]
        elif kind == "double":
            six = [int(x) for x in re.findall(r"\d{4}", up)]
        elif kind == "ripples":
            choices = [int(x) for x in re.findall(r"\d{4}", param)]
            pick = 1
        elif kind == "select":
            m = re.match(r"(\d+)\|", param)
            pick = int(m.group(1)) if m else None
        desc = kr.get(p.get("desc"), p.get("desc") or "")
        half = "전반" if "上半" in desc else "후반" if "下半" in desc else None
        pools.append({"pid": p["id"], "v": v, "kind": kind, "ko": tr(p.get("nameCn")), "en": tr(p.get("nameEn")),
                      "six": six, "five": five, "choices": choices, "pick": pick, "half": half, "art": p.get("banner") or ""})
    pools.sort(key=lambda x: (vnum(x["v"]), x["pid"]))

    # 복각: 같은 6성이 앞 버전에 이미 한정 픽업으로 나왔으면
    seen6 = set()
    for x in pools:
        x["rerun"] = bool(x["six"]) and x["kind"] in ("pickup", "collab") and all(c in seen6 for c in x["six"])
        if x["kind"] in ("pickup", "collab"):
            seen6.update(x["six"])

    # 배너 그림
    made = 0
    def banner_img(x):
        nonlocal made
        if not a.cn or not x["art"]:
            return None
        rel = f"assets/img/summon/{x['pid']}.webp"
        dest = os.path.join(a.out, rel)
        if os.path.exists(dest):
            return rel
        if Image is None:
            return None
        base = os.path.join(a.cn, "singlebg", "summon", "banner")
        for name in (f"{x['art']}.png", f"{x['art']}_0.png", f"{x['art']}_1.png"):
            src = os.path.join(base, name)
            if os.path.exists(src):
                try:
                    im = Image.open(src)
                    im.load()
                    if im.mode not in ("RGB", "RGBA"):
                        im = im.convert("RGBA")
                    if im.width > 960:
                        im = im.resize((960, round(im.height * 960 / im.width)), Image.LANCZOS)
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    im.save(dest, "WEBP", quality=82, method=5)
                    made += 1
                    return rel
                except Exception as e:
                    print(f"  ! 배너 그림 실패 {src}: {e}")
        return None

    vp = os.path.join(a.out, "data", "game", "versions.json")
    versions = json.load(open(vp, encoding="utf-8")) if os.path.exists(vp) else []
    by_id = {v["id"]: v for v in versions}
    norm = lambda s: re.sub(r"[\s()'’\"·:~\-]|복각", "", s or "")
    added = 0
    for x in pools:
        v = by_id.get(x["v"])
        if v is None:
            v = {"id": x["v"], "title": {}, "periods": {}, "newChars": [], "events": [], "summons": [], "garments": [], "gameOnly": True}
            versions.append(v)
            by_id[x["v"]] = v
        sums = v.setdefault("summons", [])
        dup = next((s for s in sums if s.get("pool") == x["pid"] or (x["ko"] and norm((s.get("name") or {}).get("ko")) == norm(x["ko"]))), None)
        if dup:  # 위키 배너에 게임 정보(종류·고르기 목록)만 보탠다
            dup.setdefault("kind", x["kind"])
            if x["choices"] and not dup.get("choices"):
                dup["choices"] = x["choices"]
            if x["pick"] and not dup.get("pick"):
                dup["pick"] = x["pick"]
            if not dup.get("banner"):
                dup["banner"] = banner_img(x)
            continue
        sums.append({
            "id": f"{x['v']}:pool{x['pid']}",
            "name": {"ko": (x["ko"] + (" (복각)" if x["rerun"] else "")) if x["ko"] else None, "en": x["en"]},
            "banner": banner_img(x),
            "time": f"{x['v']} {x['half']}" if x["half"] else None,
            "rerun": x["rerun"], "six": x["six"], "five": x["five"], "pool": x["pid"],
            "kind": x["kind"], "kindKo": KIND_KO[x["kind"]], "choices": x["choices"], "pick": x["pick"], "source": "game",
        })
        added += 1
    for v in versions:
        v["summons"].sort(key=lambda s: (s.get("pool") or 0))
    with open(vp, "w", encoding="utf-8") as f:
        json.dump(versions, f, ensure_ascii=False, separators=(",", ":"))

    # 지금 한섭 버전 = 게임 데이터에 한정 배너가 들어온 가장 최신 번호 버전
    nums = [x["v"] for x in pools if x["kind"] in ("pickup", "collab", "double") and not x["v"].startswith("S")]
    kr_ver = max(nums, key=vnum) if nums else None
    mp = os.path.join(a.out, "data", "game", "meta.json")
    meta = json.load(open(mp, encoding="utf-8")) if os.path.exists(mp) else {}
    if kr_ver:
        meta["krVersion"] = kr_ver
    with open(mp, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print(f"모집 배너: 게임 풀 {len(pools)}개 · 새로 추가 {added}개 · 배너 그림 {made}장 · 지금 한섭 버전 {kr_ver}")


if __name__ == "__main__":
    main()
