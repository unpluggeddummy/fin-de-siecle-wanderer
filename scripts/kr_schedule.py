#!/usr/bin/env python3
"""한섭 버전·픽업 기간을 시뮬레이터(reverse1999-simulator.com, 한섭 기준) 미래시 페이지에서 읽어 붙인다.

  python scripts/kr_schedule.py --out .            # 페이지를 받아서
  python scripts/kr_schedule.py --out . --html x   # 저장한 HTML/텍스트로

- 버전: periods.kr = "2026-09-24 ~ 2026-11-05", title.ko 는 한섭 이름으로 (미래 버전도 이름만)
- 오늘이 한섭 기간 안에 든 버전을 meta.krVersion(지금 한섭 버전)으로
- 픽업 배너: 같은 버전에서 6성이 같은 배너에 kr = "2026-09-24 ~ 2026-10-15"
- 지금 한섭 버전보다 뒤 버전은 날짜를 올리지 않는다 (미래시 날짜는 사이트에 올리지 않음)
- 페이지 모양이 바뀌어 못 읽으면 아무것도 바꾸지 않는다
"""
import argparse
import html as H
import json
import os
import re

URL = "https://www.reverse1999-simulator.com/ko/future_insight"
D = r"(\d{4}-\d{2}-\d{2})"


def vnum(v):
    m = re.match(r"^(\d+)\.(\d+)$", v or "")
    return int(m.group(1)) * 100 + int(m.group(2)) if m else None


def text_of(raw):
    raw = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw)
    t = H.unescape(re.sub(r"<[^>]+>", "\n", raw))
    return re.sub(r"[ \t\r\f\v]*\n[\s]*", "\n", t)


def parse(t):
    vers, pick = {}, []
    # 버전 블록: v3.8 \n 세기말의 척도 \n 진행중 ... 2026-09-24 ~ 2026-11-05
    parts = re.split(r"\n(?=v\d+\.\d+\n)", "\n" + t)
    for p in parts:
        m = re.match(r"\s*v(\d+\.\d+)\n(.+?)\n", p)
        if not m:
            continue
        vid, title = m.group(1), m.group(2).strip()
        d = re.search(D + r"\s*~\s*" + D, p)
        if d:
            vers[vid] = {"title": title if not re.search(r"\d{4}-|진행|예정|종료", title) else None,
                         "kr": f"{d.group(1)} ~ {d.group(2)}"}
    for m in re.finditer(r"\[(\d+\.\d+)\]\s*([^\[\]\n]+?)\s*픽업\s*" + D + r"\s*~\s*" + D, t):
        pick.append({"v": m.group(1), "name": m.group(2).strip(), "kr": f"{m.group(3)} ~ {m.group(4)}"})
    return vers, pick


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=".")
    ap.add_argument("--html", default=None)
    a = ap.parse_args()
    if a.html:
        raw = open(a.html, encoding="utf-8").read()
    else:
        import requests
        r = requests.get(URL, headers={"User-Agent": "Mozilla/5.0 (fin-de-siecle-wanderer personal archive)"}, timeout=60)
        r.raise_for_status()
        raw = r.text
    vers, pick = parse(text_of(raw))
    if not vers and not pick:
        print("한섭 일정: 페이지에서 읽은 게 없어 건너뜁니다.")
        return

    G = os.path.join(a.out, "data", "game")
    meta = json.load(open(os.path.join(G, "meta.json"), encoding="utf-8"))
    cur = vnum(meta.get("krVersion")) or 0
    # 오늘(한국 시간)이 한섭 기간 안에 든 버전이 지금 버전 — 게임 데이터보다 앞서 있으면 이걸로 올린다
    from datetime import datetime, timedelta, timezone
    today = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d")
    for vid, x in vers.items():
        a_, b_ = x["kr"].split(" ~ ")
        if a_ <= today < b_ and (vnum(vid) or 0) > cur:
            print(f"한섭 지금 버전: {meta.get('krVersion')} → {vid} (기간 {x['kr']})")
            meta["krVersion"], cur = vid, vnum(vid)
            with open(os.path.join(G, "meta.json"), "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False, indent=1)
    chars = json.load(open(os.path.join(G, "characters.json"), encoding="utf-8"))
    name_of = {c["id"]: (c.get("name") or {}).get("ko") for c in chars}
    vp = os.path.join(G, "versions.json")
    versions = json.load(open(vp, encoding="utf-8"))
    by = {v["id"]: v for v in versions}
    nv = ns = 0
    for vid, x in vers.items():
        v = by.get(vid)
        if not v:
            # 위키에 아직 버전 문서가 없는 버전(스토리·출품작에만 있는 3.9 등): 한섭 이름·기간만 담은 빈 칸을 만든다
            if not x["title"]:
                continue
            v = {"id": vid, "title": {}, "periods": {}, "newChars": [], "events": [], "summons": [], "garments": [], "stub": True}
            versions.append(v)
            by[vid] = v
        # 버전 이름은 한섭 이름으로 (미래 버전도 이름만은 바꾼다 — 영어 이름보다 낫다)
        if x["title"] and (v.get("title") or {}).get("ko") != x["title"]:
            v.setdefault("title", {})["ko"] = x["title"]
            print(f"  {vid} 이름 → {x['title']}")
        if (vnum(vid) or 0) > cur:
            continue  # 미래 버전의 날짜는 올리지 않음
        v.setdefault("periods", {})["kr"] = x["kr"]
        nv += 1
    for x in pick:
        v = by.get(x["v"])
        if not v or (vnum(x["v"]) or 0) > cur:
            continue
        key = re.sub(r"\s", "", x["name"])
        for s in v.get("summons", []):
            if s.get("kind", "pickup") in ("pickup", "collab") and not s.get("rerun") and s.get("six") \
                    and re.sub(r"\s", "", name_of.get(s["six"][0]) or "") == key:
                s["kr"] = x["kr"]
                ns += 1
    with open(vp, "w", encoding="utf-8") as f:
        json.dump(versions, f, ensure_ascii=False, separators=(",", ":"))
    print(f"한섭 일정: 버전 {nv}개 · 픽업 배너 {ns}개 기간 반영")


if __name__ == "__main__":
    main()
