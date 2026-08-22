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

describe('unzip · 한도를 넘는 zip 은 올리기 전에 거절한다 (spec §5.1)', () => {
  it('arrayBuffer 로 복사하기 전에 크기만 보고 멈춘다', async () => {
    // 복사부터 하면 한도가 있으나 마나다 — 수백 MB 를 옮기는 동안 탭이 굳는다.
    // 진짜 그 크기의 Blob 을 만들 필요는 없다. 보는 것은 size 뿐이어야 하니까.
    const huge = {
      size: 512 * 1024 * 1024,
      arrayBuffer: () => {
        throw new Error('한도 검사 전에 통째로 복사했다');
      },
    } as unknown as Blob;

    await expect(unzip(huge)).rejects.toMatchObject({ code: 'tooBig' });
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

describe('unzip · 깨진 내용은 목차의 CRC 로 잡는다 (spec §6)', () => {
  /** 목차에서 항목을 찾아 [로컬 헤더 위치, 압축된 크기, 목차의 CRC 칸 위치]를 돌려준다 */
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

  it('그대로 담긴 항목의 바이트가 한 개만 뒤집혀도 거부한다', async () => {
    // 크기 검사는 이 경우를 절대 못 잡는다 — 뒤집힌 바이트도 크기는 그대로다.
    const out = fixtureBundle().slice();
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    // deck/js/deck.js 는 그대로 담긴(method 0) 항목이다 — 로컬 헤더 뒤의 데이터를 뒤집는다.
    const { localAt } = centralOf(out, 'deck/js/deck.js');
    const dataAt =
      localAt + 30 + dv.getUint16(localAt + 26, true) + dv.getUint16(localAt + 28, true);
    out[dataAt] = (out[dataAt] as number) ^ 0xff;

    await expect(unzip(new Blob([out as BlobPart]))).rejects.toMatchObject({
      code: 'crcMismatch',
      params: { name: 'deck/js/deck.js' },
    });
  });

  it('압축된 항목도 실제로 풀린 바이트를 목차의 CRC 와 견준다', async () => {
    // 목차의 CRC 를 바꿔치기하면 내용과 어긋난다 — 풀린 바이트로 재지 않으면 못 잡는다.
    const out = fixtureBundle().slice();
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const { crcAt } = centralOf(out, 'deck/index.html');
    dv.setUint32(crcAt, dv.getUint32(crcAt, true) ^ 0xffffffff, true);

    await expect(unzip(new Blob([out as BlobPart]))).rejects.toMatchObject({
      code: 'crcMismatch',
      params: { name: 'deck/index.html' },
    });
  });

  it('멀쩡한 zip 은 그대로 통과한다', async () => {
    const files = await unzip(zip());
    expect(files.has('deck/index.html')).toBe(true);
  });
});
