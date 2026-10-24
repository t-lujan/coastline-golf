// Build-time baker for the Bishop Peak map: real elevation from the free, no-key AWS Terrarium tiles
// (https://registry.opendata.aws/terrain-tiles/, Mapzen Terrain Tiles, includes USGS 3DEP / SRTM data).
//   node scripts/bake-heightmap.mjs
// Two equirectangular, north-up squares around the hole site:
//   bishop-height.png      NEAR: 1024 px over 10 km (~9.8 m/px) from zoom-14 tiles, centred west-north-west of the site so
//                          it covers Bishop Peak, Chumash Peak, Cerro San Luis, Laguna Lake and the Madonna Inn
//   bishop-height-far.png  FAR:  256 px over 30 km (~117 m/px) from zoom-11 tiles: the rest of the Nine Sisters, the Irish
//                          Hills and the Santa Lucia foothills fading into haze
// Height is stored in 16 bits across R (high byte) and G (low byte): metres = (R*256 + G) / 8 - 100.
// The square's centre / half-size are written to the console and must match NEAR / FAR in src/maps/bishop.js.
import { writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

const SITE = { lat: 35.2845, lon: -120.6685 };   // BAKE_SITE in src/maps/bishop.js: the fixed georeference of the baked PNGs (the hole itself has moved; the map shifts these centres)
const MAPS = [
  { file: 'bishop-height.png', ce: -1500, cn: 500, half: 5000, size: 1024, z: 14, sub: 2 },
  { file: 'bishop-height-far.png', ce: -1500, cn: 500, half: 15000, size: 256, z: 11, sub: 3 },
];
const SCALE = 8;
const OUT = new URL('../src/maps/', import.meta.url);

const mPerDegLat = 111200, mPerDegLon = 111200 * Math.cos(35.28 * Math.PI / 180);
const lonLatAt = (e, n) => [SITE.lon + e / mPerDegLon, SITE.lat + n / mPerDegLat];

// ---- minimal PNG codec (8-bit, non-interlaced; enough for Terrarium tiles and our own output) ----
function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
const paeth = (a, b, c) => { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
function decodePng(buf) {
  let p = 8, w, h, ch, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ch = { 2: 3, 6: 4 }[d[9]]; if (d[8] !== 8 || d[12] || !ch) throw new Error('unsupported png'); }
    else if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), dst = out.subarray(y * stride, (y + 1) * stride), up = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? dst[i - ch] : 0, b = up ? up[i] : 0, c = up && i >= ch ? up[i - ch] : 0;
      dst[i] = (src[i] + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 255;
    }
  }
  return { w, h, ch, data: out };
}
// RGB output with a per-row filter choice (the smallest sum of residuals), which keeps a smooth 16-bit field compact
function encodePng(w, h, rgb) {
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const stride = w * 3, raw = Buffer.alloc(h * (stride + 1)), row = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const cur = rgb.subarray(y * stride, (y + 1) * stride), up = y ? rgb.subarray((y - 1) * stride, y * stride) : null;
    let best = null, bestF = 0, bestS = Infinity;
    for (let f = 0; f < 5; f++) {
      let s = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 3 ? cur[i - 3] : 0, b = up ? up[i] : 0, c = up && i >= 3 ? up[i - 3] : 0;
        const v = (cur[i] - (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 255;
        row[i] = v; s += v < 128 ? v : 256 - v;
      }
      if (s < bestS) { bestS = s; bestF = f; best = Buffer.from(row); }
    }
    raw[y * (stride + 1)] = bestF; best.copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

async function bake({ file, ce, cn, half, size, z, sub }) {
  const tileXY = (lon, lat) => { const n = 2 ** z, x = (lon + 180) / 360 * n, s = Math.sin(lat * Math.PI / 180); return [x, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]; };
  // ---- fetch the tiles that cover the square ----
  const corners = [lonLatAt(ce - half, cn + half), lonLatAt(ce + half, cn - half)].map(([lo, la]) => tileXY(lo, la));
  const [x0, x1] = [Math.floor(corners[0][0]), Math.floor(corners[1][0])], [y0, y1] = [Math.floor(corners[0][1]), Math.floor(corners[1][1])];
  const tiles = new Map(), jobs = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) jobs.push((async () => {
    const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`);
    if (!r.ok) throw new Error(`tile ${z}/${tx}/${ty}: ${r.status}`);
    tiles.set(`${tx},${ty}`, decodePng(Buffer.from(await r.arrayBuffer())));
  })());
  await Promise.all(jobs);
  const at = (x, y) => { const t = tiles.get(`${Math.floor(x / 256)},${Math.floor(y / 256)}`); if (!t) return 0; const i = ((y % 256) * 256 + (x % 256)) * t.ch; return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768; };
  const elev = (fx, fy) => {   // bilinear over tile pixels at absolute fractional tile coordinates
    const px = fx * 256 - 0.5, py = fy * 256 - 0.5, ix = Math.floor(px), iy = Math.floor(py), u = px - ix, v = py - iy;
    return (at(ix, iy) * (1 - u) + at(ix + 1, iy) * u) * (1 - v) + (at(ix, iy + 1) * (1 - u) + at(ix + 1, iy + 1) * u) * v;
  };
  // ---- resample to size x size, averaging sub x sub samples per pixel ----
  const rgb = Buffer.alloc(size * size * 3); let lo = 1e9, hi = -1e9;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let s = 0;
    for (let a = 0; a < sub; a++) for (let b = 0; b < sub; b++) {
      const e = ce - half + (i + (a + 0.5) / sub) / size * 2 * half, n = cn + half - (j + (b + 0.5) / sub) / size * 2 * half, [lon, lat] = lonLatAt(e, n);
      s += elev(...tileXY(lon, lat));
    }
    const h = Math.max(0, s / (sub * sub)); lo = Math.min(lo, h); hi = Math.max(hi, h);
    const v = Math.max(0, Math.min(65535, Math.round((h + 100) * SCALE))), k = (j * size + i) * 3;
    rgb[k] = v >> 8; rgb[k + 1] = v & 255; rgb[k + 2] = 0;
  }
  mkdirSync(OUT, { recursive: true });
  const png = encodePng(size, size, rgb);
  writeFileSync(new URL(file, OUT), png);
  console.log(`${file}: ${size}x${size} px, zoom ${z}, ${tiles.size} tiles, centre e=${ce} n=${cn} +-${half} m around ${SITE.lat},${SITE.lon}: ${lo.toFixed(0)}..${hi.toFixed(0)} m, ${(png.length / 1024).toFixed(0)} KB`);
}
for (const m of MAPS) await bake(m);
