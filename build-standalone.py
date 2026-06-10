#!/usr/bin/env python3
"""Build tetris-standalone.html: one self-contained file that plays from
file:// with no server. Inlines styles.css and tetris.js into index.html and
strips the PWA pieces (manifest, service worker, icon files) that require an
HTTP origin."""

import re
import urllib.parse

html = open("index.html").read()
css = open("styles.css").read()
js = open("tetris.js").read()

html = html.replace(
    '<link rel="stylesheet" href="styles.css" />', "<style>\n" + css + "\n</style>"
)
html = html.replace(
    '<script src="tetris.js"></script>', "<script>\n" + js + "\n</script>"
)

html = html.replace('<link rel="manifest" href="manifest.webmanifest" />\n  ', "")
html = html.replace('<link rel="apple-touch-icon" href="icons/icon-180.png" />\n  ', "")
html = re.sub(r'<script>\s*if \("serviceWorker".*?</script>\n', "", html, flags=re.S)

svg = open("icons/icon.svg").read().replace("\n", "").replace('"', "'")
html = html.replace(
    '<link rel="icon" href="icons/icon.svg" type="image/svg+xml" />',
    f'<link rel="icon" href="data:image/svg+xml,{urllib.parse.quote(svg)}" type="image/svg+xml" />',
)

for leftover in ("styles.css", "tetris.js", "icons/", "sw.js"):
    assert leftover not in html, f"unexpected reference to {leftover}"

open("tetris-standalone.html", "w").write(html)
print(f"wrote tetris-standalone.html ({len(html)} chars)")
