#!/usr/bin/env python3
"""브라우저가 예전 파일을 붙들고 있지 않게, 바뀐 JS·CSS에 버전 표시를 붙인다.

  python3 scripts/stamp_version.py

index.html 안의 import map(모든 모듈 주소 → ?v=버전)과 style.css?v= 를 파일 내용 기준으로 새로 쓴다.
모듈마다 같은 주소로 바뀌므로 한 파일이 두 번 불려 오는 일도 없다.
"""
import hashlib
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def h(paths):
    m = hashlib.sha1()
    for p in sorted(paths):
        m.update(p.encode())
        m.update(open(os.path.join(ROOT, p), "rb").read())
    return m.hexdigest()[:8]


def main():
    js = []
    for d, _, fs in os.walk(os.path.join(ROOT, "assets", "js")):
        for f in fs:
            if f.endswith(".js"):
                js.append(os.path.relpath(os.path.join(d, f), ROOT).replace(os.sep, "/"))
    imports = {}
    for p in sorted(js):
        imports["./" + p] = f"./{p}?v={h([p])}"
    css_v = h(["assets/css/style.css"])
    idx = os.path.join(ROOT, "index.html")
    s = open(idx, encoding="utf-8").read()
    block = '<script type="importmap" data-stamp>' + json.dumps({"imports": imports}, ensure_ascii=False) + "</script>"
    if "data-stamp" in s:
        s = re.sub(r'<script type="importmap" data-stamp>.*?</script>', lambda _: block, s, flags=re.S)
    else:
        s = s.replace('<script type="module" src="assets/js/app.js', block + '\n  <script type="module" src="assets/js/app.js', 1)
    s = re.sub(r'src="assets/js/app\.js(\?v=[^"]*)?"', f'src="{imports["./assets/js/app.js"][2:]}"', s)
    s = re.sub(r'href="assets/css/style\.css(\?v=[^"]*)?"', f'href="assets/css/style.css?v={css_v}"', s)
    open(idx, "w", encoding="utf-8").write(s)
    print(f"모듈 {len(imports)}개, css v={css_v}")


if __name__ == "__main__":
    main()
