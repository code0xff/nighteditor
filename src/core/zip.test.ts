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
 * Tested against **real zips**, not hand-assembled bytes.
 * Headers we build ourselves copy in our own misunderstandings, so they cannot
 * tell whether the parser is right or wrong.
 *
 * The committed fixture is the baseline. Where the `zip` command exists, zips made
 * on the spot are checked as well.
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

describe('readZip · fixture regression', () => {
  const entries = readZip(fixtureBundle());
  const find = (name: string) => entries.find((e) => e.name === name);

  it('keeps subfolder paths intact', () => {
    // The document sits in deck/, so assets must be found relative to that spot.
    expect(entries.map((e) => e.name).sort()).toEqual([
      'deck/css/deck.css',
      'deck/fonts/mono.woff2',
      'deck/img/logo.svg',
      'deck/index.html',
      'deck/js/deck.js',
    ]);
  });

  it('directory entries and __MACOSX are not files', () => {
    expect(entries.some((e) => e.name.endsWith('/'))).toBe(false);
    expect(entries.some((e) => e.name.startsWith('__MACOSX/'))).toBe(false);
  });

  it('reads the decompressed size from the central directory', () => {
    // The local header's size fields can be empty. The central directory is always filled in.
    expect(find('deck/index.html')?.size).toBeGreaterThan(300);
    expect(find('deck/img/logo.svg')?.size).toBe(107);
  });

  it('compressed entries are marked deflate', () => {
    expect(find('deck/index.html')?.method).toBe(8);
  });

  it('reads the decompressed CRC from the central directory', () => {
    // Size alone cannot catch bytes corrupted at the same size — content checks use this value.
    const stored = find('deck/js/deck.js');
    expect(stored?.method).toBe(0);
    // For stored entries, data is already the decompressed bytes. node's crc32 is the baseline.
    expect(stored?.crc).toBe(crc32(stored?.data ?? new Uint8Array()));
  });

  it('throws with a reason when the end is cut off', () => {
    const zip = fixtureBundle();

    expect(() => readZip(zip.subarray(0, zip.length - 8))).toThrow(ZipError);
  });

  it('does not silently return an empty list for a non-zip', () => {
    // Passing silently looks like "opened it, but there is nothing inside" (Principle 3).
    expect(() => readZip(new TextEncoder().encode('이건 zip 이 아니다'))).toThrow(ZipError);
  });

  it('finds the real EOCD even when the comment contains EOCD signature bytes', () => {
    // Scanning from the back, meeting the bytes inside the comment first turns the
    // comment into a directory position and count, and a healthy zip is rejected as
    // broken. The real EOCD's comment reaches to the end of the buffer.
    const zip = fixtureBundle();
    // A long run of 'x' after the four signature bytes — read as an EOCD, none of its fields line up.
    const comment = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...Array(30).fill(0x78)]);
    const withComment = new Uint8Array(zip.length + comment.length);
    withComment.set(zip);
    withComment.set(comment, zip.length);
    // The fixture has no comment — the EOCD is the last 22 bytes, so the comment
    // length field is the last two bytes.
    new DataView(withComment.buffer).setUint16(zip.length - 2, comment.length, true);

    const names = readZip(withComment).map((e) => e.name);

    expect(names).toContain('deck/index.html');
  });

  it('does not take a fake EOCD record at the end of the comment for the real one', () => {
    // A comment ending in a 22-byte EOCD shape (own comment length 0, so it touches
    // the end) is not filtered by the end-alignment check alone. Trusting a fake with
    // count and directory position 0 opens a healthy zip as an empty bundle — the
    // directory field must be checked to point at an actual directory.
    const zip = fixtureBundle();
    const fake = new Uint8Array(22);
    new DataView(fake.buffer).setUint32(0, 0x06054b50, true); // every other field stays 0
    const withComment = new Uint8Array(zip.length + fake.length);
    withComment.set(zip);
    withComment.set(fake, zip.length);
    // Make the real EOCD's comment length field cover the appended fake.
    new DataView(withComment.buffer).setUint16(zip.length - 2, fake.length, true);

    const names = readZip(withComment).map((e) => e.name);

    expect(names).toContain('deck/index.html');
  });

  it('is not fooled by a fake "empty zip" EOCD writing its own position into the directory field', () => {
    // An empty zip's directory has size 0 and starts at the EOCD position. A fake
    // writing its own position into the directory field has the same shape — trusting
    // it on sight opens a healthy zip as an empty bundle. The earlier EOCD with an
    // actual directory must win.
    const zip = fixtureBundle();
    const fake = new Uint8Array(22);
    const fakeView = new DataView(fake.buffer);
    fakeView.setUint32(0, 0x06054b50, true);
    fakeView.setUint32(16, zip.length, true); // directory position = the fake record's own position
    const withComment = new Uint8Array(zip.length + fake.length);
    withComment.set(zip);
    withComment.set(fake, zip.length);
    new DataView(withComment.buffer).setUint16(zip.length - 2, fake.length, true);

    const names = readZip(withComment).map((e) => e.name);

    expect(names).toContain('deck/index.html');
  });

  it('a genuinely empty zip opens as an empty list — the caller states that there is no document', () => {
    // An empty zip is one EOCD and nothing else. Rejecting it too would make
    // "not a zip" a lie.
    const empty = new Uint8Array(22);
    new DataView(empty.buffer).setUint32(0, 0x06054b50, true);

    expect(readZip(empty)).toEqual([]);
  });

  it('is not fooled by a zip64-imitating record at the end of the comment — opens via the real directory', () => {
    // A fake carrying zip64 fields (0xFF..) passes the end-alignment check, and
    // trusting it on sight rejects a healthy zip as "zip64 unsupported". It must be
    // held while the real EOCD further forward is found.
    const zip = fixtureBundle();
    const fake = new Uint8Array(22);
    const fakeView = new DataView(fake.buffer);
    fakeView.setUint32(0, 0x06054b50, true);
    fakeView.setUint16(10, 0xffff, true); // entry count as the zip64 marker
    const withComment = new Uint8Array(zip.length + fake.length);
    withComment.set(zip);
    withComment.set(fake, zip.length);
    new DataView(withComment.buffer).setUint16(zip.length - 2, fake.length, true);

    const names = readZip(withComment).map((e) => e.name);

    expect(names).toContain('deck/index.html');
  });

  it('a zip64 shape with no real directory stops with the unsupported reason — not "not a zip"', () => {
    // zip64 fills these fields with 0xFF.. and keeps the real values elsewhere.
    // Even what we cannot read deserves an accurate reason (Principle 3).
    const eocd = new Uint8Array(22);
    const dv = new DataView(eocd.buffer);
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(10, 0xffff, true);

    expect(() => readZip(eocd)).toThrow(expect.objectContaining({ code: 'zip64' }));
  });

  it('input shorter than an EOCD stops with the not-a-zip reason', () => {
    // The scan start is negative, so the loop never runs and it must fall through to
    // our diagnostic — a leaked DataView RangeError shows the browser's sentence
    // instead of the language pack's.
    for (const len of [0, 1, 10, 21]) {
      expect(() => readZip(new Uint8Array(len).fill(0x50))).toThrow(
        expect.objectContaining({ code: 'notZip' })
      );
    }
  });

  it('stops with our diagnostic when the directory points at a local header outside the buffer', () => {
    // If the DataView's RangeError fires first, the browser's raw sentence goes out
    // instead of the language pack diagnostic.
    const zip = new Uint8Array(fixtureBundle());
    const dv = new DataView(zip.buffer);
    // The fixture has no comment, so the EOCD is the last 22 bytes. Directory entries
    // are filtered before the local header is read, so walk the directory and tamper
    // with the **first file entry's** local position.
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

  it('stops without invented entries when a directory record overruns the EOCD', () => {
    // A directory with an inflated name length builds a fake name from the bytes
    // subarray silently truncates, and the cursor walks out of the buffer. In a
    // one-entry directory that fake becomes the only "file", and a broken zip poses
    // as a bundle without a document (spec §6).
    const zip = new Uint8Array(fixtureBundle());
    const dv = new DataView(zip.buffer);
    dv.setUint16(zip.length - 22 + 10, 1, true); // entry count 1 — the overrunning entry becomes the last
    const centralAt = dv.getUint32(zip.length - 22 + 16, true);
    dv.setUint16(centralAt + 28, 0xffff, true); // inflate the name length

    expect(() => readZip(zip)).toThrow(expect.objectContaining({ code: 'badCentral' }));
  });

  /** Position of the central record named `want`. The fixture has no extra fields, so names are plain ASCII */
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

  it('reads names without the UTF-8 flag as CP437', () => {
    // The fixture names are all written with flag 0 (no UTF-8 flag). Planting 0x82 in
    // a name gives é in CP437 but U+FFFD when decoded unconditionally as UTF-8 — with
    // the key broken, neither document candidates nor relative assets are found under
    // that name.
    const zip = new Uint8Array(fixtureBundle());
    const at = centralRecordOf(zip, 'deck/index.html');
    zip[at + 46 + 'deck/'.length] = 0x82; // the 'i' of 'index'

    const names = readZip(zip).map((e) => e.name);

    expect(names).toContain('deck/éndex.html');
  });

  /** A fixture variant with a Unicode Path extra field (0x7075) inserted into one entry */
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
    field[4] = 1; // field version
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

  it('uses the Unicode Path extra field name when its CRC matches the standard name', () => {
    const names = readZip(withUnicodePath('deck/실제이름.html', true)).map((e) => e.name);

    expect(names).toContain('deck/실제이름.html');
    expect(names).not.toContain('deck/index.html');
  });

  it('a Unicode Path field with a mismatched CRC is stale — the standard name is used', () => {
    // There are zips whose name changed while the field stayed stale. Trusting it
    // unconditionally makes the old name the key.
    const names = readZip(withUnicodePath('deck/옛이름.html', false)).map((e) => e.name);

    expect(names).toContain('deck/index.html');
    expect(names).not.toContain('deck/옛이름.html');
  });

  it('decodes broken bytes in a name with the UTF-8 flag (bit 11) as U+FFFD', () => {
    // The path decoded by hand without TextDecoder (INV-6) — on a broken byte it
    // neither dies nor silently skips; like the standard decoder, only that spot
    // becomes the replacement character.
    const zip = new Uint8Array(fixtureBundle());
    const dv = new DataView(zip.buffer);
    const at = centralRecordOf(zip, 'deck/index.html');
    dv.setUint16(at + 8, 0x0800, true); // the UTF-8 name flag
    zip[at + 46 + 'deck/'.length] = 0x82; // a lone continuation byte — not UTF-8

    const names = readZip(zip).map((e) => e.name);

    expect(names).toContain('deck/�ndex.html');
  });

  it('overlong forms are not valid UTF-8 — falls through to CP437', () => {
    // 0xC0 0xAF is the overlong form of '/'. If the strict judgment accepted it, a
    // path separator would sneak inside a name — it must be rejected like the
    // standard decoder does.
    const zip = new Uint8Array(fixtureBundle());
    const at = centralRecordOf(zip, 'deck/index.html');
    zip[at + 46 + 'deck/'.length] = 0xc0;
    zip[at + 46 + 'deck/i'.length] = 0xaf;

    const names = readZip(zip).map((e) => e.name);

    expect(names).toContain('deck/└»dex.html');
  });

  it('reads unflagged 4-byte UTF-8 names as-is too', () => {
    // Beyond the BMP (emoji) — does the hand-rolled decoder build surrogate pairs correctly.
    const zip = new Uint8Array(fixtureBundle());
    const at = centralRecordOf(zip, 'deck/index.html');
    zip.set([0xf0, 0x9f, 0x93, 0x84], at + 46 + 'deck/'.length); // 📄 in place of 'inde'

    const names = readZip(zip).map((e) => e.name);

    expect(names).toContain('deck/📄x.html');
  });

  it('counts the file cap while reading the directory', () => {
    // Counting after building would build every entry of a zip due for rejection
    // (up to 65,534) before rejecting — the cap bounds the reading itself, not the
    // stored count (spec §5.1).
    expect(() => readZip(fixtureBundle(), 2)).toThrow(
      expect.objectContaining({ code: 'tooManyFiles', params: { limit: 2 } })
    );
    // Within the cap, everything reads as before.
    expect(readZip(fixtureBundle(), 5)).toHaveLength(5);
  });
});

describe.skipIf(!hasZipCommand())('readZip · zips made on the spot', () => {
  it('reads the name, size, and method of a compressed entry', () => {
    // Long so it compresses well — zip just stores short files.
    const body = '한 줄이 반복된다\n'.repeat(200);
    const entries = readZip(realZip({ 'deck.html': body }));
    const deck = entries.find((e) => e.name === 'deck.html');

    expect(deck?.method).toBe(8);
    expect(deck?.size).toBe(new TextEncoder().encode(body).length);
    expect(deck?.data.length).toBeLessThan(deck?.size ?? 0);
  });

  it('entries stored without compression are the bytes as-is', () => {
    // -0 stores everything as-is. Then they must be usable directly, no decompression.
    const entries = readZip(realZip({ 'a.txt': '있는 그대로' }, ['-0']));

    expect(entries[0]?.method).toBe(0);
    expect(decode(entries[0]?.data ?? new Uint8Array())).toBe('있는 그대로');
  });

  it('reads Korean file names', () => {
    const entries = readZip(realZip({ '발표 자료.html': 'x' }));

    expect(entries[0]?.name).toBe('발표 자료.html');
  });

  it('stops at an encrypted entry instead of half-reading it', () => {
    const zip = realZip({ 'deck.html': '비밀' }, ['-P', 'pw']);

    // Which entry it was travels as a parameter — the language pack makes the sentence (spec §1).
    expect(() => readZip(zip)).toThrow(
      expect.objectContaining({ code: 'encrypted', params: { name: 'deck.html' } })
    );
  });
});

describe('crc32 · against the reference implementation', () => {
  it('matches IEEE CRC-32, and chunked continuation matches too', () => {
    // Decompression yields stream chunks — a wrong continuation seed rejects every
    // healthy zip as corrupted. node's crc32 is the baseline.
    const bytes = fixtureBundle();
    expect(ourCrc32(bytes)).toBe(crc32(bytes));
    const mid = Math.floor(bytes.length / 3);
    expect(ourCrc32(bytes.subarray(mid), ourCrc32(bytes.subarray(0, mid)))).toBe(crc32(bytes));
  });
});
