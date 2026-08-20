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

export class ZipError extends Error {}

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
  for (let at = bytes.length - 22; at >= from; at--) {
    if (dv.getUint32(at, true) === EOCD_SIGNATURE) return at;
  }
  throw new ZipError('zip 이 아니거나 끝이 잘렸다');
}

/**
 * 파일 목록을 읽는다. 디렉터리 항목과 맥OS 가 끼워 넣는 `__MACOSX` 는 걸러낸다.
 *
 * 못 읽는 zip 은 조용히 빈 목록을 주지 않고 이유를 들고 던진다 (대원칙 3).
 */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const dv = view(bytes);
  const eocd = findEocd(bytes);

  const count = dv.getUint16(eocd + 10, true);
  const centralAt = dv.getUint32(eocd + 16, true);
  // zip64 는 이 칸들을 전부 0xFF.. 로 채우고 실제 값을 따로 둔다. 지원하지 않는다.
  if (count === 0xffff || centralAt === 0xffffffff) {
    throw new ZipError('zip64 는 읽지 못한다');
  }

  const entries: ZipEntry[] = [];
  let at = centralAt;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || dv.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError('중앙 디렉터리가 깨졌다');
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
    if (flags & 0x1) throw new ZipError(`암호가 걸린 항목이 있다: ${name}`);
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;

    if (dv.getUint32(localAt, true) !== LOCAL_SIGNATURE) {
      throw new ZipError(`로컬 헤더를 찾지 못했다: ${name}`);
    }
    // 로컬 헤더의 이름·부가 필드 길이는 중앙 디렉터리와 다를 수 있다. 여기 값을 쓴다.
    const dataAt =
      localAt + 30 + dv.getUint16(localAt + 26, true) + dv.getUint16(localAt + 28, true);
    if (dataAt + compressed > bytes.length) throw new ZipError(`데이터가 잘렸다: ${name}`);

    entries.push({ name, method, size, data: bytes.subarray(dataAt, dataAt + compressed) });
  }
  return entries;
}
