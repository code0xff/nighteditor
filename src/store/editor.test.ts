// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureSource } from '../__fixtures__/load.js';
import { useEditor } from './editor.js';

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
