# Coastline Golf · Hole 1: Morro Rock and Bishop Peak

Two holes in San Luis Obispo county, built with three.js, with a map picker on the start screen (your last choice is remembered).

- **Morro Rock**: a par 4 on the coast. You tee off over a tidal inlet and play up a links fairway toward Morro Rock. The weather is live from Morro Bay, and the light comes from the real California sun there.
- **Bishop Peak**: a par 5 in the San Luis Obispo valley, a dogleg right with Bishop Peak's rocky summit rising behind the green, Cerro San Luis Obispo with its white "M" off to one side, the Madonna Inn at its foot, the lower morros of the Nine Sisters fading into haze, coast live oak woodland, golden grass, chaparral, two fairway and two greenside bunkers and a pond. Weather and sun use the hole's own latitude and longitude (35.2845, -120.6685).

**Play:** pull back and release to swing. Drag sideways to aim; a longer pull gives more power. On desktop, drag with the mouse the same way. The arrow keys fine-tune aim, and 1 / 2 / 3 switch clubs.

## What's in it

- **Live conditions.** Wind speed and direction, temperature, cloud cover, visibility and rain for Morro Bay (35.37, -120.85) come from [Open-Meteo](https://open-meteo.com).
  - Wind pushes the ball in flight and sways the grass, trees and flag.
  - Low visibility thickens the marine layer.
  - If the request fails, the game uses typical coastal conditions and the HUD says so.
- **Real time of day.** The solar position for Morro Rock at the current `America/Los_Angeles` time drives the sun, sky, fog colour and exposure: morning haze, midday, golden hour, then a moonlit night.
- **Rendering**
  - Morro Rock as a 176 m dacite dome at the end of its causeway: steep jointed walls, weathered and guano-streaked upper faces, a dark wet foot with tumbled boulders. The rock also shows in the bay's reflection and blocks the sun glitter behind it.
  - Custom GLSL water: analytic waves, fresnel sky reflection, turquoise shallows, sun and moon glitter paths, and foam lines rolling in from a baked depth map.
  - Gradient sky with sun glow, layered clouds, stars and a moon with a glitter path on the bay.
  - Low-poly terrain painted from baked distance fields: fairway stripes, green checkerboard, bunkers with lips, dunes and beach.
  - Instanced, wind-swayed dune grass, coastal scrub, magenta ice plant and the Morro Bay tree mix: Monterey pine, blue-gum eucalyptus, coast live oak and a few windswept cypress. The crowns have ragged leafy edges (the blue gums hang open bunches of long sickle leaves), light scattering through the canopy, soft contact shadows and distance haze.
  - Shadows, bloom, ACES tone mapping, a light grade with vignette, and SMAA or FXAA.
- **Adaptive quality.** Auto mode picks a starting level from the device: High on desktops, Medium on phones and tablets, and Low on very weak hardware. It then measures the frame rate and steps down a level whenever it drops below 48 fps. Each step lowers DPR, bloom, anti-aliasing, shadow size, grass, scatter and tree counts, and Low also drops the leafy cut-outs. Tree meshes are rebuilt once per level change, with fewer shared shapes on lower levels. You can also pick a level from the HUD.
- **Golf physics**
  - Quadratic drag, backspin lift and wind drift scaled by height.
  - Per-surface bounce and rolling friction, with gravity along the slope of the green.
  - Lip-outs, plus a water hazard with a penalty stroke and a drop.
- **Cinematics.** A skippable opening flyover, a chase camera with a shot tracer, and a slow-motion cup cam when a putt is dropping. On a hole-out, the pin is pulled and laid on the green, and the camera finds a low shot past the cup that keeps the whole rock in frame, with paper confetti and a sparkle burst (toned down to moonlit paper at night).
- **Audio.** Surf, gulls, the strike, the splash and the cup rattle are synthesised with WebAudio. There are no audio files. Sound starts on your first tap, and there is a mute toggle.

## URL options

| Param | Values |
| --- | --- |
| `time` | `sunrise`, `morning`, `noon`, `afternoon`, `golden`, `sunset`, `dusk`, `night`, or `HH:MM` (Pacific) |
| `weather` | `fog`, `clear`, `windy`, `rain`, `offline` (overrides on top of the live data) |
| `quality` | `auto`, `high`, `med`, `low` |
| `nofly` | skip the opening flyover |
| `map` | `morro` or `bishop` (overrides the saved choice) |

## Real-world mapping (Bishop Peak)

The hole site (the dogleg corner) is the world origin. Bishop Peak (472 m), Cerro San Luis Obispo (393 m) with the white "M" on its east face, the Madonna Inn, Chumash Peak and Cerro Romualdo stand at their true compass bearings and distances from it, on real elevation baked from the free, no-key AWS Terrarium tiles. `node scripts/bake-heightmap.mjs` writes two PNGs: `src/maps/bishop-height.png` (1024 px over 10 km from zoom-14 tiles, ~10 m a pixel, covering Bishop Peak, Chumash Peak, Cerro San Luis and Laguna Lake) and `src/maps/bishop-height-far.png` (256 px over 30 km for the rest of the Nine Sisters and the hills in the haze). The backdrop is meshed straight from them: a fine grid over the peaks the hole looks at, a coarse far ring beyond. Relief is true to life within ~1.2 km and drawn 1.2x beyond ~2.8 km so the far morros still stand up over the near foothills. The playable hole follows a smooth fit of the real valley floor (the approach climbs to a green at the foot of Cerro San Luis's north spur) and blends into the data within ~650 m. The M is real scale (~36 m) and lies on the slope; the Madonna Inn is drawn 1.6x life size so it reads from the tee about 2 km away. If the PNGs cannot be loaded, the peaks fall back to smooth cones at their true positions and heights.

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # static build in dist/ (relative paths, works under any GitHub Pages subpath)
npm run preview
```

## Credits

Made by [Tyler Lujan](https://t-lujan.github.io) · [github.com/t-lujan](https://github.com/t-lujan). Weather data by Open-Meteo (CC BY 4.0). Elevation data: Mapzen Terrain Tiles / AWS Open Data (includes USGS 3DEP/SRTM data). MIT licensed.
