import { describe, expect, it } from 'vitest';
import { unzip } from './zip.js';
import { documentCandidates, pickDocument } from '@/core/bundle';
import { dirOf, parseAssetRefs } from '@/core/assets';
import { fixtureBundle } from '../__fixtures__/load.js';

const zip = (): Blob => new Blob([fixtureBundle() as BlobPart]);

describe('unzip', () => {
  it('압축을 풀어 원래 내용을 돌려준다', async () => {
    const files = await unzip(zip());
    const html = await files.get('deck/index.html')?.text();

    expect(html).toContain('<link rel="stylesheet" href="css/deck.css">');
    expect(html).toContain('바깥에 자원을 둔 문서');
  });

  it('스타일시트에 형식을 붙인다', async () => {
    // 형식이 없으면 브라우저가 blob 을 스타일시트로 쓰지 않을 수 있다.
    const files = await unzip(zip());

    expect(files.get('deck/css/deck.css')?.type).toBe('text/css');
    expect(files.get('deck/img/logo.svg')?.type).toBe('image/svg+xml');
    expect(files.get('deck/fonts/mono.woff2')?.type).toBe('font/woff2');
  });

  it('푼 묶음에서 열 문서를 고르고 그 자리를 기준으로 자원을 찾는다', async () => {
    const files = await unzip(zip());
    const path = pickDocument(files.keys());
    expect(path).toBe('deck/index.html');

    const source = (await files.get(path ?? '')?.text()) ?? '';
    const refs = parseAssetRefs(source, dirOf(path ?? ''));

    // 문서가 deck/ 안에 있으므로 참조도 그 자리에서 풀려야 zip 안의 경로와 맞는다.
    expect(refs.map((r) => r.path)).toEqual([
      'deck/css/deck.css',
      'deck/img/logo.svg',
      'deck/js/deck.js',
    ]);
    for (const ref of refs) expect(files.has(ref.path)).toBe(true);
  });

  it('바깥 링크는 자원으로 세지 않는다', async () => {
    const files = await unzip(zip());
    const source = (await files.get('deck/index.html')?.text()) ?? '';

    expect(source).toContain('href="https://example.com/"');
    expect(parseAssetRefs(source, 'deck').some((r) => r.url.startsWith('http'))).toBe(false);
  });

  it('문서가 여럿이면 후보를 모두 알 수 있다', async () => {
    // 하나를 골라 열되, 나머지가 있다는 사실을 잃지 않아야 한다 (대원칙 3).
    const files = await unzip(zip());
    const withMore = new Map(files);
    withMore.set('deck/appendix.html', new Blob(['<p>부록</p>'], { type: 'text/html' }));

    const candidates = documentCandidates(withMore.keys());

    expect(candidates).toEqual(['deck/index.html', 'deck/appendix.html']);
    expect(pickDocument(withMore.keys())).toBe('deck/index.html');
  });
});

describe('unzip · 조작된 크기 (spec §6)', () => {
  /** 진짜 zip 의 목차(중앙 디렉터리)에서 한 항목의 "풀었을 때 크기" 만 바꿔치기한다 */
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

  it('목차에 작게 적어 두고 크게 풀리는 항목은 거부한다', async () => {
    // 목차의 크기만 믿으면 zip 폭탄이 한도 검사를 통과한다. 실제로 나온 바이트로 잡는다.
    const forged = forgeSize(fixtureBundle(), 'deck/index.html', 3);

    // 문장이 아니라 코드다 — 사람이 읽을 문장은 언어팩이 만든다 (spec §1).
    await expect(unzip(new Blob([forged as BlobPart]))).rejects.toMatchObject({
      code: 'sizeMismatch',
      params: { name: 'deck/index.html' },
    });
  });

  it('목차에 크게 적힌 항목은 풀기 전에 거른다', async () => {
    const forged = forgeSize(fixtureBundle(), 'deck/index.html', 65 * 1024 * 1024);

    await expect(unzip(new Blob([forged as BlobPart]))).rejects.toMatchObject({ code: 'tooBig' });
  });
});
