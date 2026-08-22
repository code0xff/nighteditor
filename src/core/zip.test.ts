import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { crc32 } from 'node:zlib';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 as ourCrc32, readZip, ZipError } from './zip.js';
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

  it('풀었을 때의 CRC 를 중앙 디렉터리에서 읽는다', () => {
    // 크기만으로는 같은 크기로 깨진 바이트를 못 가린다 — 내용 검사는 이 값으로 한다.
    const stored = find('deck/js/deck.js');
    expect(stored?.method).toBe(0);
    // 그대로 담긴 항목은 data 가 곧 풀린 바이트다. 기준은 node 의 crc32 다.
    expect(stored?.crc).toBe(crc32(stored?.data ?? new Uint8Array()));
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

  it('제 위치를 목차 칸에 적은 가짜 "빈 zip" EOCD 에도 속지 않는다', () => {
    // 빈 zip 의 목차는 크기 0 이라 EOCD 자리에서 시작한다. 가짜도 제 위치를 목차
    // 칸에 적으면 같은 꼴이 된다 — 그 자리만 보고 믿으면 멀쩡한 zip 이 빈 묶음으로
    // 열린다. 더 앞의 실제 목차가 달린 EOCD 가 이겨야 한다.
    const zip = fixtureBundle();
    const fake = new Uint8Array(22);
    const fakeView = new DataView(fake.buffer);
    fakeView.setUint32(0, 0x06054b50, true);
    fakeView.setUint32(16, zip.length, true); // 목차 위치 = 가짜 레코드 제 위치
    const withComment = new Uint8Array(zip.length + fake.length);
    withComment.set(zip);
    withComment.set(fake, zip.length);
    new DataView(withComment.buffer).setUint16(zip.length - 2, fake.length, true);

    const names = readZip(withComment).map((e) => e.name);

    expect(names).toContain('deck/index.html');
  });

  it('진짜 빈 zip 은 빈 목록으로 열린다 — 문서가 없다는 사정은 부르는 쪽이 말한다', () => {
    // 빈 zip 은 EOCD 하나가 전부다. 이것까지 거절하면 "zip 이 아니다" 가 거짓말이 된다.
    const empty = new Uint8Array(22);
    new DataView(empty.buffer).setUint32(0, 0x06054b50, true);

    expect(readZip(empty)).toEqual([]);
  });

  it('주석 끝의 zip64 흉내 레코드에 속지 않는다 — 진짜 목차로 연다', () => {
    // zip64 칸(0xFF..)을 실은 가짜는 끝-정렬 검사를 통과하고, 즉시 믿으면 멀쩡한
    // zip 이 "zip64 미지원" 으로 거절된다. 받아 두고 더 앞의 진짜 EOCD 를 찾아야 한다.
    const zip = fixtureBundle();
    const fake = new Uint8Array(22);
    const fakeView = new DataView(fake.buffer);
    fakeView.setUint32(0, 0x06054b50, true);
    fakeView.setUint16(10, 0xffff, true); // 항목 수를 zip64 표식으로
    const withComment = new Uint8Array(zip.length + fake.length);
    withComment.set(zip);
    withComment.set(fake, zip.length);
    new DataView(withComment.buffer).setUint16(zip.length - 2, fake.length, true);

    const names = readZip(withComment).map((e) => e.name);

    expect(names).toContain('deck/index.html');
  });

  it('진짜 목차가 없는 zip64 꼴은 미지원 사유로 멈춘다 — zip 이 아니라고 하지 않는다', () => {
    // zip64 는 이 칸들을 0xFF.. 로 채우고 실제 값을 따로 둔다. 읽지는 못해도
    // 사유는 정확해야 한다 (대원칙 3).
    const eocd = new Uint8Array(22);
    const dv = new DataView(eocd.buffer);
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(10, 0xffff, true);

    expect(() => readZip(eocd)).toThrow(expect.objectContaining({ code: 'zip64' }));
  });

  it('EOCD 보다 짧은 입력은 zip 이 아니라는 사유로 멈춘다', () => {
    // 훑기 시작점이 음수라 아예 돌지 않고, 우리 진단으로 떨어져야 한다 —
    // DataView 의 RangeError 원문이 새면 언어팩 대신 브라우저 문장이 보인다.
    for (const len of [0, 1, 10, 21]) {
      expect(() => readZip(new Uint8Array(len).fill(0x50))).toThrow(
        expect.objectContaining({ code: 'notZip' })
      );
    }
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

  it('목차 항목이 EOCD 를 넘어가면 지어낸 항목 없이 멈춘다', () => {
    // 이름 길이를 부풀린 목차는 subarray 가 조용히 잘라 준 바이트로 가짜 이름을
    // 만들고, 커서는 버퍼 밖으로 걸어 나간다. 항목 하나짜리 목차라면 그 가짜가
    // 유일한 "파일" 이 되어, 깨진 zip 이 문서 없는 묶음 행세를 한다 (spec §6).
    const zip = new Uint8Array(fixtureBundle());
    const dv = new DataView(zip.buffer);
    dv.setUint16(zip.length - 22 + 10, 1, true); // 항목 수를 1로 — 넘친 항목이 마지막이 되게
    const centralAt = dv.getUint32(zip.length - 22 + 16, true);
    dv.setUint16(centralAt + 28, 0xffff, true); // 이름 길이를 부풀린다

    expect(() => readZip(zip)).toThrow(expect.objectContaining({ code: 'badCentral' }));
  });

  /** 이름이 `want` 인 중앙 레코드의 위치. 픽스처엔 부가 필드가 없어 이름은 ASCII 그대로다 */
  function centralRecordOf(zip: Uint8Array, want: string): number {
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let at = dv.getUint32(zip.length - 22 + 16, true);
    for (;;) {
      const nameLength = dv.getUint16(at + 28, true);
      const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
      if (name === want) return at;
      at += 46 + nameLength + dv.getUint16(at + 30, true) + dv.getUint16(at + 32, true);
    }
  }

  it('UTF-8 표시가 없는 이름은 CP437 로 읽는다', () => {
    // 픽스처의 이름은 전부 플래그 0(UTF-8 표시 없음)으로 적혀 있다. 이름에 0x82 를
    // 심으면 CP437 로는 é, 무조건 UTF-8 로 풀면 U+FFFD 다 — 키가 깨지면 문서 후보도
    // 상대 자원도 그 이름으로는 안 잡힌다.
    const zip = new Uint8Array(fixtureBundle());
    const at = centralRecordOf(zip, 'deck/index.html');
    zip[at + 46 + 'deck/'.length] = 0x82; // 'index' 의 i 자리

    const names = readZip(zip).map((e) => e.name);

    expect(names).toContain('deck/éndex.html');
  });

  /** 유니코드 경로 부가 필드(0x7075)를 한 항목에 끼워 넣은 픽스처 변형 */
  function withUnicodePath(utf8Name: string, crcOk: boolean): Uint8Array {
    const zip = new Uint8Array(fixtureBundle());
    const dv = new DataView(zip.buffer);
    const at = centralRecordOf(zip, 'deck/index.html');
    const nameLength = dv.getUint16(at + 28, true);
    const nameBytes = zip.subarray(at + 46, at + 46 + nameLength);
    const encoded = new TextEncoder().encode(utf8Name);
    const field = new Uint8Array(4 + 5 + encoded.length);
    const fdv = new DataView(field.buffer);
    fdv.setUint16(0, 0x7075, true);
    fdv.setUint16(2, 5 + encoded.length, true);
    field[4] = 1; // 필드 버전
    fdv.setUint32(5, crcOk ? crc32(nameBytes) : 0xdeadbeef, true);
    field.set(encoded, 9);

    const insertAt = at + 46 + nameLength + dv.getUint16(at + 30, true);
    const out = new Uint8Array(zip.length + field.length);
    out.set(zip.subarray(0, insertAt));
    out.set(field, insertAt);
    out.set(zip.subarray(insertAt), insertAt + field.length);
    new DataView(out.buffer).setUint16(at + 30, dv.getUint16(at + 30, true) + field.length, true);
    return out;
  }

  it('유니코드 경로 부가 필드의 CRC 가 표준 이름과 맞으면 그쪽 이름을 쓴다', () => {
    const names = readZip(withUnicodePath('deck/실제이름.html', true)).map((e) => e.name);

    expect(names).toContain('deck/실제이름.html');
    expect(names).not.toContain('deck/index.html');
  });

  it('CRC 가 어긋난 유니코드 경로 필드는 옛것이다 — 표준 이름을 쓴다', () => {
    // 이름만 바뀌고 필드는 갱신되지 않은 zip 이 있다. 무조건 믿으면 옛 이름이 키가 된다.
    const names = readZip(withUnicodePath('deck/옛이름.html', false)).map((e) => e.name);

    expect(names).toContain('deck/index.html');
    expect(names).not.toContain('deck/옛이름.html');
  });

  it('UTF-8 표시(bit 11)가 선 이름의 깨진 바이트는 U+FFFD 로 푼다', () => {
    // TextDecoder 없이 직접 푸는 경로다 (INV-6) — 깨진 바이트에서 죽거나 조용히
    // 건너뛰지 않고, 표준 디코더처럼 그 자리만 대체 문자로 남긴다.
    const zip = new Uint8Array(fixtureBundle());
    const dv = new DataView(zip.buffer);
    const at = centralRecordOf(zip, 'deck/index.html');
    dv.setUint16(at + 8, 0x0800, true); // UTF-8 이름 플래그
    zip[at + 46 + 'deck/'.length] = 0x82; // 홀로 온 이어짐 바이트 — UTF-8 이 아니다

    const names = readZip(zip).map((e) => e.name);

    expect(names).toContain('deck/�ndex.html');
  });

  it('과잉 표기(overlong)는 올바른 UTF-8 이 아니다 — CP437 로 넘어간다', () => {
    // 0xC0 0xAF 는 '/' 의 과잉 표기다. 엄격 판정이 이걸 받으면 이름 속에 경로
    // 구분자가 숨어 들어온다 — 표준 디코더와 같이 거절해야 한다.
    const zip = new Uint8Array(fixtureBundle());
    const at = centralRecordOf(zip, 'deck/index.html');
    zip[at + 46 + 'deck/'.length] = 0xc0;
    zip[at + 46 + 'deck/i'.length] = 0xaf;

    const names = readZip(zip).map((e) => e.name);

    expect(names).toContain('deck/└»dex.html');
  });

  it('표시 없는 4바이트 UTF-8 이름도 그대로 읽는다', () => {
    // BMP 밖(이모지)까지 — 손으로 푼 디코더가 서로게이트 쌍을 제대로 만드는지.
    const zip = new Uint8Array(fixtureBundle());
    const at = centralRecordOf(zip, 'deck/index.html');
    zip.set([0xf0, 0x9f, 0x93, 0x84], at + 46 + 'deck/'.length); // 📄 가 'inde' 자리에

    const names = readZip(zip).map((e) => e.name);

    expect(names).toContain('deck/📄x.html');
  });

  it('파일 수 한도를 목차를 읽는 동안 센다', () => {
    // 다 만들고 나서 세면 거절할 zip 의 항목을 전부(최대 65,534개) 만든 뒤에야
    // 거절하게 된다 — 한도는 담는 수가 아니라 읽는 일 자체를 묶는다 (spec §5.1).
    expect(() => readZip(fixtureBundle(), 2)).toThrow(
      expect.objectContaining({ code: 'tooManyFiles', params: { limit: 2 } })
    );
    // 한도 안이면 그대로 다 읽힌다.
    expect(readZip(fixtureBundle(), 5)).toHaveLength(5);
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

describe('crc32 · 기준 구현과의 대조', () => {
  it('IEEE CRC-32 와 같고, 조각으로 이어 재도 같다', () => {
    // 압축 해제는 스트림 조각으로 나온다 — 이어 재는 seed 가 틀리면 멀쩡한 zip 이
    // 전부 깨졌다며 거절된다. 기준은 node 의 crc32 다.
    const bytes = fixtureBundle();
    expect(ourCrc32(bytes)).toBe(crc32(bytes));
    const mid = Math.floor(bytes.length / 3);
    expect(ourCrc32(bytes.subarray(mid), ourCrc32(bytes.subarray(0, mid)))).toBe(crc32(bytes));
  });
});
