/**
 * zip 해제. 압축 알고리즘은 브라우저가 가지고 있다 (`DecompressionStream`).
 *
 * 라이브러리를 더하지 않는다 — zip 안의 압축은 헤더 없는 deflate 그대로라
 * `deflate-raw` 스트림에 그대로 흘려보내면 된다. 이 기기 밖으로는 아무것도 나가지 않는다.
 */
import { readZip, ZipError } from '@/core/zip';
import { mimeOf } from './assets';
import { FOLDER_LIMITS } from './fs';

/** 그대로 담김(0) 과 deflate(8) 만 쓰인다. 그 밖은 실무에서 거의 없다 */
const STORED = 0;
const DEFLATE = 8;

/**
 * 한도를 들고 푼다. 목차의 크기는 조작될 수 있으므로 **실제로 나온 바이트**를 세고,
 * 넘는 순간 끊는다 — 다 풀어 놓고 재면 그 사이 탭이 이미 굳는다.
 */
async function inflate(data: Uint8Array, budget: number): Promise<Blob> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: BlobPart[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > budget) {
      await reader.cancel();
      throw new ZipError('풀면 너무 커진다');
    }
    chunks.push(value as BlobPart);
  }
  return new Blob(chunks);
}

/**
 * zip 을 경로 → 파일 묶음으로 푼다.
 *
 * 푸는 데도 폴더와 같은 한도를 둔다. 압축은 작아도 풀면 얼마든지 커질 수 있어서,
 * 한도 없이 풀면 파일 몇 개짜리 zip 하나로 탭이 굳는다.
 *
 * 목차(중앙 디렉터리)의 크기는 **빨리 거르는 데만** 쓴다. 목차만 믿으면 작다고 적어
 * 두고 크게 부푸는 조작된 zip 이 통과하므로, 한도는 실제로 나온 바이트로 다시 세고
 * 목차와 다르면 조작으로 보고 멈춘다 (대원칙 3).
 */
export async function unzip(zip: Blob): Promise<Map<string, Blob>> {
  const files = new Map<string, Blob>();
  let bytes = 0;

  for (const entry of readZip(new Uint8Array(await zip.arrayBuffer()))) {
    if (files.size >= FOLDER_LIMITS.files) {
      throw new ZipError(`파일이 너무 많다 (${FOLDER_LIMITS.files}개까지)`);
    }
    if (bytes + entry.size > FOLDER_LIMITS.bytes) {
      throw new ZipError('풀면 너무 커진다');
    }
    const type = mimeOf(entry.name);
    let blob: Blob;
    if (entry.method === STORED) {
      blob = new Blob([entry.data as BlobPart], { type });
    } else if (entry.method === DEFLATE) {
      blob = new Blob([await inflate(entry.data, FOLDER_LIMITS.bytes - bytes)], { type });
    } else {
      throw new ZipError(`처음 보는 압축 방식이다 (${entry.method}): ${entry.name}`);
    }
    // 반쯤 맞는 파일을 조용히 붙이느니 여기서 멈춘다.
    if (blob.size !== entry.size) {
      throw new ZipError(`목차의 크기와 실제 크기가 다르다: ${entry.name}`);
    }
    bytes += blob.size;
    files.set(entry.name, blob);
  }

  return files;
}
