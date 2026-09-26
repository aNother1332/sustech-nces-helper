/**
 * gen-icons.js — 生成扩展图标（16/48/128）：蓝紫渐变圆角方块 + 白色 "评" 字轮廓太复杂，
 * 采用简约几何：渐变底 + 白色星形（呼应评分）。零依赖，手工构建 PNG（zlib deflate）。
 * 运行：node tools/gen-icons.js
 */
const zlib = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixelFn) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y, size);
      const o = rowStart + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// 圆角方形 alpha（SDF 抗锯齿）
function roundedAlpha(x, y, size, radius) {
  const px = x + 0.5, py = y + 0.5;
  const rx = Math.min(px, size - px), ry = Math.min(py, size - py);
  const dx = Math.max(radius - rx, 0), dy = Math.max(radius - ry, 0);
  const d = Math.hypot(dx, dy);
  return Math.max(0, Math.min(1, radius - d + 0.5 > 1 ? 1 : radius - d + 0.5));
}

// 五角星命中测试（中心 cos 绕向）
function starAlpha(px, py, cx, cy, outer, inner, rot = -Math.PI / 2) {
  const dx = px - cx, dy = py - cy;
  const r = Math.hypot(dx, dy);
  if (r > outer) return 0;
  let ang = Math.atan2(dy, dx) - rot;
  ang = ((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const sector = (2 * Math.PI) / 10;
  const local = ang % sector;
  const edge = local < sector / 2
    ? inner + (outer - inner) * (local / (sector / 2))
    : outer - (outer - inner) * ((local - sector / 2) / (sector / 2));
  return r <= edge ? 1 : 0;
}

function makeIcon(size) {
  const radius = size * 0.22;
  return png(size, (x, y) => {
    const a = roundedAlpha(x, y, size, radius);
    if (a <= 0) return [0, 0, 0, 0];
    const t = (x + y) / (2 * size);
    // #0A84FF → #5E5CE6 对角渐变
    const r = Math.round(10 + (94 - 10) * t);
    const g = Math.round(132 + (92 - 132) * t);
    const b = Math.round(255 + (230 - 255) * t);
    const s = starAlpha(x + 0.5, y + 0.5, size / 2, size / 2 + size * 0.02, size * 0.32, size * 0.14);
    if (s) return [255, 255, 255, Math.round(255 * a)];
    return [r, g, b, Math.round(255 * a)];
  });
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), makeIcon(size));
  console.log(`icon${size}.png written`);
}
