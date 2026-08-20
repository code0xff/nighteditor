/**
 * PWA 아이콘 생성기. 의존성 없이 PNG 를 직접 인코딩한다.
 *
 * 아이콘을 바이너리로만 커밋해 두면 나중에 색이나 크기를 바꿀 때 출처가 없다.
 * 이 스크립트가 곧 아이콘의 정의다.  실행: node scripts/make-icons.mjs
 *
 * 도안 — 어두운 바탕 위의 문서, 그 안에서 한 줄만 강조.
 * 이 도구가 하는 일(한 줄만 바꾸고 나머지는 그대로 둔다)을 그대로 그린 것이다.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BG = [0x0b, 0x0b, 0x0c, 0xff];
const PAPER = [0xe9, 0xe9, 0xec, 0xff];
const LINE = [0x8a, 0x8a, 0x92, 0xff];
const ACCENT = [0x5e, 0xc9, 0x8a, 0xff];

function canvas(size, fill) {
  const px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) px.set(fill, i * 4);
  return { size, px };
}

/** 모서리를 둥글린 사각형을 채운다 (r=0 이면 직사각형) */
function rect(c, x, y, w, h, r, color) {
  const x1 = x + w;
  const y1 = y + h;
  for (let py = Math.max(0, y | 0); py < Math.min(c.size, Math.ceil(y1)); py++) {
    for (let pxx = Math.max(0, x | 0); pxx < Math.min(c.size, Math.ceil(x1)); pxx++) {
      if (r > 0) {
        // 각 모서리 원 바깥이면 건너뛴다
        const cx = pxx < x + r ? x + r : pxx > x1 - r ? x1 - r : pxx;
        const cy = py < y + r ? y + r : py > y1 - r ? y1 - r : py;
        if ((pxx - cx) ** 2 + (py - cy) ** 2 > r * r) continue;
      }
      c.px.set(color, (py * c.size + pxx) * 4);
    }
  }
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng({ size, px }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // 스캔라인마다 필터 바이트 0 을 앞에 붙인다
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** @param inset 마스커블용 여백 비율 — OS 가 잘라내도 도안이 살아남게 한다 */
function icon(size, inset) {
  const c = canvas(size, BG);
  const u = size / 100; // 100 기준 좌표계
  const pad = inset * 100;
  const doc = { x: (22 + pad * 0.5) * u, y: (14 + pad * 0.6) * u };
  const w = (56 - pad) * u;
  const h = (72 - pad * 1.2) * u;

  rect(c, doc.x, doc.y, w, h, 4 * u, PAPER);

  // 본문 줄. 세 번째만 강조색 — 한 줄만 바뀌었다는 뜻이다.
  const lineH = Math.max(1, 4 * u);
  const gap = 11 * u;
  for (let i = 0; i < 4; i++) {
    const isEdited = i === 2;
    rect(
      c,
      doc.x + 9 * u,
      doc.y + 14 * u + i * gap,
      isEdited ? w - 18 * u : w - 26 * u,
      lineH,
      lineH / 2,
      isEdited ? ACCENT : LINE
    );
  }
  return encodePng(c);
}

const out = join(process.cwd(), 'public');
const files = [
  ['icon-192.png', icon(192, 0)],
  ['icon-512.png', icon(512, 0)],
  ['icon-maskable-512.png', icon(512, 0.18)],
];
for (const [name, data] of files) {
  writeFileSync(join(out, name), data);
  console.log(`${name}  ${data.length} bytes`);
}
