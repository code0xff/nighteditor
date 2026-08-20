/**
 * PWA 아이콘 생성기. 의존성 없이 PNG 를 직접 디코딩·인코딩한다.
 *
 * 아이콘을 바이너리로만 커밋해 두면 나중에 크기나 여백을 바꿀 때 출처가 없다.
 * 이 스크립트가 곧 그 정의다.  실행: node scripts/make-icons.mjs
 *
 * 도안은 하나다 — `scripts/mark-512.png` (검은 타일 위 흰 세리프 N).
 * 파비콘(public/favicon*.ico|png, apple-touch-icon.png)도 같은 도안이라
 * 탭·홈화면·설치 아이콘이 전부 같은 마크로 보인다.
 *
 * 여기서 만드는 것:
 *   icon-192.png           풀블리드
 *   icon-512.png           풀블리드
 *   icon-maskable-512.png  안전영역(가운데 80%) 안으로 축소 — OS 가 원형으로 잘라도 살아남는다
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, 'mark-512.png');
const OUT = join(HERE, '..', 'public');

/** 마스커블 안전영역 — 도안이 차지할 비율. 나머지는 배경색 여백이다. */
const MASKABLE_SCALE = 0.8;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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

/** IDAT 를 모아 스캔라인 필터를 풀어 RGBA 로 만든다 (8bit·RGBA·non-interlaced 만) */
function decodePng(buf) {
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (buf[i] !== PNG_MAGIC[i]) throw new Error('PNG 가 아니다');
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      // 이 스크립트가 다루는 것은 자기 도안 하나뿐이다. 다른 형식이면 조용히 망가지지 말고 멈춘다.
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) {
        throw new Error(
          `지원하지 않는 PNG: depth=${data[8]} color=${data[9]} interlace=${data[12]}`
        );
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const px = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? px[y * stride + i - 4] : 0;
      const up = y > 0 ? px[(y - 1) * stride + i] : 0;
      const upLeft = y > 0 && i >= 4 ? px[(y - 1) * stride + i - 4] : 0;
      let value = line[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`알 수 없는 필터: ${filter}`);
      px[y * stride + i] = value & 0xff;
    }
  }
  return { width, height, px };
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
    Buffer.from(PNG_MAGIC),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 박스 필터로 줄인다. 알파를 미리 곱해서 평균한다 —
 * 그냥 평균하면 투명한 픽셀의 색이 섞여 테두리가 탁해진다.
 */
function resize(src, size) {
  const px = Buffer.alloc(size * size * 4);
  const ratio = src.width / size;
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * ratio);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * ratio));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * ratio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * ratio));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * src.width + sx) * 4;
          const alpha = src.px[i + 3] / 255;
          r += src.px[i] * alpha;
          g += src.px[i + 1] * alpha;
          b += src.px[i + 2] * alpha;
          a += src.px[i + 3];
          n++;
        }
      }
      const out = (y * size + x) * 4;
      const alpha = a / n / 255;
      px[out] = alpha > 0 ? Math.round(r / n / alpha) : 0;
      px[out + 1] = alpha > 0 ? Math.round(g / n / alpha) : 0;
      px[out + 2] = alpha > 0 ? Math.round(b / n / alpha) : 0;
      px[out + 3] = Math.round(a / n);
    }
  }
  return { width: size, height: size, px };
}

/** 도안의 바탕색. 마스커블 여백을 이 색으로 채워야 이어 붙인 자리가 보이지 않는다. */
function backgroundColor(src) {
  const i = (6 * src.width + (src.width >> 1)) * 4; // 위쪽 가운데 — 둥근 모서리 안쪽이다
  if (src.px[i + 3] === 255) return [src.px[i], src.px[i + 1], src.px[i + 2], 255];
  return [0, 0, 0, 255];
}

/** 배경으로 채운 정사각형 위에 도안을 가운데 얹는다 (scale=1 이면 풀블리드) */
function compose(src, size, scale) {
  const art = resize(src, Math.round(size * scale));
  const bg = backgroundColor(src);
  const px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) px.set(bg, i * 4);
  const offset = Math.round((size - art.width) / 2);
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      const s = (y * art.width + x) * 4;
      const d = ((y + offset) * size + x + offset) * 4;
      const alpha = art.px[s + 3] / 255;
      // 알파 합성. 도안의 둥근 모서리가 배경 위에 부드럽게 얹힌다.
      for (let c = 0; c < 3; c++) {
        px[d + c] = Math.round(art.px[s + c] * alpha + px[d + c] * (1 - alpha));
      }
      px[d + 3] = 255;
    }
  }
  return { size, px };
}

const source = decodePng(readFileSync(SOURCE));
const files = [
  ['icon-192.png', compose(source, 192, 1)],
  ['icon-512.png', compose(source, 512, 1)],
  ['icon-maskable-512.png', compose(source, 512, MASKABLE_SCALE)],
];
for (const [name, image] of files) {
  const data = encodePng(image);
  writeFileSync(join(OUT, name), data);
  console.log(`${name}  ${data.length} bytes`);
}
