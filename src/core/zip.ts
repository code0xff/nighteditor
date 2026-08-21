/**
 * zip 읽기 — 중앙 디렉터리 파싱까지 (spec §5.1).
 *
 * 압축 해제는 하지 않는다. 그건 브라우저가 `DecompressionStream` 으로 해주므로
 * `lib/zip.ts` 의 몫이다 (INV-6). 여기서는 "어떤 파일이 어디에 있는지"만 읽는다.
 *
 * 크기와 위치는 **중앙 디렉터리**에서만 읽는다. 로컬 헤더의 크기 칸은 스트리밍으로
 * 만든 zip 에서 0 으로 비어 있고 실제 값은 데이터 뒤에 붙는다 (data descriptor).
 * 중앙 디렉터리는 언제나 채워져 있다.
 */

/** 거부 사유. `core/` 는 화면 언어를 모르므로 문장이 아니라 코드를 넘긴다 (INV-6) */
export type ZipErrorCode =
  | 'notZip'
  | 'zip64'
  | 'badCentral'
  | 'encrypted'
  | 'badLocal'
  | 'dataTruncated'
  | 'tooManyFiles'
  | 'tooBig'
  | 'unknownMethod'
  | 'sizeMismatch';

/**
 * zip 거부. `message` 는 개발자용 진단이고, 사용자에게 보이는 문장은
 * `code` + `params` 를 언어팩(`lib/messages.ts`)이 옮긴 결과다 — `PatchError` 와 같다.
 */
export class ZipError extends Error {
  constructor(
    readonly code: ZipErrorCode,
    readonly params: Record<string, string | number>,
    message: string
  ) {
    super(message);
  }
}

export interface ZipEntry {
  name: string;
  /** 0 = 그대로 담김, 8 = deflate */
  method: number;
  /** 압축된 그대로의 바이트 */
  data: Uint8Array;
  /** 풀었을 때의 크기 */
  size: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** EOCD 는 최대 22 + 65535 바이트 뒤에 있다 (주석 길이 상한) */
const EOCD_MAX_BACK = 22 + 0xffff;

/** zip 은 리틀엔디언이다 */
function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function findEocd(bytes: Uint8Array): number {
  const dv = view(bytes);
  const from = Math.max(0, bytes.length - EOCD_MAX_BACK);
  // 뒤에서 처음 만난 zip64 꼴 후보. 진짜 목차를 찾으면 버리고, 못 찾으면 이것으로
  // zip64 미지원을 말한다 — "zip 이 아니다" 는 거짓말이 되기 때문이다.
  let zip64At = -1;
  for (let at = bytes.length - 22; at >= from; at--) {
    if (dv.getUint32(at, true) !== EOCD_SIGNATURE) continue;
    // 시그니처만으로는 모자란다 — zip 주석 안에 같은 네 바이트가 우연히(또는 일부러)
    // 들어 있을 수 있고, 그걸 EOCD 로 읽으면 주석 바이트가 목차 위치·개수로 풀려
    // 멀쩡한 zip 을 거절하거나 빈 묶음으로 읽는다. 진짜 EOCD 는 자기 주석이
    // 버퍼 끝에 정확히 닿는다 — 안 닿는 후보는 지나치고 더 앞을 찾는다.
    if (at + 22 + dv.getUint16(at + 20, true) !== bytes.length) continue;
    const count = dv.getUint16(at + 10, true);
    const centralAt = dv.getUint32(at + 16, true);
    // zip64 는 이 칸들을 0xFF.. 로 채운다. 그러나 주석 끝의 가짜 EOCD 도 같은 값을
    // 실을 수 있다 — 여기서 바로 돌아가면 멀쩡한 zip 이 zip64 미지원으로 거절된다.
    // 받아 두고 더 앞의 진짜 EOCD 를 마저 찾는다 (spec §6 · zip64 흉내 레코드).
    if (count === 0xffff || centralAt === 0xffffffff) {
      if (zip64At < 0) zip64At = at;
      continue;
    }
    // 주석 끝머리에 실린 22바이트짜리 가짜 EOCD 는 위 검사도 통과한다 — 제 주석 길이를
    // 0 으로 적으면 끝에 닿는다. 목차 칸이 실제 목차를 가리키는지까지 확인해야
    // 멀쩡한 zip 이 (개수 0짜리 가짜를 믿고) 빈 묶음으로 열리지 않는다.
    // 빈 zip 의 목차는 크기 0 이라 EOCD 자리에서 시작한다.
    const dirValid =
      count === 0
        ? centralAt === at
        : centralAt + 46 <= at && dv.getUint32(centralAt, true) === CENTRAL_SIGNATURE;
    if (dirValid) return at;
  }
  // 진짜 목차는 없었다. zip64 꼴 후보가 있었으면 그쪽 사정(미지원)으로 말한다 —
  // 여기서 바로 던져야 이 함수의 반환이 언제나 "검증된 EOCD" 로 남는다. 후보의
  // offset 을 돌려주면 부르는 쪽이 표식 칸을 다시 봐 주기를 믿는 수밖에 없다.
  if (zip64At >= 0) throw new ZipError('zip64', {}, 'zip64 is not supported');
  throw new ZipError('notZip', {}, 'not a zip, or the end is cut off');
}

/**
 * 파일 목록을 읽는다. 디렉터리 항목과 맥OS 가 끼워 넣는 `__MACOSX` 는 걸러낸다.
 *
 * 못 읽는 zip 은 조용히 빈 목록을 주지 않고 이유를 들고 던진다 (대원칙 3).
 *
 * @param maxFiles 담을 파일 수의 한도. 목차를 읽는 **동안** 세서, 넘는 zip 은
 *   항목을 끝까지 만들지 않고 거절한다 — 다 만들고 나서 세면 한도가 있으나 마나다
 *   (spec §5.1). 같은 이름이 겹쳐도 항목마다 센다.
 */
export function readZip(bytes: Uint8Array, maxFiles = Number.POSITIVE_INFINITY): ZipEntry[] {
  const dv = view(bytes);
  const eocd = findEocd(bytes);

  // findEocd 가 돌려준 EOCD 는 검증을 마친 것이다 — zip64 표식(0xFF..)이 실린
  // 후보는 저쪽에서 이미 zip64 사유로 던졌으므로 여기 값은 그대로 믿는다.
  const count = dv.getUint16(eocd + 10, true);
  const centralAt = dv.getUint32(eocd + 16, true);

  const entries: ZipEntry[] = [];
  let at = centralAt;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || dv.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError('badCentral', {}, 'broken central directory');
    }
    const flags = dv.getUint16(at + 8, true);
    const method = dv.getUint16(at + 10, true);
    const compressed = dv.getUint32(at + 20, true);
    const size = dv.getUint32(at + 24, true);
    const nameLength = dv.getUint16(at + 28, true);
    const extraLength = dv.getUint16(at + 30, true);
    const commentLength = dv.getUint16(at + 32, true);
    const localAt = dv.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    // 암호화된 항목은 풀 수 없다. 반쯤 읽어 깨진 파일을 붙이느니 말하고 멈춘다.
    if (flags & 0x1) throw new ZipError('encrypted', { name }, `encrypted entry: ${name}`);
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;

    if (entries.length >= maxFiles) {
      throw new ZipError('tooManyFiles', { limit: maxFiles }, `too many files (limit ${maxFiles})`);
    }

    // 조작된 목차는 localAt 을 버퍼 밖에 둘 수 있다. 경계를 먼저 보지 않으면
    // DataView 가 던진 RangeError 원문이 그대로 나가, 언어팩의 zip 진단 대신
    // 브라우저 문장이 보인다 — 오류는 언제나 우리 코드로 말한다 (대원칙 3).
    if (localAt + 30 > bytes.length || dv.getUint32(localAt, true) !== LOCAL_SIGNATURE) {
      throw new ZipError('badLocal', { name }, `local header not found: ${name}`);
    }
    // 로컬 헤더의 이름·부가 필드 길이는 중앙 디렉터리와 다를 수 있다. 여기 값을 쓴다.
    const dataAt =
      localAt + 30 + dv.getUint16(localAt + 26, true) + dv.getUint16(localAt + 28, true);
    if (dataAt + compressed > bytes.length) {
      throw new ZipError('dataTruncated', { name }, `data is cut off: ${name}`);
    }

    entries.push({ name, method, size, data: bytes.subarray(dataAt, dataAt + compressed) });
  }
  return entries;
}
