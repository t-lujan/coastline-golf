#!/usr/bin/env python3
"""Render the brand PNGs from the SVG sources in assets/brand/ with Playwright Chromium.

Re-run (from the repo root):  python3 scripts/render-brand.py
Writes into public/: favicon-32.png, apple-touch-icon.png (180, opaque), icon-192.png,
icon-512.png, og-image.png (1200x630). public/favicon.svg is hand-kept in sync with assets/brand/icon.svg.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

CHROME = "/usr/bin/google-chrome"  # same Chrome the test suite uses (bundled Playwright Chromium is not installed here)
ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / 'assets/brand', ROOT / 'public'
JOBS = [  # (source svg, output png, width, height)
    ('icon.svg', 'favicon-32.png', 32, 32),
    ('icon.svg', 'apple-touch-icon.png', 180, 180),
    ('icon.svg', 'icon-192.png', 192, 192),
    ('icon.svg', 'icon-512.png', 512, 512),
    ('og-card.svg', 'og-image.png', 1200, 630),
]

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    for src, out, w, h in JOBS:
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1)
        svg = (SRC / src).read_text()
        pg.set_content(f'<style>html,body{{margin:0;background:#28283F}}svg{{display:block;width:{w}px;height:{h}px}}</style>{svg}')
        pg.screenshot(path=str(OUT / out), omit_background=False, clip={'x': 0, 'y': 0, 'width': w, 'height': h})
        pg.close()
    b.close()
