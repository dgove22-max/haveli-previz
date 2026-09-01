# LED content

Drop show MP4s here and reference them by filename in `data/scenes.json`:

```json
{ "id": "s03", "led": "s03_pizza.mp4" }
```

A scene with `"led": null` shows the generated test pattern instead.

Canvas is **10240 × 1920 px** (25.60 × 4.80 m, 2.5 mm pitch). Files at other
resolutions are fine — the viewer shows the upscale factor per fit mode.

Note: Vercel serves files up to ~100 MB comfortably. Give teams proxy-res
files here (e.g. 2560 × 480) and keep full-res masters elsewhere.
