// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { FOLDER_LIMITS, pickFolder, readDroppedFolder } from './fs.js';

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

  it('한도 넘는 파일만 가득해도 끝까지 걷지 않는다', async () => {
    // 담긴 수(files.size)만 보면 하나도 못 담은 채 폴더 전체를 계속 읽었다 —
    // 큰 파일 만 개짜리 폴더에서 한도가 순회를 전혀 묶지 못했다 (spec §5.1).
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

  it('숨김 항목만 가득해도 끝까지 걷지 않는다', async () => {
    // 거르기(continue)가 예산(walkOn)보다 먼저면 visits 가 늘지 않아, 숨김 항목
    // 수천 개짜리 폴더에서 순회가 한도를 비켜 가 끝나지 않았다 (spec §5.1).
    const children = Array.from({ length: FOLDER_LIMITS.visits + 500 }, (_, i) =>
      fileEntry(`.hidden${i}`, 1)
    );
    // 예산이 숨김 항목에 다 쓰이므로 그 뒤의 진짜 문서에는 닿지 못한다 — 대신
    // 잘렸다는 사실이 남아 사용자에게 그 사정을 말할 수 있다.
    children.push(fileEntry('index.html', 1));

    const read = await readDroppedFolder(drop(dirEntry('deck', children)));

    expect(read?.truncated).toBe(true);
    expect(read?.files.size).toBe(0);
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

  it('열기 대화상자로 고른 폴더도 숨김 항목에 예산을 쓴다', async () => {
    // 대화상자 쪽 순회(walk)는 드롭 쪽(walkEntry)과 별개 루프다 — 같은 결함이
    // 양쪽에 있었으므로 양쪽 다 잡는다 (spec §5.1).
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

  it('폴더가 아니면 null — 그때는 파일로 연다', async () => {
    expect(await readDroppedFolder(drop(fileEntry('deck.html', 1)))).toBeNull();
  });

  it('드롭한 폴더에는 되쓸 핸들이 없다 — 저장은 사본으로 간다', async () => {
    const read = await readDroppedFolder(drop(dirEntry('deck', [fileEntry('index.html', 1)])));

    expect(read?.handles.size).toBe(0);
  });
});
