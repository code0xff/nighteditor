// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureSource } from '../__fixtures__/load.js';
import { useEditor } from './editor.js';
import { useUnsaved } from './unsaved.js';

const dropped = () => new File([fixtureSource()], 'artifact.html', { type: 'text/html' });

beforeEach(() => {
  // notice 까지 지운다. 남겨두면 앞 테스트의 알림이 다음 단정으로 새어 나간다.
  useEditor.setState({
    file: null,
    source: '',
    blocks: [],
    previewDoc: '',
    patches: new Map(),
    editOrder: [],
    revertQueue: [],
    notice: null,
  });
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
