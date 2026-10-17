#!/usr/bin/env python3
"""
시뮬레이터(reverse1999-simulator.com, 한섭 기준)에서 정리한 자료(data/raw/simulator_data.json)를
data/game/characters.json · skins.json 에 덮어 쓴다.

- 출품작: 출시 버전(콜라보 포함), 역할(공격·방어·밸런스·보조), 한국어 이름
- 스킨: 버전, 등급(Garment / Advanced / Unique), 획득처(판매·컨텐츠·주크박스·무료·콜라보 판매), 타로 번호
- 게임 데이터에 아직 없는 한섭 스킨은 이미지 없이 목록에만 추가한다

  python scripts/apply_simulator.py --out .
"""
import argparse
import json
import os
import re

EN_KO = {"Drake": "드레이크", "Hedone": "헤도네", "Huntsworn Lilya": "헌츠원 릴리아", "Narcissus": "나르키소스",
         "<호숫가의 여인>": "호숫가의 여인", "Glyndŵr": "글린두르"}
# 게임 데이터 이름 ↔ 시뮬레이터 이름이 다른 스킨 (출품작, 게임 데이터 스킨 이름) → 시뮬레이터 스킨 이름
SKIN_ALIAS = {("헌츠원 릴리아", "虹色冠冕"): "무지갯빛 왕관", ("찰리", "찰리"): "거울 속 인터루드"}
SOURCE_CAT = {"판매": "shop", "컨텐츠": "content", "주크박스": "jukebox", "무료": "free", "콜라보 판매": "collab"}
GRADE = {"Garment": "Garment", "Advanced Garment": "Advanced", "Unique": "Unique"}


def norm(t):
    return re.sub(r"[\s'‘’\"“”·.,!?~\-()（）]", "", t or "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=".")
    a = ap.parse_args()
    src = os.path.join(a.out, "data", "raw", "simulator_data.json")
    if not os.path.exists(src):
        print("시뮬레이터 자료가 없어 건너뜁니다.")
        return
    sim = json.load(open(src, encoding="utf-8"))
    cp = os.path.join(a.out, "data", "game", "characters.json")
    sp = os.path.join(a.out, "data", "game", "skins.json")
    chars = json.load(open(cp, encoding="utf-8"))
    skins = json.load(open(sp, encoding="utf-8"))

    def ko(c):
        return EN_KO.get(c["name"]["ko"], c["name"]["ko"])

    by_name = {ko(c): c for c in chars}
    sim_chars = {x["name"]: x for x in sim.get("characters", [])}
    for name, x in sim_chars.items():
        c = by_name.get(name)
        if not c:
            continue
        if c["name"]["ko"] != name:
            c["name"]["ko"] = name
            c["nameChecked"] = True
        c["version"] = x.get("version") or c.get("version")
        c["versionEstimated"] = False
        c["role"] = x.get("role")
        c["released"] = True

    idx = {}
    for s in skins:
        c = next((c for c in chars if c["id"] == s["char"]), None)
        if not c:
            continue
        nm = SKIN_ALIAS.get((ko(c), s["name"]), s["name"])
        idx[(ko(c), norm(nm))] = s
    added = 0
    for x in sim.get("skins", []):
        if x.get("type") == "Insight":
            continue
        s = idx.get((x["character"], norm(x["name"])))
        if not s:
            c = by_name.get(x["character"])
            if not c:
                continue
            s = {"id": 9000000 + int(x["id"]), "char": c["id"], "type": "shop", "name": x["name"], "nameEn": "",
                 "rare": 0, "gain": None, "portrait": None, "art": None, "noImage": True,
                 "series": "", "seriesGroup": "", "order": None}
            skins.append(s)
            c.setdefault("skins", []).append(s["id"])
            added += 1
        s["version"] = x.get("version")
        s["grade"] = GRADE.get(x.get("type"), s.get("grade"))
        s["source"] = x.get("source")
        s["tarot"] = x.get("tarot")
        s["simId"] = x.get("id")
        if s["name"] != x["name"]:
            s["nameGame"] = s["name"]
            s["name"] = x["name"]
        if x.get("tarot") is not None:
            s["cat"] = "tarot"
        elif x.get("source") == "콜라보 판매" or s.get("cat") == "collab":
            s["cat"] = "collab"
        elif s.get("cat") in ("dushuo", "anniv"):
            pass
        else:
            s["cat"] = SOURCE_CAT.get(x.get("source"), s.get("cat") or "shop")
    for s in skins:  # 시뮬레이터에 없는 나머지 스킨의 숫자 등급은 비운다
        if isinstance(s.get("grade"), int):
            s["grade"] = None
    for f, d in ((cp, chars), (sp, skins)):
        with open(f, "w", encoding="utf-8") as fh:
            json.dump(d, fh, ensure_ascii=False, indent=1)
            fh.write("\n")
    print(f"시뮬레이터 자료 반영: 출품작 {len(sim_chars)} · 스킨 {len(sim.get('skins', []))} (이미지 없는 신규 스킨 {added}개 추가)")


if __name__ == "__main__":
    main()
