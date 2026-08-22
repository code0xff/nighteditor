/**
 * zip reading — up to central directory parsing (spec §5.1).
 *
 * No decompression here. The browser does that with `DecompressionStream`, so it
 * belongs to `lib/zip.ts` (INV-6). Here we only read "which file sits where".
 *
 * Sizes and positions are read from the **central directory** only. In streamed
 * zips the local header's size fields are left at 0 and the real values follow
 * the data (data descriptor). The central directory is always filled in.
 */

/** Rejection reason. `core/` does not know the UI language, so it passes codes, not sentences (INV-6) */
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
  | 'sizeMismatch'
  | 'crcMismatch';

/**
 * zip rejection. `message` is a developer diagnostic; the sentence shown to the
 * user is `code` + `params` rendered by the language pack (`lib/messages.ts`) —
 * same as `PatchError`.
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
  /** 0 = stored as-is, 8 = deflate */
  method: number;
  /** the bytes exactly as compressed */
  data: Uint8Array;
  /** size when decompressed */
  size: number;
  /** CRC-32 of the decompressed data — size alone cannot catch bytes corrupted at the same size */
  crc: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** The EOCD sits at most 22 + 65535 bytes from the end (the comment length cap) */
const EOCD_MAX_BACK = 22 + 0xffff;

/** zip is little-endian */
function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The general-purpose flag saying the name is written in UTF-8 (bit 11) */
const UTF8_NAME_FLAG = 0x0800;
/** The Info-ZIP Unicode Path extra field */
const UNICODE_PATH_ID = 0x7075;

/**
 * The CP437 code page — the name encoding of zips without the UTF-8 flag. 0x20–0x7E
 * matches ASCII. Hand-made tables are easy to get wrong, but CP437 is a fixed table
 * with no extensions, so it lives here as a constant.
 */
const CP437 =
  '\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼' +
  ' !"#$%&\'()*+,-./0123456789:;<=>?' +
  '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_' +
  '`abcdefghijklmnopqrstuvwxyz{|}~⌂' +
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0';

/**
 * Decodes UTF-8 by hand. On an invalid sequence: null when fatal, otherwise only
 * that byte becomes U+FFFD and decoding continues.
 *
 * `TextDecoder` is not used — it is a Web Encoding global, which would tie `core/`
 * to the runtime environment (INV-6 · rules §4). zip names are short, and what is
 * needed here is the strict judgment "is this valid UTF-8", so decoding by hand is
 * cheap. Overlong forms, surrogates, and out-of-range code points are all invalid
 * sequences.
 */
function decodeUtf8(bytes: Uint8Array, fatal: boolean): string | null {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i] as number;
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i++;
      continue;
    }
    // The continuation length the lead byte promises, and the minimum code point
    // (for the overlong check).
    let rest: number;
    let min: number;
    let cp: number;
    if (b >= 0xc2 && b <= 0xdf) {
      rest = 1;
      min = 0x80;
      cp = b & 0x1f;
    } else if (b >= 0xe0 && b <= 0xef) {
      rest = 2;
      min = 0x800;
      cp = b & 0x0f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      rest = 3;
      min = 0x10000;
      cp = b & 0x07;
    } else {
      if (fatal) return null;
      out += '�';
      i++;
      continue;
    }
    let ok = true;
    for (let k = 1; k <= rest; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) {
        ok = false;
        break;
      }
      cp = (cp << 6) | (c & 0x3f);
    }
    if (!ok || cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      if (fatal) return null;
      out += '�';
      i++;
      continue;
    }
    out += String.fromCodePoint(cp);
    i += rest + 1;
  }
  return out;
}

/** Precomputed table instead of a bit loop per byte — entry contents (tens of MB) get checked too */
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  CRC_TABLE[n] = c >>> 0;
}

/**
 * IEEE CRC-32. Used to validate the Unicode Path field and to check entry contents.
 *
 * Passing a previous chunk's result as `seed` continues the computation —
 * decompression yields stream chunks, and without continuation the chunks would
 * have to be copied back into a single buffer.
 */
export function crc32(bytes: Uint8Array, seed = 0): number {
  let crc = ~seed;
  for (const byte of bytes) crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] as number);
  return ~crc >>> 0;
}

/**
 * The name from the Unicode Path extra field. null when absent or untrustworthy.
 *
 * Trusted only when its CRC matches the standard name — there are zips whose name
 * was changed while the field stayed stale, and trusting it unconditionally makes
 * the old name, not the current one, the bundle key.
 */
function unicodePathName(extra: Uint8Array, nameBytes: Uint8Array): string | null {
  const dv = view(extra);
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = dv.getUint16(at, true);
    const end = at + 4 + dv.getUint16(at + 2, true);
    // Stop reading a truncated extra field — do not invent bytes that are not there.
    if (end > extra.length) return null;
    if (id === UNICODE_PATH_ID) {
      const size = end - (at + 4);
      if (size >= 5 && extra[at + 4] === 1 && dv.getUint32(at + 5, true) === crc32(nameBytes)) {
        return decodeUtf8(extra.subarray(at + 9, end), false);
      }
      return null;
    }
    at = end;
  }
  return null;
}

/**
 * Reads an entry name according to its flags (spec §5.1).
 *
 * Decoding unconditionally as UTF-8 without the UTF-8 flag (bit 11) mangles old
 * zips' non-ASCII names into U+FFFD and breaks the bundle keys — document
 * candidates and relative assets are both looked up by that key, so a healthy zip
 * would show no document or count its assets as missing.
 */
function decodeName(nameBytes: Uint8Array, flags: number, extra: Uint8Array): string {
  if (flags & UTF8_NAME_FLAG) return decodeUtf8(nameBytes, false) ?? '';
  const unicode = unicodePathName(extra, nameBytes);
  if (unicode !== null) return unicode;
  // Even without the flag, modern zips store UTF-8 names as-is — macOS zip does
  // not set bit 11 even for Korean names. If the name decodes as strict UTF-8,
  // that is the name: ASCII reads the same under both interpretations, and a
  // CP437-written non-ASCII name that happens to be a valid UTF-8 sequence is
  // practically nonexistent (a lone 0x80–0xBF byte is not UTF-8).
  const strict = decodeUtf8(nameBytes, true);
  if (strict !== null) return strict;
  // Not valid UTF-8 — a CP437 name from an old zip.
  let out = '';
  for (const byte of nameBytes) out += CP437[byte] as string;
  return out;
}

function findEocd(bytes: Uint8Array): number {
  const dv = view(bytes);
  const from = Math.max(0, bytes.length - EOCD_MAX_BACK);
  // The first zip64-shaped candidate met from the back. Discarded when the real
  // directory is found; otherwise it reports zip64 as unsupported — because
  // "not a zip" would be a lie.
  let zip64At = -1;
  // The first "empty zip"-shaped candidate met from the back. Discarded when the
  // real directory is found — see below.
  let emptyAt = -1;
  for (let at = bytes.length - 22; at >= from; at--) {
    if (dv.getUint32(at, true) !== EOCD_SIGNATURE) continue;
    // The signature alone is not enough — the same four bytes can sit inside the
    // zip comment by accident (or on purpose), and reading them as the EOCD turns
    // comment bytes into a directory position and count, rejecting a healthy zip
    // or reading it as an empty bundle. The real EOCD's own comment reaches
    // exactly to the end of the buffer — skip candidates that do not, and keep
    // searching further forward.
    if (at + 22 + dv.getUint16(at + 20, true) !== bytes.length) continue;
    const count = dv.getUint16(at + 10, true);
    const centralAt = dv.getUint32(at + 16, true);
    // zip64 fills these fields with 0xFF.. — but a fake EOCD at the end of the
    // comment can carry the same values. Returning right here would reject a
    // healthy zip as zip64-unsupported. Hold onto it and keep looking for the
    // real EOCD further forward (spec §6 · zip64-imitating records).
    if (count === 0xffff || centralAt === 0xffffffff) {
      if (zip64At < 0) zip64At = at;
      continue;
    }
    // A 22-byte fake EOCD at the tail of the comment passes the check above too —
    // writing its own comment length as 0 makes it touch the end. An empty zip's
    // directory has size 0 and starts at the EOCD position, and a fake that writes
    // its own position into the directory field looks exactly the same — at that
    // spot the real one cannot be told from the fake. So do not trust it yet; hold
    // onto it and keep searching forward: if an EOCD with an actual directory sits
    // earlier, that one is real (trusting the fake would open a healthy zip as an
    // empty bundle); if none exists, this candidate is itself the empty zip.
    if (count === 0) {
      if (centralAt === at && emptyAt < 0) emptyAt = at;
      continue;
    }
    // Verify the directory field points at an actual directory, so comment bytes
    // are never read as the directory.
    if (centralAt + 46 <= at && dv.getUint32(centralAt, true) === CENTRAL_SIGNATURE) return at;
  }
  // There was no EOCD with an actual directory. If there was an empty-zip
  // candidate, it is the real one.
  if (emptyAt >= 0) return emptyAt;
  // If there was a zip64-shaped candidate, report its situation (unsupported) —
  // and throw right here, so this function's return always remains "a validated
  // EOCD". Returning the candidate's offset would leave us trusting the caller
  // to recheck the marker fields.
  if (zip64At >= 0) throw new ZipError('zip64', {}, 'zip64 is not supported');
  throw new ZipError('notZip', {}, 'not a zip, or the end is cut off');
}

/**
 * Reads the file list. Directory entries and macOS's inserted `__MACOSX` are
 * filtered out.
 *
 * An unreadable zip does not silently yield an empty list; it throws with a
 * reason (Principle 3).
 *
 * @param maxFiles Cap on the number of files. Counted **while** the directory is
 *   read, so a zip over the cap is rejected without building all its entries —
 *   counting after building would make the cap pointless (spec §5.1). Duplicate
 *   names still count per entry.
 */
export function readZip(bytes: Uint8Array, maxFiles = Number.POSITIVE_INFINITY): ZipEntry[] {
  const dv = view(bytes);
  const eocd = findEocd(bytes);

  // The EOCD findEocd returned is fully validated — candidates carrying zip64
  // markers (0xFF..) already threw with the zip64 reason over there, so these
  // values are trusted as-is.
  const count = dv.getUint16(eocd + 10, true);
  const centralAt = dv.getUint32(eocd + 16, true);

  const entries: ZipEntry[] = [];
  let at = centralAt;
  for (let i = 0; i < count; i++) {
    // The directory must end before the EOCD — measuring against the buffer
    // length alone reads the EOCD itself as a directory record.
    if (at + 46 > eocd || dv.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError('badCentral', {}, 'broken central directory');
    }
    const flags = dv.getUint16(at + 8, true);
    const method = dv.getUint16(at + 10, true);
    const crc = dv.getUint32(at + 16, true);
    const compressed = dv.getUint32(at + 20, true);
    const size = dv.getUint32(at + 24, true);
    const nameLength = dv.getUint16(at + 28, true);
    const extraLength = dv.getUint16(at + 30, true);
    const commentLength = dv.getUint16(at + 32, true);
    const localAt = dv.getUint32(at + 42, true);
    // The end of name + extra + comment must not cross the EOCD either —
    // subarray truncates silently, so without stopping here an entry invented
    // from a truncated name poses as a real file and the cursor walks out of
    // the buffer (Principle 3 · spec §6).
    const recordEnd = at + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > eocd) {
      throw new ZipError('badCentral', {}, 'central record overruns the EOCD');
    }
    const nameStart = at + 46;
    const name = decodeName(
      bytes.subarray(nameStart, nameStart + nameLength),
      flags,
      bytes.subarray(nameStart + nameLength, nameStart + nameLength + extraLength)
    );
    at = recordEnd;

    // Encrypted entries cannot be decompressed. Better to say so and stop than
    // to attach a half-read, broken file.
    if (flags & 0x1) throw new ZipError('encrypted', { name }, `encrypted entry: ${name}`);
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;

    if (entries.length >= maxFiles) {
      throw new ZipError('tooManyFiles', { limit: maxFiles }, `too many files (limit ${maxFiles})`);
    }

    // A crafted directory can put localAt outside the buffer. Without checking
    // the bounds first, the DataView's raw RangeError escapes as-is and the
    // browser's sentence shows instead of the language pack's zip diagnostic —
    // errors always speak through our code (Principle 3).
    if (localAt + 30 > bytes.length || dv.getUint32(localAt, true) !== LOCAL_SIGNATURE) {
      throw new ZipError('badLocal', { name }, `local header not found: ${name}`);
    }
    // The local header's name and extra field lengths can differ from the central
    // directory's. Use the values here.
    const dataAt =
      localAt + 30 + dv.getUint16(localAt + 26, true) + dv.getUint16(localAt + 28, true);
    if (dataAt + compressed > bytes.length) {
      throw new ZipError('dataTruncated', { name }, `data is cut off: ${name}`);
    }

    entries.push({ name, method, size, crc, data: bytes.subarray(dataAt, dataAt + compressed) });
  }
  return entries;
}
