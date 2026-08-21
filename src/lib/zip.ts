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

async function inflate(data: Uint8Array): Promise<Blob> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).blob();
}

/**
 * zip 을 경로 → 파일 묶음으로 푼다.
 *
 * 푸는 데도 폴더와 같은 한도를 둔다. 압축은 작아도 풀면 얼마든지 커질 수 있어서,
 * 한도 없이 풀면 파일 몇 개짜리 zip 하나로 탭이 굳는다. 크기는 **풀기 전에** 본다 —
 * 다 풀어 놓고 재면 이미 늦다.
 */
export async function unzip(zip: Blob): Promise<Map<string, Blob>> {
  const files = new Map<string, Blob>();
  let bytes = 0;

  for (const entry of readZip(new Uint8Array(await zip.arrayBuffer()))) {
    if (files.size >= FOLDER_LIMITS.files) {
      throw new ZipError(`파일이 너무 많다 (${FOLDER_LIMITS.files}개까지)`);
    }
    bytes += entry.size;
    if (bytes > FOLDER_LIMITS.bytes) {
      throw new ZipError('풀면 너무 커진다');
    }
    const type = mimeOf(entry.name);
    if (entry.method === STORED) {
      files.set(entry.name, new Blob([entry.data as BlobPart], { type }));
      continue;
    }
    if (entry.method !== DEFLATE) {
      throw new ZipError(`처음 보는 압축 방식이다 (${entry.method}): ${entry.name}`);
    }
    const blob = await inflate(entry.data);
    files.set(entry.name, new Blob([blob], { type }));
  }

  return files;
}
