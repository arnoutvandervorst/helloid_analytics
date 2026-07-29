# assets

Three branding slots, each picked up automatically when the app is served over http,
inlined into `dist/reconciliation-analytics.html` by `build.py`, and shipped in the zip.
`.svg` wins over `.png` for the same slot.

| File | Where it shows |
| --- | --- |
| `icon.svg` / `icon.png` | square app mark — top bar and browser tab |
| `logo.svg` / `logo.png` | wordmark on light backgrounds |
| `logo-light.svg` / `logo-light.png` | wordmark on dark backgrounds — the report cover chip |

Each slot falls back to the next, so one file is enough to get started; without any,
the app shows a neutral gradient tile. Nothing is fetched from the internet — supply the
files yourself, from the brand kit you are entitled to use.

If you cannot drop files next to the app (for example when running the single-file bundle
from disk), upload them under **Settings → Report branding**; they are stored in the
browser as data URIs and travel into the PDF.

`logo-light.svg` here is `logo.svg` with the dark navy wordmark recoloured white, so it
reads on the report's dark cover chip.
