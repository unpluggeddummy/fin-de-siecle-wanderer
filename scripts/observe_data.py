#!/usr/bin/env python3
"""갈기의 게시판 · 특별 관찰 자료 만들기

게임 데이터(re1999-data-global)에서
  - 특별 관찰 시즌별 협동 스킬 목록 (activity128_expand_bond)
  - 출품작별 영감(career)·전투 태그(battleTag)
를 읽어 data/game/observe.json 으로 저장한다. 사이트는 이걸로 8명 구성에서 켜지는 협동 스킬을 계산한다.

  python scripts/observe_data.py --global ../src/global --out .
"""
import argparse
import json
import os

ap = argparse.ArgumentParser()
ap.add_argument("--global", dest="glob", required=True)
ap.add_argument("--out", default=".")
a = ap.parse_args()

G = os.path.join(a.glob, "data")
gj = lambda n: json.load(open(os.path.join(G, "json", f"{n}.json"), encoding="utf-8"))
lang = {x["key"]: x["content"] for x in json.load(open(os.path.join(G, "configs", "language", "language_kr.json"), encoding="utf-8"))}
tr = lambda k: (lang.get(k) or "").strip() if isinstance(k, str) else ""

TYPE = {1: "영감", 2: "빌드", 3: "특수"}

seasons = {}
for b in gj("activity128_expand_bond"):
    s = seasons.setdefault(str(b["activityId"]), {"bonds": {}})
    g = s["bonds"].setdefault(b["groupId"], {
        "group": b["groupId"], "type": TYPE.get(b["tagType"], str(b["tagType"])), "name": tr(b["name"]),
        # "1|101" 은 둘 중 하나만 있어도 된다는 뜻
        "tags": [int(x) for x in (b.get("tag1") or b.get("tag2") or "").split("|") if x.strip().isdigit()],
        "levels": [],
    })
    g["levels"].append({"level": b["level"], "need": b["activeNum"], "desc": tr(b["desc"])})
for s in seasons.values():
    for g in s["bonds"].values():
        g["levels"].sort(key=lambda x: x["level"])
    s["bonds"] = sorted(s["bonds"].values(), key=lambda g: g["group"])

chars = {}
for c in gj("character"):
    if not isinstance(c.get("id"), int):
        continue
    tags = [int(x) for x in str(c.get("battleTag") or "").split("#") if x.strip().isdigit()]
    chars[str(c["id"])] = {"career": c.get("career"), "tags": tags}

out = {"_note": "특별 관찰(공동 보도) 협동 스킬과 출품작 태그. scripts/observe_data.py 가 게임 데이터에서 만든다.",
       "seasons": seasons, "chars": chars}
path = os.path.join(a.out, "data", "game", "observe.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(f"특별 관찰 시즌 {len(seasons)} · 출품작 태그 {len(chars)}")
