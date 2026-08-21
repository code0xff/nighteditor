// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { FOLDER_LIMITS, readDroppedFolder } from './fs.js';

/** 내용은 읽지 않고 크기만 세므로, 실제로 64MB 를 만들지 않는다 */
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

describe('readDroppedFolder · 한도', () => {
  it('폴더 안의 파일을 경로째 읽는다', async () => {
    const read = await readDroppedFolder(
      drop(
        dirEntry('deck', [fileEntry('index.html', 10), dirEntry('css', [fileEntry('a.css', 5)])])
      )
    );

    expect([...(read?.files.keys() ?? [])]).toEqual(['deck/index.html', 'deck/css/a.css']);
    expect(read?.truncated).toBe(false);
  });

  it('한도보다 큰 파일 하나는 담지 않는다', async () => {
    // 담고 나서 누계를 더하면 한 파일이 한도보다 커도 그대로 들어간다.
    const huge = FOLDER_LIMITS.bytes + MB;
    const read = await readDroppedFolder(drop(dirEntry('deck', [fileEntry('big.mp4', huge)])));

    expect(read?.files.size).toBe(0);
    expect(read?.truncated).toBe(true);
  });

  it('선을 넘는 파일만 빼고 나머지는 담는다', async () => {
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

  it('숨김 파일과 node_modules 는 지나친다', async () => {
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

  it('폴더가 아니면 null — 그때는 파일로 연다', async () => {
    expect(await readDroppedFolder(drop(fileEntry('deck.html', 1)))).toBeNull();
  });

  it('드롭한 폴더에는 되쓸 핸들이 없다 — 저장은 사본으로 간다', async () => {
    const read = await readDroppedFolder(drop(dirEntry('deck', [fileEntry('index.html', 1)])));

    expect(read?.handles.size).toBe(0);
  });
});
