#!/usr/bin/env python3
"""
게임 에셋에 아직 없는 버전(손으로 적은 버전)을 빌리빌리 공식 계정(重返未来1999)의 공개 이미지로 채운다.

  python scripts/fill_from_bili.py --out .            # 목록에 있는 이미지 받기 + 공식 계정 새 게시물 살펴보기
  python scripts/fill_from_bili.py --out . --no-scan  # 목록에 있는 이미지만

우선순위: 게임 에셋 > 팬덤 위키 > 빌리빌리.
  - 손으로 적은 버전(manual-versions.json)만 채운다. 게임 데이터에 그 버전이 들어오면 사이트는 게임 데이터를 쓴다.
  - 새 의상 카드는 게임 스킨 그림이 생기면 그쪽을 먼저 보여 준다(timeline.js).
  - 이미 위키 그림이 붙은 칸은 건드리지 않는다. 빌리빌리 그림은 bannerSrc/posterSrc = "bilibili" 로 표시한다.

이미지 목록: data/game/bili-sources.json
  {"items": [{"version": "4.1", "target": "summon:4.1:m-perchta" | "garment:Solace for the Lost" | "char:Perchta" | "key",
              "url": "https://i0.hdslb.com/bfs/...", "note": "...", "auto": true}]}
  - 공식 계정 게시물을 살펴봐서(접속이 되면) 찾은 것을 이 목록에 더한다. 못 찾으면 목록에 있는 것만 쓴다.
  - 의상·캐릭터 그림은 배경을 지워(rembg, 애니 그림용 모델) 게임 스킨 그림처럼 인물만 남긴다.
그림 출처: 빌리빌리 重返未来1999 공식 계정 / © Bluepoch
"""
import argparse
import hashlib
import io
import json
import os
import re
import sys
import time

import requests
from PIL import Image

UID = 1197454103  # 重返未来1999 공식 계정
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      "Referer": "https://www.bilibili.com/"}


def norm(s):
    return re.sub(r"[^0-9a-z一-鿿가-힣]", "", (s or "").lower())


# ── 공식 계정 게시물 살펴보기 ─────────────────────────────
def scan_posts(pages=3):
    """(글, [이미지 주소]) 목록. 막히면 빈 목록."""
    s = requests.Session()
    s.headers.update(UA)
    try:
        s.get("https://www.bilibili.com/", timeout=20)
    except Exception:
        pass
    out, offset = [], ""
    for _ in range(pages):
        r = s.get("https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space",
                  params={"host_mid": UID, "offset": offset, "features": "itemOpusStyle"}, timeout=30)
        j = r.json()
        if j.get("code") != 0:
            raise RuntimeError(f"code {j.get('code')} {j.get('message')}")
        data = j.get("data") or {}
        for it in data.get("items", []):
            text, pics = post_parts(it)
            if pics:
                out.append((text, pics))
        offset = data.get("offset") or ""
        if not data.get("has_more") or not offset:
            break
        time.sleep(1.5)
    return out


def post_parts(it):
    texts, pics = [], []

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in ("text", "title", "summary") and isinstance(v, str):
                    texts.append(v)
                elif k in ("url", "src", "img_src") and isinstance(v, str) and "/bfs/" in v and re.search(r"\.(jpg|jpeg|png|webp)$", v.split("@")[0]):
                    pics.append(v.split("@")[0].replace("http://", "https://"))
                else:
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(it.get("modules", {}).get("module_dynamic", {}))
    seen = []
    for p in pics:
        if p not in seen and "/face/" not in p and "/emote/" not in p:
            seen.append(p)
    return " ".join(texts), seen


def classify(posts, man):
    """게시물 → bili-sources 항목. 버전은 #重返未来X.Y版本# 해시태그로."""
    found = []
    for text, pics in posts:
        m = re.search(r"重返未来(\d+\.\d+)版本", text)
        if not m:
            continue
        vid = m.group(1)
        v = man.get(vid)
        if not v:
            continue
        zh_of = {norm(n.get("ko")): n.get("zh") for n in v.get("newChars", [])}
        # 픽업 배너: 「…」 활동 征集 + 【캐릭터】 受邀概率UP
        if "受邀概率UP" in text:
            for s in v.get("summons", []):
                names = [zh_of.get(norm(k)) for k in s.get("sixNames", [])]
                if any(n and f"【{n}】" in text for n in names):
                    found.append({"version": vid, "target": f"summon:{s['id']}", "url": pics[0], "note": text[:60]})
                    for n in v.get("newChars", []):
                        if n.get("zh") and f"【{n['zh']}】" in text:
                            found.append({"version": vid, "target": f"char:{n['en']}", "url": pics[0], "note": "픽업 배너에서 인물만"})
        if "湖的涟漪" in text and "征集" in text:
            for s in v.get("summons", []):
                if s.get("kind") == "ripples":
                    found.append({"version": vid, "target": f"summon:{s['id']}", "url": pics[0], "note": text[:60]})
        # 의상: "衣着 … 이름 | English Name"
        if "衣着" in text:
            for g in v.get("garments", []):
                if g.get("en") and norm(g["en"]) in norm(text):
                    found.append({"version": vid, "target": f"garment:{g['en']}", "url": pics[0], "note": text[:60]})
        # 버전 대표 그림: "X.Y版本《…》现已开幕/开启"
        if re.search(r"版本[《「].+?[》」]现已(开幕|开启)", text):
            found.append({"version": vid, "target": "key", "url": pics[0], "note": text[:60]})
    return found


# ── 이미지 받기·다듬기 ───────────────────────────────────
_rembg = None


def cutout(im):
    """배경을 지우고 인물만 남긴다 (게임 스킨 그림처럼 투명 배경)."""
    global _rembg
    try:
        from rembg import new_session, remove
    except ImportError:  # 배경 지울 그림이 있을 때만 설치 (매일 갱신을 가볍게)
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "rembg", "onnxruntime"])
        from rembg import new_session, remove
    if _rembg is None:
        _rembg = new_session("isnet-anime")
    out = remove(im.convert("RGBA"), session=_rembg)
    a = out.getchannel("A").point(lambda x: 255 if x > 24 else 0)
    box = a.getbbox()
    return out.crop(box) if box else out


def fetch(url):
    r = requests.get(url, headers=UA, timeout=90)
    r.raise_for_status()
    im = Image.open(io.BytesIO(r.content))
    im.load()
    return im


def make(out_dir, url, kind):
    key = hashlib.sha1(url.encode()).hexdigest()[:12]
    rel = f"assets/img/bili/{key}-{kind}.webp"
    dest = os.path.join(out_dir, rel)
    if os.path.exists(dest):
        return rel
    im = fetch(url)
    if kind == "banner":
        im = im.convert("RGB")
        if im.width > 1200:
            im = im.resize((1200, round(im.height * 1200 / im.width)), Image.LANCZOS)
    elif kind == "key":
        im = im.convert("RGB")
        if im.width > 1600:
            im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
    elif kind in ("skin", "char"):
        if kind == "char" and im.width > im.height:
            # 픽업 배너: 인물은 왼쪽~가운데, 오른쪽은 배너 제목·기간 글자
            im = im.crop((0, 0, round(im.width * 0.62), round(im.height * 0.8)))
        im = cutout(im)
        if im.height > 1100:
            im = im.resize((round(im.width * 1100 / im.height), 1100), Image.LANCZOS)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    im.save(dest, "WEBP", quality=86, method=5)
    return rel


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=".")
    ap.add_argument("--no-scan", action="store_true")
    a = ap.parse_args()
    G = os.path.join(a.out, "data", "game")
    mp, sp = os.path.join(G, "manual-versions.json"), os.path.join(G, "bili-sources.json")
    manual = json.load(open(mp, encoding="utf-8"))
    src = json.load(open(sp, encoding="utf-8")) if os.path.exists(sp) else {"items": []}
    game_ids = {v["id"] for v in json.load(open(os.path.join(G, "versions.json"), encoding="utf-8")) if v.get("summons") and not v.get("stub")}
    man = {v["id"]: v for v in manual.get("versions", []) if v["id"] not in game_ids}
    if not man:
        print("빌리빌리: 채울 버전 없음 (모두 게임 데이터에 있음)")
        return

    # 1) 공식 계정 새 게시물 살펴보기
    if not a.no_scan:
        try:
            posts = scan_posts()
            have = {(x["target"], x["version"]) for x in src["items"]}
            new = [x for x in classify(posts, man) if (x["target"], x["version"]) not in have]
            for x in new:
                x["auto"] = True
                src["items"].append(x)
                have.add((x["target"], x["version"]))
            print(f"빌리빌리 게시물 {len(posts)}개 살펴봄, 새로 찾은 그림 {len(new)}개")
        except Exception as e:
            print(f"빌리빌리 게시물 살펴보기 실패 (목록에 있는 그림만 씀): {e}")

    # 2) 목록의 그림을 받아서 손으로 적은 버전 칸에 붙이기
    got = 0
    for x in src["items"]:
        v = man.get(x["version"])
        if not v:
            continue
        t = x["target"]
        try:
            if t.startswith("summon:"):
                s = next((s for s in v.get("summons", []) if s["id"] == t[7:]), None)
                if s and (not s.get("banner") or s.get("bannerSrc") == "bilibili"):
                    rel = make(a.out, x["url"], "banner")
                    if s.get("banner") != rel:
                        s["banner"], s["bannerSrc"] = rel, "bilibili"
                        got += 1
            elif t.startswith("garment:"):
                g = next((g for g in v.get("garments", []) if norm(g.get("en")) == norm(t[8:])), None)
                if g and (not g.get("poster") or g.get("posterSrc") == "bilibili"):
                    rel = make(a.out, x["url"], "skin")
                    if g.get("poster") != rel:
                        g["poster"], g["posterSrc"] = rel, "bilibili"
                        got += 1
            elif t.startswith("char:"):
                n = next((n for n in v.get("newChars", []) if norm(n.get("en")) == norm(t[5:])), None)
                if n and (not n.get("poster") or n.get("posterSrc") == "bilibili"):
                    rel = make(a.out, x["url"], "char")
                    if n.get("poster") != rel:
                        n["poster"], n["posterSrc"] = rel, "bilibili"
                        got += 1
            elif t == "key":
                if not v.get("art") or v.get("artSrc") == "bilibili":
                    rel = make(a.out, x["url"], "key")
                    if v.get("art") != rel:
                        v["art"], v["artSrc"] = rel, "bilibili"
                        got += 1
            print(f"  · {x['version']} {t}")
        except Exception as e:
            print(f"  ! {x['version']} {t}: {e}", file=sys.stderr)

    with open(sp, "w", encoding="utf-8") as f:
        json.dump(src, f, ensure_ascii=False, indent=1)
        f.write("\n")
    with open(mp, "w", encoding="utf-8") as f:
        json.dump(manual, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"빌리빌리 그림 {got}개 새로 붙임")


if __name__ == "__main__":
    main()
