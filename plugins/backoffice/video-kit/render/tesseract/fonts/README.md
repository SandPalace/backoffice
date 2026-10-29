# Fonts for the video templates

The templates use open fonts (Inter, DM Sans, Space Grotesk, Space Mono, Instrument Serif: SIL OFL 1.1; Luckiest Guy:
Apache 2.0). They are **not stored in the repo**. Download them once, inside the scratch copy of the kit, before rendering:

```bash
node render/tesseract/fonts/fetch-fonts.mjs
```

The script reads `fonts.json`, puts each file where the templates expect it (`fonts/<dir>/<file>.ttf`) with its licence,
and keeps a copy in `$BACKOFFICE_HOME/fonts` (the project's `data/fonts`), so the internet is needed only the first time.
Source: Fontsource (latin subset, enough for Spanish and English). To add a font, add it to `fonts.json`.
