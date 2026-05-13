# Icon credits

The OpenSlop extension icon is the **"No AI art" symbol** from
Wikimedia Commons, a widely recognized mark used in artist and
anti-AI-slop communities.

- **Source:** <https://commons.wikimedia.org/wiki/File:No_AI_art.svg>
- **Uploader:** Lol1VNIO (own work, 2022-12-30)
- **Status:** Public domain. Wikimedia categorizes the file as
  ineligible for copyright — it consists entirely of simple geometry
  and common-property "no" sign imagery, with no original authorship.

No attribution is legally required. This file exists as a courtesy
credit and as documentation of where the asset came from.

## Files

- `no_ai_art.svg` — original SVG, unmodified.
- `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png` —
  PNG rasterizations used by `manifest.json` / `manifest.firefox.json`.

## Regenerating the PNGs

From the `icons/` directory, on macOS:

```sh
for size in 16 32 48 128; do
  sips -s format png -z $size $size no_ai_art.svg --out icon${size}.png
done
```

On Linux with `rsvg-convert` (librsvg):

```sh
for size in 16 32 48 128; do
  rsvg-convert -w $size -h $size no_ai_art.svg -o icon${size}.png
done
```
