#!/usr/bin/env python3
"""출품작 스킬·형상·통찰·광상 설명을 게임 데이터(글로벌 한국어)에서 모아 data/game/skills.json 으로 만든다.

  python3 scripts/build_skills.py --global <re1999-data-global 폴더> --out .

- 주문 1·2: 카드 1/2/3단계 설명
- 최종 술식(궁극기)
- 통찰 패시브 (통찰 단계별)
- 형상 1~5: 형상을 올리면 바뀌는 점 (▩1%s 등은 주문 이름으로 바꿔 쓴다)
- 광상: 광상 단계별 설명
- 용어: 설명에 나오는 [괄호 용어]의 뜻
글로벌에 아직 없는 출품작(한섭 선행)은 빠진다.
"""
import argparse
import json
import os
import re
import subprocess


def load(G, name):
    for p in (os.path.join(G, "data", "json", f"{name}.json"), os.path.join(G, "json", f"{name}.json")):
        if os.path.exists(p):
            return json.load(open(p, encoding="utf-8"))
    # sparse 저장소면 git show 로 꺼낸다
    out = subprocess.run(["git", "-C", G, "show", f"HEAD:data/json/{name}.json"], capture_output=True, check=True).stdout
    return json.loads(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--global", dest="G", required=True)
    ap.add_argument("--out", default=".")
    a = ap.parse_args()
    G = a.G
    lp = os.path.join(G, "data", "configs", "language", "language_kr.json")
    if not os.path.exists(lp):
        lp = os.path.join(G, "configs", "language", "language_kr.json")
    kr = {x["key"]: x["content"] for x in json.load(open(lp, encoding="utf-8"))}

    chars = load(G, "character")
    skill = {s["id"]: s for s in load(G, "skill")}
    effect = {e["id"]: e for e in load(G, "skill_effect")}
    ex_level = load(G, "skill_ex_level")
    passive = load(G, "skill_passive_level")
    facets = load(G, "character_destiny_facets")
    effdesc = load(G, "skill_eff_desc")

    def tr(k):
        return kr.get(k) if isinstance(k, str) else None

    def clean(t, names=None):
        if not t:
            return ""
        t = re.sub(r"<id:\d+>", "", t)
        t = re.sub(r"</?color[^>]*>|</?b>|</?i>|</?size[^>]*>|<u>|</u>|<nobr>|</nobr>", "", t)
        t = re.sub(r"\{([^}]*)\}", r"\1", t)
        if names:
            t = re.sub(r"▩(\d)%s", lambda m: f"[{names.get(m.group(1), '주문')}] " if names.get(m.group(1)) else "", t)
        t = t.replace("▩", "")
        # 게임 UI용 줄바꿈 정리: 문장 중간 줄바꿈은 붙이고, 문장 끝 줄바꿈은 살린다
        t = re.sub(r"(?<![.。!?:])\n(?!\n)", " ", t)
        t = re.sub(r"[ \t]+", " ", t)
        return t.strip()

    def skill_text(sid):
        s = skill.get(int(sid))
        if not s:
            return None, None
        e = effect.get(s.get("skillEffect"))
        return tr(s.get("name")), tr(e.get("desc")) if e else None

    glossary_all = {}
    for d in effdesc:
        n, ds = tr(d.get("name")), tr(d.get("desc"))
        if n and ds and n not in glossary_all:
            glossary_all[n.strip()] = clean(ds)

    out = {}
    used_terms = set()
    by_hero_ex = {}
    for x in ex_level:
        by_hero_ex.setdefault(x["heroId"], []).append(x)
    by_hero_pa = {}
    for x in passive:
        by_hero_pa.setdefault(x["heroId"], []).append(x)
    by_hero_fa = {}
    for x in facets:
        by_hero_fa.setdefault(x["facetsId"] // 100, {}).setdefault(x["facetsId"], []).append(x)

    for c in chars:
        hid = c["id"]
        if not c.get("skill"):
            continue
        rec = {"skills": [], "ultimate": None, "insight": [], "portray": [], "euphoria": []}
        names = {}
        for i, part in enumerate(c["skill"].split("|")):
            ids = [p for p in part.split("#")[1:] if p.isdigit()]
            lv = []
            nm = None
            for sid in ids:
                n, d = skill_text(sid)
                nm = nm or n
                lv.append(d)
            names[str(i + 1)] = nm
            rec["skills"].append({"name": nm, "levels": lv})
        if c.get("exSkill"):
            n, d = skill_text(c["exSkill"])
            names["3"] = n
            rec["ultimate"] = {"name": n, "desc": d}
        for x in sorted(by_hero_pa.get(hid, []), key=lambda x: x["skillLevel"]):
            n, d = skill_text(x["skillPassive"])
            rec["insight"].append({"lv": x["skillLevel"], "name": n, "desc": d})
        for x in sorted(by_hero_ex.get(hid, []), key=lambda x: x["skillLevel"]):
            rec["portray"].append({"lv": x["skillLevel"], "desc": tr(x.get("desc"))})
        for fid, rows in sorted(by_hero_fa.get(hid, {}).items()):
            rec["euphoria"].append({"id": fid % 100, "levels": [{"lv": r["level"], "desc": tr(r.get("desc"))} for r in sorted(rows, key=lambda r: r["level"])]})

        # 글자 정리 + 쓰인 용어 모으기
        def fix(t):
            t = clean(t, names)
            for m in re.findall(r"\[([^\]]{1,20})\]", t):
                used_terms.add(m.strip())
            return t
        for s in rec["skills"]:
            s["levels"] = [fix(t) for t in s["levels"]]
        if rec["ultimate"]:
            rec["ultimate"]["desc"] = fix(rec["ultimate"]["desc"])
        for p in rec["insight"]:
            p["desc"] = fix(p["desc"])
        for p in rec["portray"]:
            p["desc"] = fix(p["desc"])
        for e in rec["euphoria"]:
            for l in e["levels"]:
                l["desc"] = fix(l["desc"])
        out[str(hid)] = rec

    glossary = {k: glossary_all[k] for k in sorted(used_terms) if k in glossary_all}
    dst = os.path.join(a.out, "data", "game", "skills.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump({"chars": out, "glossary": glossary}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"스킬: 출품작 {len(out)}명 · 용어 {len(glossary)}개 · {os.path.getsize(dst) // 1024}KB")


if __name__ == "__main__":
    main()
