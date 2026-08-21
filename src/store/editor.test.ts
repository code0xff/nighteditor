// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureSource } from '../__fixtures__/load.js';
import { useEditor } from './editor.js';
import { useUnsaved } from './unsaved.js';

const dropped = () => new File([fixtureSource()], 'artifact.html', { type: 'text/html' });

beforeEach(() => {
  // notice 까지 지운다. 남겨두면 앞 테스트의 알림이 다음 단정으로 새어 나간다.
  // unsaved 도 지운다 — 남으면 다음 테스트의 adopt 가 있지도 않은 편집을 두고 물으며 멈춘다.
  useEditor.setState({
    file: null,
    source: '',
    blocks: [],
    previewDoc: '',
    patches: new Map(),
    editOrder: [],
    revertQueue: [],
    notice: null,
    unsaved: false,
  });
  useUnsaved.setState({ why: null, answer: null });
});

describe('editor · 파일 열기 (동적 import 경로)', () => {
  it('놓은 파일을 파싱해 블록과 프리뷰 문서를 채운다', async () => {
    await useEditor.getState().loadDropped(dropped());

    const { source, blocks, previewDoc, notice } = useEditor.getState();
    // 파서를 동적으로 불러오므로 load 를 await 하지 않으면 여기가 전부 빈 채로 남는다 (ADR-008).
    expect(notice).toBeNull();
    expect(blocks.length).toBeGreaterThan(0);
    expect(source).toBe(fixtureSource());
    expect(previewDoc).toContain('data-ne-id');
  });

  it('로드가 끝나면 busy 가 풀린다 — 청크를 기다리다 굳지 않는다', async () => {
    await useEditor.getState().loadDropped(dropped());
    expect(useEditor.getState().busy).toBe(false);
  });
});

describe('editor · 마지막 변경 되돌리기 (Ctrl+Z)', () => {
  /** 편집 가능한 블록 두 개를 골라 각각 고친다 */
  async function twoEdits() {
    await useEditor.getState().loadDropped(dropped());
    const [a, b] = useEditor.getState().blocks.filter((x) => x.locked === null);
    if (!a || !b) throw new Error('편집 가능한 블록이 둘 필요하다');
    useEditor.getState().onEdit(a.id, 'A 수정');
    useEditor.getState().onEdit(b.id, 'B 수정');
    return { a, b };
  }

  it('가장 최근에 고친 블록만 되돌린다', async () => {
    const { a, b } = await twoEdits();

    useEditor.getState().undoLast();

    const { patches } = useEditor.getState();
    expect(patches.has(b.id)).toBe(false);
    expect(patches.get(a.id)).toBe('A 수정');
  });

  it('다시 고친 블록이 가장 최근이 된다 — Map 순서로는 알 수 없다', async () => {
    const { a, b } = await twoEdits();
    useEditor.getState().onEdit(a.id, 'A 다시 수정');

    useEditor.getState().undoLast();

    const { patches } = useEditor.getState();
    expect(patches.has(a.id)).toBe(false);
    expect(patches.get(b.id)).toBe('B 수정');
  });

  it('되돌린 블록은 순서에서 빠진다 — 두 번 눌러도 되살아나지 않는다', async () => {
    const { a, b } = await twoEdits();

    useEditor.getState().undoLast();
    useEditor.getState().undoLast();
    useEditor.getState().undoLast();

    expect(useEditor.getState().patches.size).toBe(0);
    expect(useEditor.getState().editOrder).toEqual([]);
    expect(useEditor.getState().revertQueue.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it('고친 것이 없으면 아무 일도 하지 않는다', async () => {
    await useEditor.getState().loadDropped(dropped());

    useEditor.getState().undoLast();

    expect(useEditor.getState().revertQueue).toEqual([]);
  });
});

describe('editor · 사본 내려받기', () => {
  it('패치가 없어도 원본을 그대로 내려받는다 — 고치기 전 백업 용도', () => {
    const url = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', { ...URL, createObjectURL: url, revokeObjectURL: vi.fn() });

    useEditor.setState({
      file: { name: 'artifact.html', text: fixtureSource(), handle: null },
      source: fixtureSource(),
      blocks: [],
      patches: new Map(),
    });
    useEditor.getState().downloadCopy();

    expect(url).toHaveBeenCalledOnce();
    expect(useEditor.getState().notice).toEqual({
      key: 'notice.copyDownloaded',
      params: { name: 'artifact.html', count: 0 },
    });
    vi.unstubAllGlobals();
  });

  it('파일이 없으면 아무 일도 하지 않는다', () => {
    useEditor.getState().downloadCopy();
    expect(useEditor.getState().notice).toBeNull();
  });
});

describe('editor · 저장', () => {
  it('고친 것이 없으면 저장하지 않는다 — Ctrl+S 가 같은 내용을 다시 쓰지 않게', async () => {
    await useEditor.getState().loadDropped(dropped());

    await useEditor.getState().save();

    // 아무 일도 없었으니 알릴 것도 없다.
    expect(useEditor.getState().notice).toBeNull();
  });
});

describe('editor · 폴더 열기', () => {
  /** showDirectoryPicker 가 주는 핸들 흉내 — 파일 핸들에는 getFile 이, 폴더에는 entries 가 있다 */
  function fakeDir(files: Record<string, string>) {
    const entries = Object.entries(files).map(([name, body]) => [
      name,
      {
        name,
        getFile: () => Promise.resolve(new File([body], name, { type: 'text/html' })),
        createWritable: () =>
          Promise.resolve({ write: () => Promise.resolve(), close: () => Promise.resolve() }),
      },
    ]);
    return {
      name: 'deck',
      entries: () => ({
        [Symbol.asyncIterator]: () => {
          let at = 0;
          return {
            next: () =>
              Promise.resolve(
                at < entries.length
                  ? { value: entries[at++], done: false }
                  : { value: undefined, done: true }
              ),
          };
        },
      }),
    };
  }

  function withPicker(dir: unknown) {
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = () =>
      Promise.resolve(dir);
  }

  it('폴더 안의 문서를 열고, 되쓸 핸들을 함께 들고 온다', async () => {
    // 열기로 연 것은 덮어쓴다 — 폴더에서도 같아야 한다.
    withPicker(fakeDir({ 'index.html': '<p>본문</p>', 'style.css': 'p{color:red}' }));

    await useEditor.getState().openFolder();

    const { file, blocks, docPath } = useEditor.getState();
    expect(file?.name).toBe('index.html');
    expect(docPath).toBe('index.html');
    expect(file?.handle).not.toBeNull();
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('편집 허용을 거절하면 아무 일도 일어나지 않는다', async () => {
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = () =>
      Promise.reject(new DOMException('사용자가 취소', 'AbortError'));

    await useEditor.getState().openFolder();

    expect(useEditor.getState().file).toBeNull();
    expect(useEditor.getState().notice).toBeNull();
    expect(useEditor.getState().busy).toBe(false);
  });

  it('HTML 이 없는 폴더는 이유를 말한다', async () => {
    withPicker(fakeDir({ 'style.css': 'p{color:red}' }));

    await useEditor.getState().openFolder();

    expect(useEditor.getState().notice).toEqual({ key: 'notice.bundleNoDocument' });
  });
});

describe('editor · 저장했는지 아는가', () => {
  it('저장하면 되묻지 않을 상태가 된다', async () => {
    // patches 는 저장해도 남는다(INV-1). 그걸로 판단하면 저장한 뒤에도 계속 되묻는다.
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    expect(useEditor.getState().unsaved).toBe(true);

    await useEditor.getState().save();

    expect(useEditor.getState().unsaved).toBe(false);
    expect(useEditor.getState().patches.size).toBe(1);
  });

  it('저장한 뒤 다시 고치면 또 저장할 것이 생긴다', async () => {
    await useEditor.getState().loadDropped(dropped());
    const [a, b] = useEditor.getState().blocks.filter((x) => x.locked === null);
    useEditor.getState().onEdit(a?.id ?? -1, '고친 값');
    await useEditor.getState().save();

    useEditor.getState().onEdit(b?.id ?? -1, '또 고친 값');

    expect(useEditor.getState().unsaved).toBe(true);
  });

  it('되돌리기도 파일과 달라지는 일이다', async () => {
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((x) => x.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    await useEditor.getState().save();

    useEditor.getState().revert(target?.id ?? -1);

    expect(useEditor.getState().unsaved).toBe(true);
  });

  it('저장할 것이 없으면 저장하지 않는다', async () => {
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((x) => x.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    await useEditor.getState().save();

    // 같은 내용을 다시 쓰는 헛일을 막는다.
    expect(await useEditor.getState().save()).toBe(false);
  });
});

describe('editor · 자원을 붙일 때 디스크를 다시 읽는다', () => {
  it('저장한 뒤 폴더를 연결해도 저장한 내용이 살아 있다', async () => {
    // source 는 열었을 때 그대로다(INV-1). 그 상태로 다시 그리면 저장한 편집이 화면에서
    // 사라지고, 그 뒤에 저장하면 디스크의 내용을 옛 내용으로 덮어쓴다.
    const saved = '<html><body><p>저장된 뒤의 내용</p></body></html>';
    const handle = {
      name: 'deck.html',
      getFile: () => Promise.resolve(new File([saved], 'deck.html', { type: 'text/html' })),
      createWritable: () =>
        Promise.resolve({ write: () => Promise.resolve(), close: () => Promise.resolve() }),
    };
    await useEditor.getState().adopt({
      name: 'deck.html',
      text: '<html><body><p>열었을 때의 내용</p></body></html>',
      handle,
    });
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = () =>
      Promise.resolve({
        name: 'deck',
        entries: () => ({
          [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true }) }),
        }),
      });

    await useEditor.getState().linkFolder();

    expect(useEditor.getState().source).toBe(saved);
  });
});

describe('editor · 리뷰가 짚은 자리', () => {
  it('묻는 동안에는 busy 가 아니다 — 대화상자의 저장 버튼이 눌려야 한다', async () => {
    // busy 면 "저장하고 계속하기" 가 비활성이라 남는 선택지가 버리기와 취소뿐이 된다.
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = () =>
      Promise.resolve({
        name: 'deck',
        entries: () => ({
          [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true }) }),
        }),
      });

    const asking = useEditor.getState().linkFolder();
    for (let tries = 0; useUnsaved.getState().why === null && tries < 1000; tries++) {
      await Promise.resolve();
    }
    const busyWhileAsking = useEditor.getState().busy;
    useUnsaved.getState().reply('cancel');
    await asking;

    expect(busyWhileAsking).toBe(false);
  });

  it('눌렀다 그냥 빠져나온 것은 고친 것이 아니다', async () => {
    // 그것까지 저장할 것으로 세면 아무것도 안 고치고도 되묻는다.
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);

    useEditor.getState().onEdit(target?.id ?? -1, target?.sourceInner ?? '', true);

    expect(useEditor.getState().patches.size).toBe(0);
    expect(useEditor.getState().unsaved).toBe(false);
  });
});

/** 대화상자가 뜨기를 기다렸다가 대신 답한다 — 사람이 버튼을 누르는 자리다 */
async function answerWith(choice: 'save' | 'discard' | 'cancel'): Promise<void> {
  for (let tries = 0; useUnsaved.getState().why === null; tries++) {
    if (tries > 1000) throw new Error('대화상자가 뜨지 않았다');
    await Promise.resolve();
  }
  useUnsaved.getState().reply(choice);
}

/** 안이 문자열이면 파일, 객체면 하위 폴더인 showDirectoryPicker 폴더 흉내 */
type Tree = { [name: string]: string | Tree };
function fakeTree(name: string, tree: Tree): unknown {
  const entries = Object.entries(tree).map(([entryName, value]) => [
    entryName,
    typeof value === 'string'
      ? {
          name: entryName,
          getFile: () => Promise.resolve(new File([value], entryName, { type: 'text/html' })),
        }
      : fakeTree(entryName, value),
  ]);
  return {
    name,
    entries: () => ({
      [Symbol.asyncIterator]: () => {
        let at = 0;
        return {
          next: () =>
            Promise.resolve(
              at < entries.length
                ? { value: entries[at++], done: false }
                : { value: undefined, done: true }
            ),
        };
      },
    }),
  };
}

function pickerReturns(dir: unknown): void {
  (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = () =>
    Promise.resolve(dir);
}



describe('editor · 디스크를 다시 못 읽으면 멈춘다', () => {
  it('폴더의 문서를 다시 읽다 실패하면 빈 문서를 열지 않고 이유를 말한다', async () => {
    // 옛 코드는 실패를 삼키고 빈 자리 표시로 계속 가서, 고른 문서가 빈 화면으로 열렸다.
    let reads = 0;
    const handle = {
      name: 'index.html',
      getFile: () => {
        reads++;
        return reads === 1
          ? Promise.resolve(new File(['<p>본문</p>'], 'index.html', { type: 'text/html' }))
          : Promise.reject(new Error('디스크에서 사라졌다'));
      },
    };
    pickerReturns({
      name: 'deck',
      entries: () => ({
        [Symbol.asyncIterator]: () => {
          let given = false;
          return {
            next: () => {
              if (given) return Promise.resolve({ value: undefined, done: true });
              given = true;
              return Promise.resolve({ value: ['index.html', handle], done: false });
            },
          };
        },
      }),
    });

    await useEditor.getState().openFolder();

    expect(useEditor.getState().file).toBeNull();
    expect(useEditor.getState().notice).toEqual({
      key: 'notice.openFailedDetail',
      params: { detail: '디스크에서 사라졌다' },
    });
    expect(useEditor.getState().busy).toBe(false);
  });

  it('폴더 연결에서 다시 읽다 실패하면 옛 바이트로 다시 그리지 않는다', async () => {
    // 옛 바이트로 그리면 저장한 편집이 화면에서 사라지고, 그 뒤에 저장하면
    // 디스크의 새 내용을 옛 내용으로 덮어쓴다.
    const handle = {
      name: 'deck.html',
      getFile: () => Promise.reject(new Error('디스크에서 사라졌다')),
      createWritable: () =>
        Promise.resolve({ write: () => Promise.resolve(), close: () => Promise.resolve() }),
    };
    await useEditor.getState().adopt({
      name: 'deck.html',
      text: '<html><body><p>열었을 때의 내용</p></body></html>',
      handle,
    });
    pickerReturns(fakeTree('assets', {}));

    await useEditor.getState().linkFolder();

    expect(useEditor.getState().notice).toEqual({
      key: 'notice.openFailedDetail',
      params: { detail: '디스크에서 사라졌다' },
    });
    // 보던 화면은 그대로 살아 있어야 한다.
    expect(useEditor.getState().source).toContain('열었을 때의 내용');
    expect(useEditor.getState().busy).toBe(false);
  });
});

describe('editor · OS 가 열어준 파일도 편집을 두고 묻는다', () => {
  it('고치던 것이 있으면 대화상자를 띄우고, 취소하면 지금 문서에 머문다', async () => {
    // launchQueue 로 들어와도 다른 파일 열기다. 조용히 갈아타면 편집이 사라진다 (spec §4).
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    const adopting = useEditor
      .getState()
      .adopt({ name: 'another.html', text: '<p>다른 파일</p>', handle: null });
    await answerWith('cancel');
    await adopting;

    expect(useEditor.getState().file?.name).toBe('artifact.html');
    expect(useEditor.getState().patches.size).toBe(1);
  });

  it('버리기를 고르면 새 파일로 갈아탄다', async () => {
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    const adopting = useEditor.getState().adopt({
      name: 'another.html',
      text: '<html><body><p>다른 파일</p></body></html>',
      handle: null,
    });
    await answerWith('discard');
    await adopting;

    expect(useEditor.getState().file?.name).toBe('another.html');
    expect(useEditor.getState().patches.size).toBe(0);
  });
});




