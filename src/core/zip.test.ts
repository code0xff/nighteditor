import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readZip, ZipError } from './zip.js';
import { fixtureBundle } from '../__fixtures__/load.js';

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/**
 * 손으로 조립한 바이트가 아니라 **진짜 zip** 으로 검사한다.
 * 직접 만든 헤더는 내 오해까지 그대로 베껴 담아서, 파서가 맞는지 틀리는지를 가리지 못한다.
 *
 * 기본은 커밋된 픽스처다. `zip` 이 있는 환경에서는 그 자리에서 만든 것도 함께 본다.
 */
function realZip(files: Record<string, string>, args: string[] = []): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), 'ne-zip-'));
  for (const [name, body] of Object.entries(files)) {
    const at = join(dir, name);
    mkdirSync(join(at, '..'), { recursive: true });
    writeFileSync(at, body);
  }
  execFileSync('zip', ['-q', '-r', ...args, 'out.zip', '.'], { cwd: dir });
  return new Uint8Array(readFileSync(join(dir, 'out.zip')));
}

function hasZipCommand(): boolean {
  try {
    execFileSync('zip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('readZip · 픽스처 회귀', () => {
  const entries = readZip(fixtureBundle());
  const find = (name: string) => entries.find((e) => e.name === name);

  it('하위 폴더의 경로를 그대로 유지한다', () => {
    // 문서가 deck/ 안에 있으므로 자원도 그 자리를 기준으로 찾아야 한다.
    expect(entries.map((e) => e.name).sort()).toEqual([
      'deck/css/deck.css',
      'deck/fonts/mono.woff2',
      'deck/img/logo.svg',
      'deck/index.html',
      'deck/js/deck.js',
    ]);
  });

  it('디렉터리 항목과 __MACOSX 는 파일이 아니다', () => {
    expect(entries.some((e) => e.name.endsWith('/'))).toBe(false);
    expect(entries.some((e) => e.name.startsWith('__MACOSX/'))).toBe(false);
  });

  it('풀었을 때의 크기를 중앙 디렉터리에서 읽는다', () => {
    // 로컬 헤더의 크기 칸은 비어 있을 수 있다. 중앙 디렉터리는 언제나 채워져 있다.
    expect(find('deck/index.html')?.size).toBeGreaterThan(300);
    expect(find('deck/img/logo.svg')?.size).toBe(107);
  });

  it('압축된 항목은 deflate 로 표시된다', () => {
    expect(find('deck/index.html')?.method).toBe(8);
  });

  it('끝이 잘리면 이유를 들고 던진다', () => {
    const zip = fixtureBundle();

    expect(() => readZip(zip.subarray(0, zip.length - 8))).toThrow(ZipError);
  });

  it('zip 이 아니면 조용히 빈 목록을 주지 않는다', () => {
    // 조용히 넘어가면 "열었는데 아무것도 없다" 로 보인다 (대원칙 3).
    expect(() => readZip(new TextEncoder().encode('이건 zip 이 아니다'))).toThrow(ZipError);
  });

  it('주석 안에 EOCD 시그니처 바이트가 있어도 진짜 EOCD 를 찾는다', () => {
    // 뒤에서부터 훑다 주석 속 바이트를 먼저 만나면, 주석이 목차 위치·개수로 풀려
    // 멀쩡한 zip 이 깨졌다며 거절된다. 진짜 EOCD 는 주석이 버퍼 끝까지 닿는다.
    const zip = fixtureBundle();
    // 시그니처 네 바이트 뒤로 'x' 를 길게 — 그 자리를 EOCD 로 읽으면 어느 칸도 맞지 않는다.
    const comment = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...Array(30).fill(0x78)]);
    const withComment = new Uint8Array(zip.length + comment.length);
    withComment.set(zip);
    withComment.set(comment, zip.length);
    // 픽스처는 주석이 없다 — EOCD 가 마지막 22바이트라, 주석 길이 칸은 끝에서 두 바이트다.
    new DataView(withComment.buffer).setUint16(zip.length - 2, comment.length, true);

    const names = readZip(withComment).map((e) => e.name);

    expect(names).toContain('deck/index.html');
  });

  it('주석 끝의 가짜 EOCD 레코드를 진짜로 믿지 않는다', () => {
    // 주석이 22바이트짜리 EOCD 모양으로 끝나면(제 주석 길이 0 → 끝에 닿음) 끝-정렬
    // 검사만으로는 걸러지지 않는다. 개수·목차 위치가 0 인 가짜를 믿으면 멀쩡한 zip 이
    // 빈 묶음으로 열린다 — 목차 칸이 실제 목차를 가리키는지까지 봐야 한다.
    const zip = fixtureBundle();
    const fake = new Uint8Array(22);
    new DataView(fake.buffer).setUint32(0, 0x06054b50, true); // 나머지 칸은 전부 0
    const withComment = new Uint8Array(zip.length + fake.length);
    withComment.set(zip);
    withComment.set(fake, zip.length);
    // 진짜 EOCD 의 주석 길이 칸이 뒤에 붙인 가짜까지 덮게 한다.
    new DataView(withComment.buffer).setUint16(zip.length - 2, fake.length, true);

    const names = readZip(withComment).map((e) => e.name);

    expect(names).toContain('deck/index.html');
  });

  it('목차가 버퍼 밖의 로컬 헤더를 가리키면 우리 진단으로 멈춘다', () => {
    // DataView 의 RangeError 가 먼저 터지면 언어팩 진단 대신 브라우저 원문이 나간다.
    const zip = new Uint8Array(fixtureBundle());
    const dv = new DataView(zip.buffer);
    // 픽스처는 주석이 없어 EOCD 가 마지막 22바이트다. 디렉터리 항목은 로컬 헤더를
    // 읽기 전에 걸러지므로, 목차를 걸어 **첫 파일 항목**의 로컬 위치를 조작한다.
    const centralAt = dv.getUint32(zip.length - 22 + 16, true);
    let at = centralAt;
    for (;;) {
      const nameLength = dv.getUint16(at + 28, true);
      const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
      if (!name.endsWith('/') && !name.startsWith('__MACOSX/')) break;
      at += 46 + nameLength + dv.getUint16(at + 30, true) + dv.getUint16(at + 32, true);
    }
    dv.setUint32(at + 42, 0xfffffff0, true);

    expect(() => readZip(zip)).toThrow(expect.objectContaining({ code: 'badLocal' }));
  });
});

describe.skipIf(!hasZipCommand())('readZip · 그 자리에서 만든 zip', () => {
  it('압축된 항목의 이름·크기·방식을 읽는다', () => {
    // 잘 압축되도록 길게 — 짧은 파일은 zip 이 그냥 담아버린다.
    const body = '한 줄이 반복된다\n'.repeat(200);
    const entries = readZip(realZip({ 'deck.html': body }));
    const deck = entries.find((e) => e.name === 'deck.html');

    expect(deck?.method).toBe(8);
    expect(deck?.size).toBe(new TextEncoder().encode(body).length);
    expect(deck?.data.length).toBeLessThan(deck?.size ?? 0);
  });

  it('압축하지 않고 담은 항목은 바이트 그대로다', () => {
    // -0 은 전부 그대로 담는다. 그때는 해제 없이 바로 쓸 수 있어야 한다.
    const entries = readZip(realZip({ 'a.txt': '있는 그대로' }, ['-0']));

    expect(entries[0]?.method).toBe(0);
    expect(decode(entries[0]?.data ?? new Uint8Array())).toBe('있는 그대로');
  });

  it('한글 파일 이름을 읽는다', () => {
    const entries = readZip(realZip({ '발표 자료.html': 'x' }));

    expect(entries[0]?.name).toBe('발표 자료.html');
  });

  it('암호가 걸린 항목은 반쯤 읽지 않고 멈춘다', () => {
    const zip = realZip({ 'deck.html': '비밀' }, ['-P', 'pw']);

    // 어느 항목인지는 파라미터로 넘긴다 — 문장은 언어팩이 만든다 (spec §1).
    expect(() => readZip(zip)).toThrow(
      expect.objectContaining({ code: 'encrypted', params: { name: 'deck.html' } })
    );
  });
});
