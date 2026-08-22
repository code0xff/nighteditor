// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { FOLDER_LIMITS, NotUtf8Error, pickFolder, readDroppedFolder, readText } from './fs.js';

/** Only sizes are counted, never contents — no actual 64MB is allocated */
function fakeFile(name: string, size: number): File {
  return { name, size } as File;
}

function fileEntry(name: string, size: number): FileSystemEntry {
  return {
    name,
    isFile: true,
    isDirectory: false,
    file: (cb: (f: File) => void) => cb(fakeFile(name, size)),
  } as unknown as FileSystemEntry;
}

function dirEntry(name: string, children: FileSystemEntry[]): FileSystemEntry {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let done = false;
      return {
        readEntries: (cb: (e: FileSystemEntry[]) => void) => {
          cb(done ? [] : children);
          done = true;
        },
      };
    },
  } as unknown as FileSystemEntry;
}

function drop(root: FileSystemEntry): DataTransferItemList {
  const item = { kind: 'file', webkitGetAsEntry: () => root };
  return {
    length: 1,
    0: item,
    [Symbol.iterator]: function* () {
      yield item;
    },
  } as unknown as DataTransferItemList;
}

const MB = 1024 * 1024;

describe('readDroppedFolder · limits', () => {
  it('reads the files in a folder, paths included', async () => {
    const read = await readDroppedFolder(
      drop(
        dirEntry('deck', [fileEntry('index.html', 10), dirEntry('css', [fileEntry('a.css', 5)])])
      )
    );

    expect([...(read?.files.keys() ?? [])]).toEqual(['deck/index.html', 'deck/css/a.css']);
    expect(read?.truncated).toBe(false);
  });

  it('does not keep a single file larger than the limit', async () => {
    // Adding to the total after keeping would let a file larger than the limit straight in.
    const huge = FOLDER_LIMITS.bytes + MB;
    const read = await readDroppedFolder(drop(dirEntry('deck', [fileEntry('big.mp4', huge)])));

    expect(read?.files.size).toBe(0);
    expect(read?.truncated).toBe(true);
  });

  it('keeps everything except the file that crosses the line', async () => {
    const read = await readDroppedFolder(
      drop(
        dirEntry('deck', [
          fileEntry('index.html', MB),
          fileEntry('big.mp4', FOLDER_LIMITS.bytes),
          fileEntry('logo.svg', MB),
        ])
      )
    );

    expect([...(read?.files.keys() ?? [])]).toEqual(['deck/index.html', 'deck/logo.svg']);
    expect(read?.truncated).toBe(true);
  });

  it('does not walk to the end even when the folder is full of over-limit files', async () => {
    // Watching only the kept count (files.size), the whole folder kept being read
    // with nothing kept — in a folder of ten thousand large files the limit never
    // bounded the traversal at all (spec §5.1).
    let touched = 0;
    const huge = FOLDER_LIMITS.bytes + MB;
    const children = Array.from(
      { length: FOLDER_LIMITS.visits + 500 },
      (_, i) =>
        ({
          name: `big${i}.mp4`,
          isFile: true,
          isDirectory: false,
          file: (cb: (f: File) => void) => {
            touched++;
            cb(fakeFile(`big${i}.mp4`, huge));
          },
        }) as unknown as FileSystemEntry
    );

    const read = await readDroppedFolder(drop(dirEntry('deck', children)));

    expect(read?.truncated).toBe(true);
    expect(read?.files.size).toBe(0);
    expect(touched).toBeLessThanOrEqual(FOLDER_LIMITS.visits);
  });

  it('does not walk to the end even when the folder is full of hidden entries', async () => {
    // With filtering (continue) before the budget (walkOn), visits never grew, so
    // a folder of thousands of hidden entries dodged the limit and the traversal
    // never ended (spec §5.1).
    const children = Array.from({ length: FOLDER_LIMITS.visits + 500 }, (_, i) =>
      fileEntry(`.hidden${i}`, 1)
    );
    // The budget is spent entirely on hidden entries, so the real document behind
    // them is never reached — but the truncation is recorded, so the user can be
    // told what happened.
    children.push(fileEntry('index.html', 1));

    const read = await readDroppedFolder(drop(dirEntry('deck', children)));

    expect(read?.truncated).toBe(true);
    expect(read?.files.size).toBe(0);
  });

  it('skips hidden files and node_modules', async () => {
    const read = await readDroppedFolder(
      drop(
        dirEntry('deck', [
          fileEntry('.DS_Store', 1),
          dirEntry('node_modules', [fileEntry('x.js', 1)]),
          fileEntry('index.html', 1),
        ])
      )
    );

    expect([...(read?.files.keys() ?? [])]).toEqual(['deck/index.html']);
  });

  it('a folder chosen through the open dialog also spends budget on hidden entries', async () => {
    // The dialog-side traversal (walk) is a separate loop from the drop side
    // (walkEntry) — the same flaw lived in both, so both are pinned down (spec §5.1).
    const names = Array.from({ length: FOLDER_LIMITS.visits + 500 }, (_, i) => `.hidden${i}`);
    names.push('index.html');
    const dir = {
      name: 'deck',
      entries: () => ({
        [Symbol.asyncIterator]: () => {
          let at = 0;
          return {
            next: () =>
              Promise.resolve(
                at < names.length
                  ? {
                      value: [
                        names[at],
                        {
                          name: names[at++],
                          getFile: () => Promise.resolve(fakeFile('x', 1)),
                        },
                      ],
                      done: false,
                    }
                  : { value: undefined, done: true }
              ),
          };
        },
      }),
    };
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = () =>
      Promise.resolve(dir);

    const read = await pickFolder();

    expect(read?.truncated).toBe(true);
    expect(read?.files.size).toBe(0);
  });

  it('null when nothing is a folder — then it opens as a file', async () => {
    expect(await readDroppedFolder(drop(fileEntry('deck.html', 1)))).toBeNull();
  });

  it('a dropped folder has no writable handles — saving goes to a copy', async () => {
    const read = await readDroppedFolder(drop(dirEntry('deck', [fileEntry('index.html', 1)])));

    expect(read?.handles.size).toBe(0);
  });
});

describe('folder depth limit (spec §5.1)', () => {
  /** Nests levels folders under the root, with one file at the innermost */
  function nestedDrop(levels: number): FileSystemEntry {
    let entry: FileSystemEntry = fileEntry('deep.css', 1);
    for (let i = levels; i >= 1; i--) entry = dirEntry(`d${i}`, [entry]);
    return dirEntry('deck', [entry]);
  }

  function pickerFile(name: string): unknown {
    return { name, getFile: () => Promise.resolve(fakeFile(name, 1)) };
  }

  function pickerDir(name: string, children: [string, unknown][]): unknown {
    return {
      name,
      entries: () => ({
        [Symbol.asyncIterator]: () => {
          let at = 0;
          return {
            next: () =>
              Promise.resolve(
                at < children.length
                  ? { value: children[at++], done: false }
                  : { value: undefined, done: true }
              ),
          };
        },
      }),
    };
  }

  function nestedPick(levels: number): unknown {
    let entry: [string, unknown] = ['deep.css', pickerFile('deep.css')];
    for (let i = levels; i >= 1; i--) entry = [`d${i}`, pickerDir(`d${i}`, [entry])];
    return pickerDir('deck', [entry]);
  }

  const deepPath = (prefix: string): string =>
    [
      ...(prefix ? [prefix] : []),
      ...Array.from({ length: FOLDER_LIMITS.depth }, (_, i) => `d${i + 1}`),
      'deep.css',
    ].join('/');

  it('keeps files down to the eighth level (depth) — drop', async () => {
    // Measured with `>=`, the limit level was cut off wholesale, so depth: 8 was effectively 7.
    const read = await readDroppedFolder(drop(nestedDrop(FOLDER_LIMITS.depth)));

    expect([...(read?.files.keys() ?? [])]).toEqual([deepPath('deck')]);
    expect(read?.truncated).toBe(false);
  });

  it('does not keep the ninth level and records the truncation — drop', async () => {
    const read = await readDroppedFolder(drop(nestedDrop(FOLDER_LIMITS.depth + 1)));

    expect(read?.files.size).toBe(0);
    expect(read?.truncated).toBe(true);
  });

  it('a picked folder is cut at the same level — the root name in a drop path is not depth', async () => {
    // The drop side's prefix starts with the root name, the dialog side's with an
    // empty prefix. Re-deriving depth from the prefix meant the same folder fit
    // when picked but was cut when dropped (spec §5.1).
    const w = window as unknown as { showDirectoryPicker: unknown };

    w.showDirectoryPicker = () => Promise.resolve(nestedPick(FOLDER_LIMITS.depth));
    const fits = await pickFolder();
    expect([...(fits?.files.keys() ?? [])]).toEqual([deepPath('')]);
    expect(fits?.truncated).toBe(false);

    w.showDirectoryPicker = () => Promise.resolve(nestedPick(FOLDER_LIMITS.depth + 1));
    const over = await pickFolder();
    expect(over?.files.size).toBe(0);
    expect(over?.truncated).toBe(true);
  });
});

describe('readText · reads the bytes as they are (spec §1 · document encoding)', () => {
  it('never opens with the leading BOM stripped (Principle 1)', async () => {
    // Blob.text() strips the BOM — the first byte of a document the user never
    // touched would vanish from the saved file. U+FEFF must stay at the front of
    // the string.
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const text = await readText(new Blob([bom, '<html><body>본문</body></html>']));

    expect(text.startsWith('\ufeff')).toBe(true);
    expect(text).toContain('<html>');
  });

  it('does not tidy CRLF line endings (Principle 1)', async () => {
    const text = await readText(new Blob(['<p>줄1</p>\r\n<p>줄2</p>\r\n']));
    expect(text).toBe('<p>줄1</p>\r\n<p>줄2</p>\r\n');
  });

  it('rejects non-UTF-8 — opened broken, saving would ruin the original (Principle 3)', async () => {
    // "한글" written in EUC-KR — stray continuation bytes make it invalid UTF-8.
    const eucKr = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]);
    await expect(readText(new Blob([eucKr]))).rejects.toBeInstanceOf(NotUtf8Error);
  });

  it('also rejects a document starting with a UTF-16 BOM', async () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]);
    await expect(readText(new Blob([utf16]))).rejects.toBeInstanceOf(NotUtf8Error);
  });
});
