/**
 * zip 해제. 압축 알고리즘은 브라우저가 가지고 있다 (`DecompressionStream`).
 *
 * 라이브러리를 더하지 않는다 — zip 안의 압축은 헤더 없는 deflate 그대로라
 * `deflate-raw` 스트림에 그대로 흘려보내면 된다. 이 기기 밖으로는 아무것도 나가지 않는다.
 */
import { readZip, ZipError } from '@/core/zip';
import { mimeOf } from './assets';

/** 그대로 담김(0) 과 deflate(8) 만 쓰인다. 그 밖은 실무에서 거의 없다 */
const STORED = 0;
const DEFLATE = 8;

async function inflate(data: Uint8Array): Promise<Blob> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).blob();
}

/** zip 을 경로 → 파일 묶음으로 푼다 */
export async function unzip(zip: Blob): Promise<Map<string, Blob>> {
  const files = new Map<string, Blob>();

  for (const entry of readZip(new Uint8Array(await zip.arrayBuffer()))) {
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
