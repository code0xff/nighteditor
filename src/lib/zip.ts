/**
 * zip extraction. The browser already owns the decompression algorithm
 * (`DecompressionStream`).
 *
 * No library is added — the compressed data inside a zip is headerless deflate,
 * so it can be piped straight into a `deflate-raw` stream. Nothing leaves this machine.
 */
import { crc32, readZip, ZipError } from '@/core/zip';
import { mimeOf } from './assets';
import { FOLDER_LIMITS } from './fs';

/** Only stored (0) and deflate (8) are used. Anything else is nearly unheard of in practice */
const STORED = 0;
const DEFLATE = 8;

/**
 * Inflates under a budget. Sizes in the index can be forged, so count the **bytes
 * actually produced** and cut off the moment they exceed the budget — measuring
 * after inflating everything freezes the tab in the meantime.
 */
async function inflate(data: Uint8Array, budget: number): Promise<{ blob: Blob; crc: number }> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: BlobPart[] = [];
  let bytes = 0;
  // The CRC is accumulated where each chunk arrives — measuring after collecting
  // everything means recopying into one buffer, and that copy costs a full budget
  // worth of memory.
  let crc = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > budget) {
      await reader.cancel();
      throw new ZipError('tooBig', {}, 'inflates past the budget');
    }
    crc = crc32(value, crc);
    chunks.push(value as BlobPart);
  }
  return { blob: new Blob(chunks), crc };
}

/**
 * Unpacks a zip into a path → file map.
 *
 * Extraction runs under the same limits as folders. Compressed data can inflate to
 * any size, so without a limit a zip of just a few files can freeze the tab.
 *
 * Sizes in the index (central directory) are used **only for early rejection**.
 * Trusting the index alone lets a forged zip that claims to be small but inflates
 * large slip through, so the limit is re-measured against the bytes actually
 * produced, and a mismatch with the index is treated as forgery and stops the
 * extraction (Principle 3).
 */
/**
 * The size allowed for the archive itself. It is the content limit plus a little
 * headroom for headers (a local + central header per entry, up to a 64KB comment
 * at the end) — deflate never grows meaningfully past the original, so a larger
 * zip would exceed the content limit anyway once inflated.
 */
const ARCHIVE_LIMIT = FOLDER_LIMITS.bytes + 1024 * 1024;

export async function unzip(zip: Blob): Promise<Map<string, Blob>> {
  // Check the size **before** loading the whole thing into memory. arrayBuffer()
  // is a full copy, so a zip far past the limit would freeze the tab on the copy
  // alone, before the index is even read (spec §5.1).
  if (zip.size > ARCHIVE_LIMIT) {
    throw new ZipError('tooBig', {}, `archive is ${zip.size} bytes (limit ${ARCHIVE_LIMIT})`);
  }

  const files = new Map<string, Blob>();
  let bytes = 0;

  // The file-count limit is enforced while readZip walks the index. Counting the
  // results here instead would mean building every entry of a zip we are about to
  // reject, and duplicate names would collapse into files.size and dodge the
  // limit (spec §5.1).
  for (const entry of readZip(new Uint8Array(await zip.arrayBuffer()), FOLDER_LIMITS.files)) {
    if (bytes + entry.size > FOLDER_LIMITS.bytes) {
      throw new ZipError('tooBig', {}, 'inflates past the budget');
    }
    const type = mimeOf(entry.name);
    let blob: Blob;
    let crc: number;
    if (entry.method === STORED) {
      blob = new Blob([entry.data as BlobPart], { type });
      crc = crc32(entry.data);
    } else if (entry.method === DEFLATE) {
      const out = await inflate(entry.data, FOLDER_LIMITS.bytes - bytes);
      blob = new Blob([out.blob], { type });
      crc = out.crc;
    } else {
      throw new ZipError(
        'unknownMethod',
        { method: entry.method, name: entry.name },
        `unknown compression method (${entry.method}): ${entry.name}`
      );
    }
    // Better to stop here than to silently attach a half-right file.
    if (blob.size !== entry.size) {
      throw new ZipError('sizeMismatch', { name: entry.name }, `size mismatch: ${entry.name}`);
    }
    // Size alone is not enough — a stored entry keeps its size even with a flipped
    // byte, and a corrupted deflate stream can still inflate to the expected size.
    // Check the actual bytes against the index CRC so a broken file is never
    // opened silently (Principle 3).
    if (crc !== entry.crc) {
      throw new ZipError('crcMismatch', { name: entry.name }, `crc mismatch: ${entry.name}`);
    }
    bytes += blob.size;
    files.set(entry.name, blob);
  }

  return files;
}
