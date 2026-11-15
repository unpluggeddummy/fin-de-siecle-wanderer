"""
UTTU에서 저장한 한국어 대사 txt → 대사집(data/user/transcripts) JSON으로 넣기

사용법 (저장소 폴더에서):
    python3 scripts/import_uttu.py <txt 폴더> [<txt 폴더> ...]
    예) python3 scripts/import_uttu.py ~/Downloads/reverse/uttu_kr ~/Downloads/reverse/event

- 메인 스토리 파일(…_chapter-0_….txt)과 이벤트 파일(…_1_1_….txt)을 알아서 구분해요.
- data/game/stories.json 의 스토리와 맞춰서 <스토리 id>.json 으로 저장해요. (예: main-vereinsamt.json)
- 같은 스토리의 대사집이 이미 있으면 통째로 바꿔요.
- index.json 의 이름표(names)는 그대로 두고 목록만 갱신해요.
- 다 되면 GitHub Desktop 에서 Commit → Push 하면 사이트에 반영돼요.

줄 종류 (사이트의 대사집 형식)
  line   : 대사(sp=말하는 사람) / 지문(sp 비움)
  music  : 배경음악 이름 (♪)
  combat : 전투 안내 (접어서 보여 줌)
"""
import json
import random
import re
import string
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/user/transcripts"
STORIES = json.loads((ROOT / "data/game/stories.json").read_text(encoding="utf-8"))

UI_LINES = {"←", "→", "-", "+", "100%", "한국어", "Share", "▲", ""}
HANGUL = re.compile(r"[가-힣]")
SPEAKER = re.compile(r"^([^:：]{1,24})[:：]\s?(.*)$")
END_PUNCT = tuple(".!?…~♪\"'”’」』)>—-,")


def uid():
    """사이트의 uid()와 비슷한 13자리 id"""
    t = int(time.time() * 1000)
    base = ""
    digits = string.digits + string.ascii_lowercase
    while t:
        t, r = divmod(t, 36)
        base = digits[r] + base
    return (base + "".join(random.choices(digits, k=13)))[:13]


def line(kind="line", sp="", ko=""):
    return {"id": uid(), "kind": kind, "sp": sp, "en": "", "ko": ko, "star": False}


# ───────── txt 읽기 ─────────
def parse_file(path):
    raw = unicodedata.normalize("NFC", path.read_text(encoding="utf-8"))
    head, *rest = re.split(r"\n=+\n\[Part (\d+)\] (\S+)\n=+\n", raw)
    hl = head.strip().splitlines()
    title, url = (hl + ["", ""])[:2]
    parts = []
    for i in range(0, len(rest), 3):
        parts.append(parse_part(int(rest[i]), rest[i + 2]))
    return {"title": title.strip(), "url": url.strip(), "parts": parts}


def parse_part(num, body):
    L = [l.rstrip() for l in body.splitlines()]
    title = ""
    try:
        arrow = L.index("←")
        header = [l for l in L[:arrow] if l.strip()]
        if header:
            m = re.match(r"^(\S+-\S+)\s+(.*)$", header[-1])
            title = m.group(2) if m else header[-1]
            if re.fullmatch(r"[\w-]{1,8}", title):  # 7SP처럼 번호만 있는 경우
                title = ""
        k = arrow
        while k < len(L) and not re.match(r"^Part \d+$", L[k]):
            k += 1
        L = L[k + 1:]
    except ValueError:
        pass
    L = [l for l in L if l.strip() not in UI_LINES and not re.match(r"^[\d,]+ 글자$", l.strip())]
    return {"n": num, "title": title, "lines": to_lines(L)}


def classify(s):
    s = s.strip()
    m = SPEAKER.match(s)
    if m and s != "COMBAT:" and not s.startswith("http"):
        return "say", m.group(1).strip(), m.group(2).strip()
    if s == "COMBAT:":
        return "combat", "", ""
    if not HANGUL.search(s):
        if s.startswith(("—", "<")) or len(s) > 40 or (s.isupper() and len(s) > 15) or s.endswith(("!", "?", ".", "…")):
            return "narr", "", s       # 인용·외국어 문장 → 지문 (화면에서 기울임)
        return "music", "", s
    return "narr", "", s


def to_lines(L):
    out, combat = [], None
    i = 0
    while i < len(L):
        kind, who, text = classify(L[i])
        if kind == "say" and not text and i + 1 < len(L):   # "소네트: " 다음 줄이 주문
            i += 1
            text = re.sub(r"\s{2,}", " ", L[i].strip())
        while (kind in ("narr", "say") and len(text) >= 30 and not text.endswith(END_PUNCT)
               and HANGUL.search(text) and i + 1 < len(L) and classify(L[i + 1])[0] == "narr"
               and HANGUL.search(L[i + 1])):   # 줄바꿈으로 끊긴 한국어 문장 잇기
            i += 1
            text += " " + L[i].strip()

        if kind == "combat":
            combat = line("combat", "", "")
            out.append(combat)
        elif combat is not None and kind == "narr":
            combat["ko"] = (combat["ko"] + "\n" + text).strip()
        else:
            combat = None
            if kind == "music":
                out.append(line("music", "", text))
            else:
                out.append(line("line", who, text))
        i += 1
    return out


# ───────── 스토리 맞추기 ─────────
MAIN_SP = {"chapter-5sp": "main-the-star", "chapter-7sp": "main-to-the-new-world", "chapter-14": "mainevent-pa-gur-yv-y-porthaur"}
EVENT_SP = {"S01_1": "mainevent-la-primavera-di-firenze", "S01_2": "mainevent-drama-in-athens", "S02": "mainevent-polymerized-dreams"}


def find_story(slug):
    if slug in MAIN_SP:
        return next((s for s in STORIES if s["id"] == MAIN_SP[slug]), None)
    m = re.fullmatch(r"chapter-(\d+)", slug)
    if m:
        return next((s for s in STORIES if s["cat"] == "main" and s["order"] == int(m.group(1))), None)
    if slug in EVENT_SP:
        return next((s for s in STORIES if s["id"] == EVENT_SP[slug]), None)
    m = re.fullmatch(r"(\d+)_(\d+)", slug)
    if m:
        ver = f"{m.group(1)}.{m.group(2)}"
        return next((s for s in STORIES if s["cat"] == "mainevent" and s.get("version") == ver
                     and not s["id"].endswith("-event")), None)
    return None


def build_doc(f):
    name = unicodedata.normalize("NFC", f.name)
    m = re.match(r"^\d+_(.+?)_", name)
    slug = m.group(1) if m else f.stem
    src = parse_file(f)
    st = find_story(slug)
    doc_id = st["id"] if st else f"x-uttu-{slug.lower()}"
    stage_names = {str(s["n"]): s for s in (st or {}).get("stages") or []}

    stages, order, custom = {}, [], {}
    for p in src["parts"]:
        n = str(p["n"])
        order.append(n)
        stages[n] = {"lines": p["lines"]}
        if n not in stage_names:
            custom[n] = f"{n}. {p['title']}" if p["title"] else f"{n}장"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    doc = {
        "id": doc_id,
        "story": st["id"] if st else None,
        "title": (st["name"]["ko"] if st else src["title"]) or src["title"],
        "titleEn": (st["name"]["en"] if st else "") or "",
        "version": (st.get("version") if st else "") or "",
        "stages": stages, "order": order, "customStages": custom,
        "source": src["url"], "updatedAt": now,
    }
    return doc, slug, st


def summary(d):
    all_ = [l for s in d["stages"].values() for l in s["lines"]]
    return {"title": d["title"], "titleEn": d["titleEn"], "version": d["version"], "story": d["story"],
            "lines": sum(1 for l in all_ if l["kind"] == "line"), "stars": sum(1 for l in all_ if l["star"]),
            "updatedAt": d["updatedAt"]}


def main():
    folders = [Path(a).expanduser() for a in sys.argv[1:]]
    if not folders:
        print(__doc__)
        sys.exit(1)
    OUT.mkdir(parents=True, exist_ok=True)
    idx_path = OUT / "index.json"
    idx = json.loads(idx_path.read_text(encoding="utf-8")) if idx_path.exists() else {"items": {}, "names": {}}
    idx.setdefault("items", {})
    idx.setdefault("names", {})

    files = sorted(f for d in folders for f in d.glob("*.txt"))
    for f in files:
        doc, slug, st = build_doc(f)
        (OUT / f"{doc['id']}.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        idx["items"][doc["id"]] = summary(doc)
        mark = "" if st else "  (스토리 목록에 없어서 직접 만든 대사집으로)"
        print(f"  ✓ {slug:>12} → {doc['id']}.json  {doc['title']}  {len(doc['order'])}장 {idx['items'][doc['id']]['lines']}줄{mark}")

    idx_path.write_text(json.dumps(idx, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\n{len(files)}편 완료 → {OUT.relative_to(ROOT)}")
    print("이제 GitHub Desktop 에서 Commit → Push 하면 사이트에 반영돼요.")


if __name__ == "__main__":
    main()
