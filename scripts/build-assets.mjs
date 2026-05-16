// Generates all visual assets shipped with the app:
//   assets/trayTemplate.png + @2x + @3x   — macOS tray (black + alpha, auto-tinted)
//   assets/trayColor.png + @2x            — Linux/Windows tray (colored)
//   assets/icon.png                       — Linux dock / fallback (1024x1024)
//   assets/icon.iconset/* + icon.icns     — macOS app icon
//   assets/dmg-background.png + @2x       — DMG installer background
//
// No external deps: writes PNGs by hand (zlib + CRC32) and uses macOS `iconutil`.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');
fs.mkdirSync(ASSETS, { recursive: true });

// ─── PNG encoder ──────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// rgba: Uint8ClampedArray length = w*h*4 (R,G,B,A per pixel, non-premultiplied)
function encodePNG(rgba, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // filter byte 0 per scanline
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    for (let x = 0; x < w * 4; x++) raw[y * (1 + w * 4) + 1 + x] = rgba[y * w * 4 + x];
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ─── Renderer: super-sample N×N per output pixel ──────────────────────────
// `shade(x, y)` returns [r, g, b, a] in 0..255 for a point in [0,1]² of the
// icon canvas (resolution-independent). We average SS×SS samples per pixel.

function render(w, h, ss, shade) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (px + (sx + 0.5) / ss) / w;
          const v = (py + (sy + 0.5) / ss) / h;
          const c = shade(u, v);
          // premultiplied-by-alpha accumulate so edges with transparent
          // pixels don't bleed background color in
          const af = c[3] / 255;
          r += c[0] * af; g += c[1] * af; b += c[2] * af; a += c[3];
        }
      }
      const n = ss * ss;
      const af = a / n / 255;
      out[(py * w + px) * 4 + 0] = af > 0 ? Math.round(r / n / af) : 0;
      out[(py * w + px) * 4 + 1] = af > 0 ? Math.round(g / n / af) : 0;
      out[(py * w + px) * 4 + 2] = af > 0 ? Math.round(b / n / af) : 0;
      out[(py * w + px) * 4 + 3] = Math.round(a / n);
    }
  }
  return out;
}

function writePNG(file, w, h, ss, shade) {
  fs.writeFileSync(file, encodePNG(render(w, h, ss, shade), w, h));
  console.log('  wrote', path.relative(ROOT, file), `(${w}x${h})`);
}

// ─── Shape primitives (all in [0,1] coords) ───────────────────────────────

const over = (top, bot) => {
  // standard alpha-over: top over bottom
  const ta = top[3] / 255, ba = bot[3] / 255;
  const oa = ta + ba * (1 - ta);
  if (oa === 0) return [0, 0, 0, 0];
  return [
    (top[0] * ta + bot[0] * ba * (1 - ta)) / oa,
    (top[1] * ta + bot[1] * ba * (1 - ta)) / oa,
    (top[2] * ta + bot[2] * ba * (1 - ta)) / oa,
    Math.round(oa * 255),
  ];
};

// Signed distance to a rounded rect centered at (cx,cy) with halfW/halfH and corner r.
const sdRoundedRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
};

// Signed distance to line segment a→b.
const sdSegment = (x, y, ax, ay, bx, by) => {
  const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h);
};

// Convert SDF value to alpha coverage. `feather` ≈ 1px in canvas units.
const cover = (sd, feather) => Math.max(0, Math.min(1, 0.5 - sd / feather));

// ─── Designs ──────────────────────────────────────────────────────────────
//
// The V mark: two thick angled strokes meeting at the bottom-center, with a
// small 4-point sparkle accent in the upper-right quadrant.
//
// All shapes are defined in a [0,1]×[0,1] canvas so the same definition works
// at any size. `feather` is in canvas units so AA stays consistent.

function shadeVMark(x, y, color, opts = {}) {
  const { withSparkle = true, feather = 0.012, scale = 1, cx = 0.5, cy = 0.5 } = opts;
  // Apply scale around (cx,cy)
  const X = (x - cx) / scale + cx;
  const Y = (y - cy) / scale + cy;

  // V strokes: two segments forming a chevron
  // top-left  (0.20, 0.26) → bottom-center (0.50, 0.78)
  // top-right (0.80, 0.26) → bottom-center (0.50, 0.78)
  const halfThick = 0.085;
  const leftSd = sdSegment(X, Y, 0.20, 0.26, 0.50, 0.78) - halfThick;
  const rightSd = sdSegment(X, Y, 0.80, 0.26, 0.50, 0.78) - halfThick;
  let aV = Math.max(cover(leftSd, feather), cover(rightSd, feather));

  if (!withSparkle) return [color[0], color[1], color[2], Math.round(aV * 255)];

  // 4-point sparkle: two crossed lozenges at (sx,sy)
  const sx = 0.78, sy = 0.18, sR = 0.085;
  const dx = X - sx, dy = Y - sy;
  // Vertical lozenge: |dx|/0.25 + |dy|/1 ≤ sR (thin tall diamond)
  const vert = Math.abs(dx) / 0.32 + Math.abs(dy) / 1.0 - sR;
  const horiz = Math.abs(dx) / 1.0 + Math.abs(dy) / 0.32 - sR;
  const aS = Math.max(cover(vert, feather), cover(horiz, feather));

  const a = Math.max(aV, aS);
  return [color[0], color[1], color[2], Math.round(a * 255)];
}

// Vertical gradient between two colors
const grad = (t, top, bot) => [
  top[0] + (bot[0] - top[0]) * t,
  top[1] + (bot[1] - top[1]) * t,
  top[2] + (bot[2] - top[2]) * t,
  255,
];

// ─── Tray icons (template: black + alpha) ─────────────────────────────────
// macOS template images use only alpha; we draw a slightly scaled V so the
// shape reads well at 16px.

// Tray uses the V mark only (sparkle is invisible at this scale and adds noise).
function shadeTrayTemplate(x, y) {
  return shadeVMark(x, y, [0, 0, 0], { withSparkle: false, scale: 1.05, feather: 0.04 });
}

const PURPLE = [124, 58, 237];
function shadeTrayColor(x, y) {
  return shadeVMark(x, y, PURPLE, { withSparkle: false, scale: 1.05, feather: 0.04 });
}

// ─── App icon (color, rounded square + gradient + white V) ────────────────

function shadeAppIcon(x, y) {
  // Rounded-square background, slightly inset from edges (4% padding)
  const pad = 0.0;
  const bgSd = sdRoundedRect(x, y, 0.5, 0.5, 0.5 - pad, 0.5 - pad, 0.22);
  const bgAlpha = cover(bgSd, 0.008);
  if (bgAlpha === 0) return [0, 0, 0, 0];

  // Vertical gradient #a78bfa → #6d28d9
  const top = [167, 139, 250];
  const bot = [109, 40, 217];
  const bg = grad(y, top, bot);
  bg[3] = Math.round(bgAlpha * 255);

  // White V mark + sparkle on top
  const v = shadeVMark(x, y, [255, 255, 255], { withSparkle: true, scale: 0.78, feather: 0.005 });

  return over(v, bg);
}

// ─── DMG background ───────────────────────────────────────────────────────
// 540×380 (standard maker-dmg window). Light off-white background, app icon
// goes on the left (x≈130, y≈200), Applications symlink on the right
// (x≈410, y≈200). Draw a faint arrow between them and a header.

function shadeDmgBg(x, y) {
  // Subtle top-to-bottom gradient near white
  const c = grad(y, [252, 252, 254], [241, 240, 248]);

  // Arrow from x≈0.36 → x≈0.64 at y≈0.55 (in [0,1] coords of 540×380)
  // shaft
  const shaftSd = sdSegment(x, y, 0.36, 0.55, 0.605, 0.55) - 0.006;
  const aShaft = cover(shaftSd, 0.004);
  // arrowhead: two segments
  const headA = sdSegment(x, y, 0.605, 0.55, 0.575, 0.525) - 0.006;
  const headB = sdSegment(x, y, 0.605, 0.55, 0.575, 0.575) - 0.006;
  const aHead = Math.max(cover(headA, 0.004), cover(headB, 0.004));
  const aArrow = Math.max(aShaft, aHead);

  if (aArrow > 0) {
    const arrow = [180, 168, 210, Math.round(aArrow * 255)];
    return over(arrow, c);
  }
  return c;
}

// ─── Drive it ─────────────────────────────────────────────────────────────

console.log('Tray (template, mac):');
writePNG(path.join(ASSETS, 'trayTemplate.png'),    16, 16, 4, shadeTrayTemplate);
writePNG(path.join(ASSETS, 'trayTemplate@2x.png'), 32, 32, 4, shadeTrayTemplate);
writePNG(path.join(ASSETS, 'trayTemplate@3x.png'), 48, 48, 4, shadeTrayTemplate);

console.log('Tray (color, linux/win):');
writePNG(path.join(ASSETS, 'trayColor.png'),    32, 32, 4, shadeTrayColor);
writePNG(path.join(ASSETS, 'trayColor@2x.png'), 64, 64, 4, shadeTrayColor);

console.log('App icon (PNG + iconset):');
const iconset = path.join(ASSETS, 'icon.iconset');
fs.rmSync(iconset, { recursive: true, force: true });
fs.mkdirSync(iconset, { recursive: true });
// macOS iconset spec: pairs of @1x/@2x at 16,32,128,256,512
const ICONSET = [
  ['icon_16x16.png',       16,  2],
  ['icon_16x16@2x.png',    32,  3],
  ['icon_32x32.png',       32,  3],
  ['icon_32x32@2x.png',    64,  3],
  ['icon_128x128.png',    128,  2],
  ['icon_128x128@2x.png', 256,  2],
  ['icon_256x256.png',    256,  2],
  ['icon_256x256@2x.png', 512,  2],
  ['icon_512x512.png',    512,  2],
  ['icon_512x512@2x.png', 1024, 2],
];
for (const [name, size, ss] of ICONSET) {
  writePNG(path.join(iconset, name), size, size, ss, shadeAppIcon);
}
// Compile iconset → icns (macOS)
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(ASSETS, 'icon.icns')]);
console.log('  wrote assets/icon.icns');
// 1024x1024 PNG for Linux / fallback
writePNG(path.join(ASSETS, 'icon.png'), 1024, 1024, 2, shadeAppIcon);

console.log('DMG background:');
writePNG(path.join(ASSETS, 'dmg-background.png'),    540, 380, 2, shadeDmgBg);
writePNG(path.join(ASSETS, 'dmg-background@2x.png'), 1080, 760, 2, shadeDmgBg);

console.log('Done.');
