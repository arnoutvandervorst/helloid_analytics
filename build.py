#!/usr/bin/env python3
"""Bundle the analyzer into distributable artefacts.

  python3 build.py            -> dist/reconciliation-analyzer.html  (single file)
                                 dist/reconciliation-analyzer-<ver>.zip (folder form)

The single file inlines every stylesheet, script and the logo, so it can be mailed,
dropped on a share, or opened straight from disk. The zip keeps the folder layout
for anyone who wants to serve it over http (needed for snapshot storage).
"""
import base64
import mimetypes
import re
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
VERSION = '1.0.0'
NAME = 'helloid-analytics'

FOLDER_FILES = [
    'index.html', 'README.md', 'serve.sh', 'devserve.py', 'build.py',
    'css/app.css',
] + [f'js/{p.name}' for p in sorted((ROOT / 'js').glob('*.js'))]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding='utf-8')


def data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    return f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode('ascii')


def build_single_file() -> Path:
    html = read('index.html')

    # inline the stylesheet
    def css_sub(match):
        href = match.group(1).split('?')[0]
        return '<style>\n' + read(href) + '\n</style>'
    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css_sub, html)

    # inline every script, in the order the page declares them
    def js_sub(match):
        src = match.group(1).split('?')[0]
        body = read(src).replace('</script>', '<\\/script>')
        return f'<script>\n/* ---- {src} ---- */\n{body}\n</script>'
    html = re.sub(r'<script src="([^"]+)"></script>', js_sub, html)

    # inline the branding assets so the bundle keeps its identity offline
    slots = {
        'HR_BUNDLED_ICON': ('assets/icon.svg', 'assets/icon.png'),
        'HR_BUNDLED_LOGO': ('assets/logo.svg', 'assets/logo.png'),
        'HR_BUNDLED_LOGO_LIGHT': ('assets/logo-light.svg', 'assets/logo-light.png'),
    }
    inlined = []
    for var, candidates in slots.items():
        for candidate in candidates:
            path = ROOT / candidate
            if path.exists():
                inlined.append(f'window.{var} = {data_uri(path)!r};')
                break
    if inlined:
        html = html.replace('</head>', '<script>\n' + '\n'.join(inlined) + '\n</script>\n</head>')

    html = html.replace('</head>', f'<meta name="generator" content="{NAME} {VERSION}">\n</head>')

    DIST.mkdir(exist_ok=True)
    out = DIST / f'{NAME}.html'
    out.write_text(html, encoding='utf-8')
    return out


def build_zip() -> Path:
    DIST.mkdir(exist_ok=True)
    out = DIST / f'{NAME}-{VERSION}.zip'
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for rel in FOLDER_FILES:
            src = ROOT / rel
            if src.exists():
                z.write(src, f'{NAME}/{rel}')
        for candidate in sorted((ROOT / 'assets').glob('*')):
            if candidate.is_file():
                z.write(candidate, f'{NAME}/assets/{candidate.name}')
        single = DIST / f'{NAME}.html'
        if single.exists():
            z.write(single, f'{NAME}/{NAME}.html')
    return out


if __name__ == '__main__':
    single = build_single_file()
    archive = build_zip()
    print(f'{single.relative_to(ROOT)}  {single.stat().st_size / 1024:.0f} KB')
    print(f'{archive.relative_to(ROOT)}  {archive.stat().st_size / 1024:.0f} KB')
