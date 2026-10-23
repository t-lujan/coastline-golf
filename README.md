# Coastline Golf · Hole 1: Morro Rock

One signature par 4 on the San Luis Obispo coast, built with three.js. You tee off over a tidal inlet and play up a links fairway toward Morro Rock. The weather is live from Morro Bay, and the light comes from the real California sun.

**Play:** pull back and release to swing. Drag sideways to aim; a longer pull gives more power. On desktop, drag with the mouse the same way. The arrow keys fine-tune aim, and 1 / 2 / 3 switch clubs.

## What's in it

- **Live conditions.** Wind speed and direction, temperature, cloud cover, visibility and rain for Morro Bay (35.37, -120.85) come from [Open-Meteo](https://open-meteo.com).
  - Wind pushes the ball in flight and sways the grass, trees and flag.
  - Low visibility thickens the marine layer.
  - If the request fails, the game uses typical coastal conditions and the HUD says so.
- **Real time of day.** The solar position for Morro Rock at the current `America/Los_Angeles` time drives the sun, sky, fog colour and exposure: morning haze, midday, golden hour, then a moonlit night.
- **Rendering**
  - Custom GLSL water: analytic waves, fresnel sky reflection, sun glints and shoreline foam from a baked depth map.
  - Gradient sky with sun glow, layered clouds, stars and a moon with a glitter path on the bay.
  - Low-poly terrain painted from baked distance fields: fairway stripes, green checkerboard, bunkers with lips, dunes and beach.
  - Instanced, wind-swayed dune grass, coastal scrub and the Morro Bay tree mix: Monterey pine, blue-gum eucalyptus, coast live oak and a few windswept cypress, with soft contact shadows.
  - Shadows, bloom, ACES tone mapping, a light grade with vignette, and SMAA or FXAA.
- **Adaptive quality.** Auto mode measures the frame rate and steps from High to Medium to Low (DPR, bloom, anti-aliasing, shadow size, grass, scatter and tree counts). Or pick a level from the HUD.
- **Golf physics**
  - Quadratic drag, backspin lift and wind drift scaled by height.
  - Per-surface bounce and rolling friction, with gravity along the slope of the green.
  - Lip-outs, plus a water hazard with a penalty stroke and a drop.
- **Cinematics.** A skippable opening flyover, a chase camera with a shot tracer, and a slow-motion cup cam when a putt is dropping. Confetti when you hole out.
- **Audio.** Surf, gulls, the strike, the splash and the cup rattle are synthesised with WebAudio. There are no audio files. Sound starts on your first tap, and there is a mute toggle.

## URL options

| Param | Values |
| --- | --- |
| `time` | `sunrise`, `morning`, `noon`, `afternoon`, `golden`, `sunset`, `dusk`, `night`, or `HH:MM` (Pacific) |
| `weather` | `fog`, `clear`, `windy`, `rain`, `offline` (overrides on top of the live data) |
| `quality` | `auto`, `high`, `med`, `low` |
| `nofly` | skip the opening flyover |

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # static build in dist/ (relative paths, works under any GitHub Pages subpath)
npm run preview
```

## Credits

Made by [Tyler Lujan](https://t-lujan.github.io) · [github.com/t-lujan](https://github.com/t-lujan). Weather data by Open-Meteo (CC BY 4.0). MIT licensed.
