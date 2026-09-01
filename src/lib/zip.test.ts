import { describe, expect, it } from 'vitest';
import { unzip } from './zip.js';
import { documentCandidates, pickDocument } from '@/core/bundle';
import { parseAssetRefs } from '@/core/assets';
import { dirOf } from '@/core/paths';
import { fixtureBundle } from '../__fixtures__/load.js';

const zip = (): Blob => new Blob([fixtureBundle() as BlobPart]);

describe('unzip', () => {
  it('inflates and returns the original content', async () => {
    const files = await unzip(zip());
    const html = await files.get('deck/index.html')?.text();

    expect(html).toContain('<link rel="stylesheet" href="css/deck.css">');
    expect(html).toContain('바깥에 자원을 둔 문서');
  });

  it('attaches a type to stylesheets', async () => {
    // Without a type the browser may refuse to use the blob as a stylesheet.
    const files = await unzip(zip());

    expect(files.get('deck/css/deck.css')?.type).toBe('text/css');
    expect(files.get('deck/img/logo.svg')?.type).toBe('image/svg+xml');
    expect(files.get('deck/fonts/mono.woff2')?.type).toBe('font/woff2');
  });

  it('picks the document to open from the unpacked bundle and finds assets from its place', async () => {
    const files = await unzip(zip());
    const path = pickDocument(files.keys());
    expect(path).toBe('deck/index.html');

    const source = (await files.get(path ?? '')?.text()) ?? '';
    const refs = parseAssetRefs(source, dirOf(path ?? ''));

    // The document sits inside deck/, so its references must resolve from there to match the paths in the zip.
    expect(refs.map((r) => r.path)).toEqual([
      'deck/css/deck.css',
      'deck/img/logo.svg',
      'deck/js/deck.js',
    ]);
    for (const ref of refs) expect(files.has(ref.path)).toBe(true);
  });

  it('does not count external links as assets', async () => {
    const files = await unzip(zip());
    const source = (await files.get('deck/index.html')?.text()) ?? '';

    expect(source).toContain('href="https://example.com/"');
    expect(parseAssetRefs(source, 'deck').some((r) => r.url.startsWith('http'))).toBe(false);
  });

  it('with several documents, every candidate is knowable', async () => {
    // One is picked and opened, but the fact that the rest exist must not be lost (Principle 3).
    const files = await unzip(zip());
    const withMore = new Map(files);
    withMore.set('deck/appendix.html', new Blob(['<p>부록</p>'], { type: 'text/html' }));

    const candidates = documentCandidates(withMore.keys());

    expect(candidates).toEqual(['deck/index.html', 'deck/appendix.html']);
    expect(pickDocument(withMore.keys())).toBe('deck/index.html');
  });
});

describe('unzip · a zip past the limit is rejected before loading (spec §5.1)', () => {
  it('stops on size alone, before copying with arrayBuffer', async () => {
    // Copying first makes the limit pointless — the tab freezes while hundreds of
    // MB move. No Blob of that actual size is needed: size must be all that is read.
    const huge = {
      size: 512 * 1024 * 1024,
      arrayBuffer: () => {
        throw new Error('한도 검사 전에 통째로 복사했다');
      },
    } as unknown as Blob;

    await expect(unzip(huge)).rejects.toMatchObject({ code: 'tooBig' });
  });
});

describe('unzip · forged sizes (spec §6)', () => {
  /** Swaps only one entry's "inflated size" in a real zip's index (central directory) */
  function forgeSize(bytes: Uint8Array, name: string, size: number): Uint8Array {
    const out = bytes.slice();
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    let eocd = -1;
    for (let at = out.length - 22; at >= 0; at--) {
      if (dv.getUint32(at, true) === 0x06054b50) {
        eocd = at;
        break;
      }
    }
    if (eocd < 0) throw new Error('EOCD 가 없다');
    const count = dv.getUint16(eocd + 10, true);
    let at = dv.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    for (let i = 0; i < count; i++) {
      const nameLength = dv.getUint16(at + 28, true);
      const extraLength = dv.getUint16(at + 30, true);
      const commentLength = dv.getUint16(at + 32, true);
      const entryName = decoder.decode(out.subarray(at + 46, at + 46 + nameLength));
      if (entryName === name) {
        dv.setUint32(at + 24, size, true);
        return out;
      }
      at += 46 + nameLength + extraLength + commentLength;
    }
    throw new Error(`목차에 없다: ${name}`);
  }

  it('rejects an entry recorded small in the index that inflates large', async () => {
    // Trusting the index sizes alone lets a zip bomb pass the limit check. Catch it by the bytes actually produced.
    const forged = forgeSize(fixtureBundle(), 'deck/index.html', 3);

    // A code, not a sentence — the sentence a person reads comes from the language pack (spec §1).
    await expect(unzip(new Blob([forged as BlobPart]))).rejects.toMatchObject({
      code: 'sizeMismatch',
      params: { name: 'deck/index.html' },
    });
  });

  it('filters an entry recorded large in the index before inflating it', async () => {
    const forged = forgeSize(fixtureBundle(), 'deck/index.html', 65 * 1024 * 1024);

    await expect(unzip(new Blob([forged as BlobPart]))).rejects.toMatchObject({ code: 'tooBig' });
  });
});

describe('unzip · corrupted content is caught by the index CRC (spec §6)', () => {
  /** Finds an entry in the index and returns [local header offset, compressed size, offset of the index CRC field] */
  function centralOf(
    bytes: Uint8Array,
    name: string
  ): { localAt: number; compressed: number; crcAt: number } {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let at = bytes.length - 22; at >= 0; at--) {
      if (dv.getUint32(at, true) === 0x06054b50) {
        eocd = at;
        break;
      }
    }
    if (eocd < 0) throw new Error('EOCD 가 없다');
    const count = dv.getUint16(eocd + 10, true);
    let at = dv.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    for (let i = 0; i < count; i++) {
      const nameLength = dv.getUint16(at + 28, true);
      const extraLength = dv.getUint16(at + 30, true);
      const commentLength = dv.getUint16(at + 32, true);
      const entryName = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
      if (entryName === name) {
        return {
          localAt: dv.getUint32(at + 42, true),
          compressed: dv.getUint32(at + 20, true),
          crcAt: at + 16,
        };
      }
      at += 46 + nameLength + extraLength + commentLength;
    }
    throw new Error(`목차에 없다: ${name}`);
  }

  it('rejects a stored entry even with a single flipped byte', async () => {
    // The size check can never catch this — a flipped byte keeps the size.
    const out = fixtureBundle().slice();
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    // deck/js/deck.js is a stored (method 0) entry — flip the data after its local header.
    const { localAt } = centralOf(out, 'deck/js/deck.js');
    const dataAt =
      localAt + 30 + dv.getUint16(localAt + 26, true) + dv.getUint16(localAt + 28, true);
    out[dataAt] = (out[dataAt] as number) ^ 0xff;

    await expect(unzip(new Blob([out as BlobPart]))).rejects.toMatchObject({
      code: 'crcMismatch',
      params: { name: 'deck/js/deck.js' },
    });
  });

  it('a compressed entry is also checked: inflated bytes against the index CRC', async () => {
    // Swapping the index CRC makes it disagree with the content — unmeasurable without the inflated bytes.
    const out = fixtureBundle().slice();
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const { crcAt } = centralOf(out, 'deck/index.html');
    dv.setUint32(crcAt, dv.getUint32(crcAt, true) ^ 0xffffffff, true);

    await expect(unzip(new Blob([out as BlobPart]))).rejects.toMatchObject({
      code: 'crcMismatch',
      params: { name: 'deck/index.html' },
    });
  });

  it('a healthy zip passes untouched', async () => {
    const files = await unzip(zip());
    expect(files.has('deck/index.html')).toBe(true);
  });
});
