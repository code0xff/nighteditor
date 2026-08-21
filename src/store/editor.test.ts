// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureSource } from '../__fixtures__/load.js';
import type { FolderRead } from '@/lib/fs';
import { countAssets, unsavedCount, useEditor } from './editor.js';
import { useReplacement } from './replacement.js';
import { useToasts } from './toasts.js';
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
    savedText: '',
    saving: false,
  });
  // 잠금은 예약 스토어에 있다 — 앞 테스트가 세워 둔 잠금이 새면 편집이 거절된다.
  useReplacement.setState({ replacing: false });
  useUnsaved.setState({ why: null, answer: null });
  useToasts.getState().clear();
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

  it('로드가 끝나면 잠금이 풀린다 — 청크를 기다리다 굳지 않는다', async () => {
    await useEditor.getState().loadDropped(dropped());
    expect(useReplacement.getState().replacing).toBe(false);
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
    expect(useReplacement.getState().replacing).toBe(false);
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

  it('저장한 적 없는 편집을 되돌리면 다시 깨끗해진다', async () => {
    // unsaved 를 단조 증가로 두면 결과물이 파일과 같은데도 되묻는다 (spec §5).
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((x) => x.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    expect(useEditor.getState().unsaved).toBe(true);

    useEditor.getState().revert(target?.id ?? -1);

    expect(useEditor.getState().unsaved).toBe(false);
  });

  it('전체 되돌리기도 파일과 같아지면 깨끗해진다', async () => {
    await useEditor.getState().loadDropped(dropped());
    const [a, b] = useEditor.getState().blocks.filter((x) => x.locked === null);
    useEditor.getState().onEdit(a?.id ?? -1, 'A 수정');
    useEditor.getState().onEdit(b?.id ?? -1, 'B 수정');

    useEditor.getState().revertAll();

    expect(useEditor.getState().unsaved).toBe(false);
  });

  it('제목을 고쳤다가 원래대로 돌려 적으면 깨끗해진다', async () => {
    // 손으로 되돌린 편집도 결과물이 파일과 같으면 잃을 것이 없다.
    await useEditor.getState().loadDropped(dropped());
    const title = useEditor.getState().blocks.find((x) => x.rcdata);
    useEditor.getState().onEdit(title?.id ?? -1, '새 제목');
    expect(useEditor.getState().unsaved).toBe(true);

    useEditor.getState().onEdit(title?.id ?? -1, title?.sourceText ?? '');

    expect(useEditor.getState().unsaved).toBe(false);
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

describe('editor · zip 오류는 언어팩을 거쳐 알린다', () => {
  it('zip 이 아닌 파일을 zip 으로 열면 사유가 문장이 아니라 메시지 키로 온다 (spec §1)', async () => {
    // ZipError 의 원문을 그대로 붙이면 영어 UI 에 한국어 내부 문장이 샌다.
    await useEditor.getState().loadDropped(new File(['이건 zip 이 아니다'], 'bad.zip'));

    expect(useEditor.getState().notice).toEqual({
      key: 'notice.openFailedDetail',
      params: { detail: { key: 'zip.notZip', params: {} } },
    });
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

describe('editor · <base href> 가 옮긴 기준으로 자원을 찾는다 (spec §5.1)', () => {
  it('base 디렉터리 기준으로 붙일 파일을 찾는다', async () => {
    // 문서 자리만 보면 assets/style.css 가 옆에 있는데도 style.css 가 없다고 센다.
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });
    await useEditor.getState().loadFolder({
      files: new Map([
        [
          'index.html',
          new File(
            [
              '<html><head><base href="assets/"><link rel="stylesheet" href="style.css"></head>' +
                '<body><p>본문</p></body></html>',
            ],
            'index.html'
          ),
        ],
        ['assets/style.css', new File(['p{color:red}'], 'style.css')],
      ]),
      handles: new Map(),
      truncated: false,
    });

    expect(useEditor.getState().assetPaths).toContain('assets/style.css');
    expect(countAssets(useEditor.getState())).toEqual({ linked: 1, missing: 0 });
    vi.unstubAllGlobals();
  });

  it('바깥을 가리키는 base 면 상대 참조를 없는 파일로 세지 않는다', async () => {
    await useEditor.getState().loadFolder({
      files: new Map([
        [
          'index.html',
          new File(
            [
              '<html><head><base href="https://cdn.example/"><link rel="stylesheet" href="style.css"></head>' +
                '<body><p>본문</p></body></html>',
            ],
            'index.html'
          ),
        ],
      ]),
      handles: new Map(),
      truncated: false,
    });

    expect(useEditor.getState().assetPaths).toEqual([]);
    // 치환할 것이 없으니 프리뷰에 blob: 이 들어가지 않는다.
    expect(useEditor.getState().previewDoc).not.toContain('blob:');
  });
});

describe('editor · 핸들 없는 문서의 저장본은 내려받은 사본이다 (spec §5)', () => {
  it('내려받기로 저장한 뒤 폴더를 연결해도 저장한 내용이 살아 있다', async () => {
    // 핸들이 없으면 reread 가 file.text 를 그대로 돌려준다. 저장이 그 text 를
    // 결과물로 갈아 끼우지 않으면, 폴더 연결이 저장 전 내용으로 프리뷰를 되돌린다.
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });
    await useEditor.getState().adopt({
      name: 'deck.html',
      text: '<html><body><p>열었을 때의 내용</p></body></html>',
      handle: null,
    });
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 내용');

    expect(await useEditor.getState().save()).toBe(true);
    const output = useEditor.getState().savedText;
    expect(output).toContain('고친 내용');

    pickerReturns(fakeTree('assets', {}));
    await useEditor.getState().linkFolder();

    expect(useEditor.getState().source).toBe(output);
    expect(useEditor.getState().unsaved).toBe(false);
    vi.unstubAllGlobals();
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
    const savingWhileAsking = useEditor.getState().saving;
    const replacingWhileAsking = useReplacement.getState().replacing;
    useUnsaved.getState().reply('cancel');
    await asking;

    expect(savingWhileAsking).toBe(false);
    expect(replacingWhileAsking).toBe(false);
  });

  it('갈아 끼우는 동안의 편집은 거절하고 알린다', async () => {
    // 물음에 답한 뒤 새 문서를 읽는 사이의 편집은 새 상태가 설치되는 순간 사라진다.
    // 받아 두었다가 버리면 조용히 사라지는 것이다 (대원칙 3) — 받지 않고 알린다.
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useReplacement.setState({ replacing: true });

    useEditor.getState().onEdit(target?.id ?? -1, '사라질 편집');

    expect(useEditor.getState().patches.size).toBe(0);
    expect(useEditor.getState().unsaved).toBe(false);
    expect(useToasts.getState().toasts.some((t) => t.notice.key === 'app.editWhileReplacing')).toBe(
      true
    );
  });

  it('갈아 끼우는 동안의 되돌리기는 거절하고 알린다', async () => {
    // 목록이 보여주는 것은 아직 이전 문서다 — 되돌린 패치도, 프리뷰로 보낼 되돌림도
    // 설치 순간 갈 곳이 없다. 버튼은 잠기지만 Ctrl+Z 는 언제든 눌린다 (spec §4).
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    useReplacement.setState({ replacing: true });

    useEditor.getState().revert(target?.id ?? -1);
    useEditor.getState().undoLast();
    useEditor.getState().revertAll();

    expect(useEditor.getState().patches.get(target?.id ?? -1)).toBe('고친 값');
    expect(useEditor.getState().revertQueue).toEqual([]);
    expect(useToasts.getState().toasts.some((t) => t.notice.key === 'app.editWhileReplacing')).toBe(
      true
    );
  });

  it('여는 동안 replacing 이 서고, 끝나면 풀린다', async () => {
    // 화면(제목 칸·프리뷰)이 이 값을 보고 잠근다. 서지 않으면 잠글 근거가 없고,
    // 안 풀리면 새 문서를 영영 못 고친다.
    const seen: boolean[] = [];
    const unsub = useReplacement.subscribe((s) => seen.push(s.replacing));
    await useEditor.getState().loadDropped(dropped());
    unsub();

    expect(seen).toContain(true);
    expect(useReplacement.getState().replacing).toBe(false);
  });

  it('여는 데 실패해도 replacing 이 풀린다 — 보던 문서를 계속 고칠 수 있어야 한다', async () => {
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);

    await useEditor.getState().loadDropped(new File(['x'], 'bad.zip', { type: 'application/zip' }));

    expect(useReplacement.getState().replacing).toBe(false);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    expect(useEditor.getState().patches.size).toBe(1);
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

/**
 * 되쓸 수 있는 파일 핸들 흉내. 쓴 내용을 밖에서 볼 수 있다.
 * `sameEntry` 의 기본은 false — 같은 파일임은 테스트가 명시적으로 선언해야 한다.
 */
function fakeHandle(
  name: string,
  text: () => string,
  writes: string[] = [],
  sameEntry: () => boolean = () => false
) {
  return {
    name,
    isSameEntry: () => Promise.resolve(sameEntry()),
    getFile: () => Promise.resolve(new File([text()], name, { type: 'text/html' })),
    createWritable: () =>
      Promise.resolve({
        write: (data: string) => {
          writes.push(data);
          return Promise.resolve();
        },
        close: () => Promise.resolve(),
      }),
  };
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
    expect(useReplacement.getState().replacing).toBe(false);
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
    expect(useReplacement.getState().replacing).toBe(false);
  });
});

describe('editor · 잘린 스캔에서 문서를 못 찾으면 그 사정도 말한다 (spec §5.1)', () => {
  it('놓은 폴더가 잘렸으면 "문서가 없다" 라고만 하지 않는다', async () => {
    // 문서는 한도 밖에 있었을 수 있다 — 없다고 단정하면 거짓말이 된다 (대원칙 3).
    await useEditor.getState().loadFolder({
      files: new Map([['notes.txt', new File(['메모'], 'notes.txt')]]),
      handles: new Map(),
      truncated: true,
    });

    expect(useEditor.getState().notice).toEqual({
      key: 'notice.bundleNoDocumentTruncated',
      params: { count: 1 },
    });
  });

  it('열기 대화상자로 고른 폴더도 같다 — 깊이 한도 밖의 문서는 못 찾은 것이 아니다', async () => {
    let tree: Tree = { 'index.html': '<p>깊다</p>' };
    for (let i = 0; i < 9; i++) tree = { [`d${i}`]: tree };
    pickerReturns(fakeTree('deck', tree));

    await useEditor.getState().openFolder();

    expect(useEditor.getState().notice).toEqual({
      key: 'notice.bundleNoDocumentTruncated',
      params: { count: 0 },
    });
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

describe('editor · 폴더 연결은 묶음에 핸들을 남기지 않는다', () => {
  it('연결한 폴더의 다른 문서로 갈아타면 핸들 없이 열린다', async () => {
    // 연결은 읽기 전용(read)이다. 그 핸들이 묶음에 남으면 갈아탄 문서의 저장이
    // "덮어쓰기" 라면서 쓰기 권한이 없어 그제서야 실패한다.
    const handle = fakeHandle('deck.html', () => '<html><body><p>본문</p></body></html>');
    await useEditor.getState().adopt({
      name: 'deck.html',
      text: '<html><body><p>본문</p></body></html>',
      handle,
    });
    pickerReturns(
      fakeTree('assets', { 'other.html': '<html><body><p>다른 문서</p></body></html>' })
    );

    await useEditor.getState().linkFolder();
    expect(useEditor.getState().bundleHandles.size).toBe(0);

    await useEditor.getState().openFromBundle('other.html');

    expect(useEditor.getState().file?.name).toBe('other.html');
    expect(useEditor.getState().file?.handle).toBeNull();
  });

  it('파일 하나로 연 문서도 제 폴더를 연결하면 핸들이 산다 — 이름이 곧 경로다', async () => {
    // 파일 열기로 연 문서에는 묶음 경로가 없다. 그대로 두면 keep 이 비어, 폴더를
    // 연결하고 다른 문서로 갔다 돌아올 때 핸들 없이 열린다 — 덮어쓰기라던 저장이
    // 조용히 사본 내려받기로 격하된다 (spec §5.1 · 핸들 유지).
    const text = '<html><body><p>본문</p></body></html>';
    const onDisk = '<html><body><p>저장한 뒤의 본문</p></body></html>';
    const handle = fakeHandle(
      'index.html',
      () => onDisk,
      [],
      () => true
    );
    // adopt(파일 열기·OS 열기)와 같은 모양 — path 가 없다.
    useEditor.setState({ file: { name: 'index.html', text, handle } });
    pickerReturns(
      fakeTree('deck', {
        'index.html': text,
        'other.html': '<html><body><p>다른 문서</p></body></html>',
      })
    );

    await useEditor.getState().linkFolder();
    expect(useEditor.getState().docPath).toBe('index.html');
    expect(useEditor.getState().bundleHandles.get('index.html')).toBe(handle);

    await useEditor.getState().openFromBundle('other.html');
    await useEditor.getState().openFromBundle('index.html');

    expect(useEditor.getState().file?.handle).toBe(handle);
    // 묶음의 옛 바이트가 아니라 디스크의 지금 내용으로 돌아와야 한다.
    expect(useEditor.getState().source).toBe(onDisk);
  });

  it('지금 문서의 쓰기 핸들만은 남긴다 — 갔다 돌아와도 덮어쓰기가 산다 (spec §5.1)', async () => {
    // 핸들을 다 버리면 돌아온 문서가 연결할 때 읽어 둔 옛 바이트로 열리고,
    // 저장은 조용히 사본 내려받기로 격하된다.
    const text = '<html><body><p>본문</p></body></html>';
    const onDisk = '<html><body><p>저장한 뒤의 본문</p></body></html>';
    const handle = fakeHandle(
      'index.html',
      () => onDisk,
      [],
      () => true
    );
    useEditor.setState({ file: { name: 'index.html', text, handle, path: 'index.html' } });
    pickerReturns(
      fakeTree('deck', {
        'index.html': text,
        'other.html': '<html><body><p>다른 문서</p></body></html>',
      })
    );

    await useEditor.getState().linkFolder();
    expect(useEditor.getState().bundleHandles.get('index.html')).toBe(handle);

    await useEditor.getState().openFromBundle('other.html');
    await useEditor.getState().openFromBundle('index.html');

    expect(useEditor.getState().file?.handle).toBe(handle);
    // 묶음의 옛 바이트가 아니라 디스크의 지금 내용으로 돌아와야 한다.
    expect(useEditor.getState().source).toBe(onDisk);
  });
});

describe('editor · 핸들은 같은 파일임을 증명한 자리에만 남는다 (spec §5.1)', () => {
  it('이름만 같은 남의 index.html 경로에 쓰기 핸들을 걸지 않는다', async () => {
    // 기본명 폴백이 고른 경로는 남의 파일일 수 있다. 핸들이 남으면 갔다 돌아올 때
    // 그 자리에서 이 파일이 대신 열리고, 저장이 남의 자리 내용을 덮는다.
    const mine = '<html><body><p>내 문서</p></body></html>';
    const theirs = '<html><body><p>남의 index</p></body></html>';
    const handle = fakeHandle('index.html', () => mine); // isSameEntry → false
    useEditor.setState({ file: { name: 'index.html', text: mine, handle } });
    pickerReturns(
      fakeTree('deck', {
        'index.html': theirs,
        'other.html': '<html><body><p>다른 문서</p></body></html>',
      })
    );

    await useEditor.getState().linkFolder();

    expect(useEditor.getState().bundleHandles.size).toBe(0);

    // 갔다 돌아오면 폴더에 실제로 담긴 그 문서가 열려야 한다 — 내 핸들의 내용이 아니라.
    await useEditor.getState().openFromBundle('other.html');
    await useEditor.getState().openFromBundle('index.html');
    expect(useEditor.getState().file?.handle).toBeNull();
    expect(useEditor.getState().source).toBe(theirs);
  });

  it('증명 못 한 문서는 묶음의 일원이 아니다 — 저장이 폴더의 다른 문서를 갈아 끼우지 않는다', async () => {
    // 옛 코드는 핸들만 안 남기고 docPath 는 겹친 경로로 잡았다. 그러면 저장이 그
    // 경로의 묶음 내용을 이 문서의 결과물로 바꿔치기하고, 목록에서 폴더의 진짜
    // index.html 을 여는 길은 "이미 열려 있다" 며 조용히 막혔다 (spec §5.1).
    const mine = '<html><body><p>내 문서</p></body></html>';
    const theirs = '<html><body><p>남의 index</p></body></html>';
    const writes: string[] = [];
    const handle = fakeHandle('index.html', () => mine, writes); // isSameEntry → false
    useEditor.setState({ file: { name: 'index.html', text: mine, handle } });
    pickerReturns(
      fakeTree('deck', {
        'index.html': theirs,
        'other.html': '<html><body><p>다른 문서</p></body></html>',
      })
    );

    await useEditor.getState().linkFolder();
    expect(useEditor.getState().docPath).toBe('');

    // 내 문서를 고쳐 저장한다 — 결과물은 내 파일(핸들)로 가고, 묶음은 그대로여야 한다.
    const target = useEditor.getState().blocks.find((b) => b.locked === null && !b.rcdata);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    expect(await useEditor.getState().save()).toBe(true);
    expect(writes[0]).toContain('고친 값');

    // 겹친 경로의 문서는 지금 문서가 아니므로 목록에서 열 수 있고, 폴더의 내용이 나와야 한다.
    await useEditor.getState().openFromBundle('index.html');
    expect(useEditor.getState().source).toBe(theirs);
  });
});

describe('editor · 저장하는 사이의 편집', () => {
  it('파일을 쓰는 동안 확정된 편집은 저장 안 된 채로 남는다', async () => {
    // unsaved 를 무조건 지우면 그 편집이 "이미 저장됨" 으로 읽혀, 다음 파일을 열 때
    // 묻지도 않고 사라진다.
    let releaseWrite: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (releaseWrite = resolve));
    const handle = {
      name: 'deck.html',
      getFile: () => Promise.resolve(new File(['<p>하나</p>'], 'deck.html', { type: 'text/html' })),
      createWritable: () => Promise.resolve({ write: () => gate, close: () => Promise.resolve() }),
    };
    await useEditor.getState().adopt({
      name: 'deck.html',
      text: '<html><body><p>하나</p><p>둘</p></body></html>',
      handle,
    });
    const [a, b] = useEditor.getState().blocks.filter((x) => x.locked === null);
    useEditor.getState().onEdit(a?.id ?? -1, 'A 수정');

    const saving = useEditor.getState().save();
    useEditor.getState().onEdit(b?.id ?? -1, 'B 수정');
    releaseWrite?.();
    await saving;

    expect(useEditor.getState().unsaved).toBe(true);
  });

  it('쓰는 동안 아무 일도 없었으면 깨끗해진다', async () => {
    const handle = fakeHandle('deck.html', () => '<html><body><p>하나</p></body></html>');
    await useEditor.getState().adopt({
      name: 'deck.html',
      text: '<html><body><p>하나</p></body></html>',
      handle,
    });
    const target = useEditor.getState().blocks.find((x) => x.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    await useEditor.getState().save();

    expect(useEditor.getState().unsaved).toBe(false);
  });
});

describe('editor · 갈아탄 뒤 도착한 저장 결과는 버린다 (spec §5)', () => {
  it('쓰는 동안 다른 문서를 열면 뒤늦게 끝난 저장이 새 문서의 상태에 적히지 않는다', async () => {
    // 옛 코드는 저장 완료 콜백에 문서 확인이 없어, 옛 결과물이 새 문서의
    // savedText·file.text 에 들어가고 알림까지 "저장했다" 고 떴다.
    let releaseWrite: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (releaseWrite = resolve));
    const oldText = '<html><body><p>옛 문서</p></body></html>';
    const newText = '<html><body><p>새 문서</p></body></html>';
    const handle = {
      name: 'old.html',
      getFile: () => Promise.resolve(new File([oldText], 'old.html', { type: 'text/html' })),
      createWritable: () => Promise.resolve({ write: () => gate, close: () => Promise.resolve() }),
    };
    await useEditor.getState().adopt({ name: 'old.html', text: oldText, handle });
    const target = useEditor.getState().blocks.find((b) => b.locked === null && !b.rcdata);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    const saving = useEditor.getState().save();
    // 파일을 쓰는 사이에 다른 문서로 갈아탄다 — 고치던 것은 버리기로 답한다.
    const adopting = useEditor.getState().adopt({ name: 'new.html', text: newText, handle: null });
    await answerWith('discard');
    await adopting;
    releaseWrite?.();
    expect(await saving).toBe(false);

    const s = useEditor.getState();
    expect(s.file?.name).toBe('new.html');
    // 새 문서의 저장본·내용은 새 문서의 것 그대로여야 한다.
    expect(s.savedText).toBe(newText);
    expect(s.file?.text).toBe(newText);
    expect(s.unsaved).toBe(false);
    // 이전 문서의 "저장했다" 가 새 문서 위에 뜨지 않는다.
    expect(s.notice).toBeNull();
    expect(s.saving).toBe(false);
  });

  it('갈아탄 뒤 도착한 저장 실패도 새 문서에 알리지 않는다', async () => {
    // 이름도 없는 실패 알림은 지금 문서의 일로 읽힌다 — 멀쩡한 새 문서를 두고 헤매게 한다.
    let failWrite: ((e: Error) => void) | undefined;
    const gate = new Promise<void>((_, reject) => (failWrite = reject));
    const oldText = '<html><body><p>옛 문서</p></body></html>';
    const handle = {
      name: 'old.html',
      getFile: () => Promise.resolve(new File([oldText], 'old.html', { type: 'text/html' })),
      createWritable: () => Promise.resolve({ write: () => gate, close: () => Promise.resolve() }),
    };
    await useEditor.getState().adopt({ name: 'old.html', text: oldText, handle });
    const target = useEditor.getState().blocks.find((b) => b.locked === null && !b.rcdata);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    const saving = useEditor.getState().save();
    const adopting = useEditor.getState().adopt({
      name: 'new.html',
      text: '<html><body><p>새 문서</p></body></html>',
      handle: null,
    });
    await answerWith('discard');
    await adopting;
    failWrite?.(new Error('디스크가 가득 찼다'));
    expect(await saving).toBe(false);

    expect(useEditor.getState().notice).toBeNull();
    expect(useEditor.getState().saving).toBe(false);
  });
});

describe('editor · 앞선 저장이 끝나도 갈아 끼우기 잠금은 풀리지 않는다 (spec §5)', () => {
  it('갈아 끼우는 사이에 끝난 저장은 제 표시(saving)만 내린다', async () => {
    // 옛 코드는 저장의 finally 가 공용 busy 를 내려, 새 문서를 읽는 중인데
    // 열기·문서 고르기가 풀렸다. 잠금은 예약의 것이라 저장이 건드릴 수 없다 (ADR-010).
    let releaseWrite: (() => void) | undefined;
    const writeGate = new Promise<void>((resolve) => (releaseWrite = resolve));
    const handle = {
      name: 'deck.html',
      getFile: () => Promise.resolve(new File(['<p>본문</p>'], 'deck.html', { type: 'text/html' })),
      createWritable: () =>
        Promise.resolve({ write: () => writeGate, close: () => Promise.resolve() }),
    };
    await useEditor.getState().adopt({
      name: 'deck.html',
      text: '<html><body><p>본문</p></body></html>',
      handle,
    });
    const target = useEditor.getState().blocks.find((b) => b.locked === null && !b.rcdata);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    const saving = useEditor.getState().save();

    // 저장이 아직 쓰는 사이에 새 갈아 끼우기가 확정된다 — 읽기는 멈춰 있다.
    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => (releaseRead = r));
    const read = {
      files: new Map<string, unknown>([
        [
          'index.html',
          {
            text: async () => {
              await readGate;
              return '<html><body><p>새 폴더</p></body></html>';
            },
          },
        ],
      ]),
      handles: new Map(),
      truncated: false,
    } as unknown as FolderRead;
    const opening = useEditor.getState().loadFolder(read);
    expect(useReplacement.getState().replacing).toBe(true);

    releaseWrite?.();
    expect(await saving).toBe(true);

    // 저장은 끝났지만 화면 잠금은 그대로다 — 저장이 내린 것은 제 표시뿐이다.
    expect(useEditor.getState().saving).toBe(false);
    expect(useReplacement.getState().replacing).toBe(true);

    releaseRead();
    await opening;
    expect(useReplacement.getState().replacing).toBe(false);
    expect(useEditor.getState().source).toContain('새 폴더');
  });
});

describe('editor · 저장한 편집을 되돌린 것도 저장할 수 있다', () => {
  it('패치가 0개여도 원본 그대로를 되써서 파일을 화면과 같게 만든다', async () => {
    // 패치 개수로 막으면 "저장하고 계속하기" 가 false 로 끝나, 대화상자에서
    // 빠져나갈 길이 취소와 버리기뿐이 된다 (spec §5).
    const source = '<html><body><p>본문</p></body></html>';
    const writes: string[] = [];
    const handle = fakeHandle('deck.html', () => source, writes);
    await useEditor.getState().adopt({ name: 'deck.html', text: source, handle });
    const target = useEditor.getState().blocks.find((x) => x.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    await useEditor.getState().save();

    useEditor.getState().revert(target?.id ?? -1);
    expect(useEditor.getState().unsaved).toBe(true);

    expect(await useEditor.getState().save()).toBe(true);
    expect(writes[1]).toBe(source);
    expect(useEditor.getState().unsaved).toBe(false);
  });
});

describe('editor · 내려받기로 저장한 편집은 묶음에도 남는다', () => {
  it('다른 문서로 갔다 돌아와도 저장한 결과물이 열린다', async () => {
    // 묶음(zip·드롭 폴더)의 문서에는 핸들이 없어 저장이 사본 내려받기로 간다.
    // 묶음이 열 때의 바이트를 그대로 들고 있으면, 갈아탔다 돌아올 때 그 옛 바이트가
    // 다시 열려 저장한 편집이 화면에서 조용히 사라진다 — 핸들 문서는 디스크에서
    // 다시 읽어 맞추지만, 내려받기 저장은 묶음이 유일한 원천이다.
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });
    const doc = (body: string) => new File([`<html><body><p>${body}</p></body></html>`], 'x');
    await useEditor.getState().loadFolder({
      files: new Map([
        ['index.html', doc('본문')],
        ['other.html', doc('다른 문서')],
      ]),
      handles: new Map(),
      truncated: false,
    });
    const target = useEditor.getState().blocks.find((x) => x.locked === null && !x.rcdata);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    expect(await useEditor.getState().save()).toBe(true);

    await useEditor.getState().openFromBundle('other.html');
    await useEditor.getState().openFromBundle('index.html');

    expect(useEditor.getState().source).toContain('고친 값');
    expect(useEditor.getState().unsaved).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('editor · 물음에 저장으로 답한 갈아타기는 저장 뒤의 묶음으로 연다 (spec §5)', () => {
  it('갈아탔다 돌아오면 방금 저장한 결과물이 열린다', async () => {
    // 옛 코드는 묻기 전에 받아 둔 묶음으로 열었다 — 물음의 저장이 묶음을 결과물로
    // 갈아 끼워도(내려받기 저장은 묶음이 유일한 원천), 설치가 저장 전 바이트를
    // 되살려 돌아왔을 때 저장한 내용이 조용히 사라졌다.
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });
    const doc = (body: string) => new File([`<html><body><p>${body}</p></body></html>`], 'x');
    await useEditor.getState().loadFolder({
      files: new Map([
        ['index.html', doc('본문')],
        ['other.html', doc('다른 문서')],
      ]),
      handles: new Map(),
      truncated: false,
    });
    const target = useEditor.getState().blocks.find((b) => b.locked === null && !b.rcdata);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    const switching = useEditor.getState().openFromBundle('other.html');
    await answerWith('save');
    await switching;
    expect(useEditor.getState().source).toContain('다른 문서');

    await useEditor.getState().openFromBundle('index.html');

    expect(useEditor.getState().source).toContain('고친 값');
    expect(useEditor.getState().unsaved).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('editor · 들어갔다 그냥 나와도 확정한 편집은 남는다', () => {
  it('저장한 편집이 있는 블록에서 pristine 으로 나와도 패치가 살아 있다', async () => {
    // 프리뷰의 pristine 은 "편집을 열 때의 화면과 같다" 다. 화면은 저장한 편집을
    // 보여주고 있으므로, 패치를 지우면 다음 저장이 그 블록을 원본으로 되돌린다 —
    // 화면에는 저장한 내용이 남은 채 파일만 옛날로 가는 분열이다.
    const source = '<html><body><p>본문</p></body></html>';
    const writes: string[] = [];
    const handle = fakeHandle('deck.html', () => source, writes);
    await useEditor.getState().adopt({ name: 'deck.html', text: source, handle });
    const target = useEditor.getState().blocks.find((x) => x.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    await useEditor.getState().save();

    // 저장한 블록에 들어갔다 그냥 나온다 — 에이전트는 화면 내용과 pristine 을 보낸다.
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값', true);

    expect(useEditor.getState().patches.get(target?.id ?? -1)).toBe('고친 값');
    expect(useEditor.getState().unsaved).toBe(false);
    // 파일은 이미 화면과 같다 — 다음 저장이 원본을 되쓰는 일은 없어야 한다.
    expect(await useEditor.getState().save()).toBe(false);
    expect(writes).toHaveLength(1);
  });

  it('저장한 적 없는 편집도 들어갔다 나오면 사라지지 않는다', async () => {
    // 옛 코드는 pristine 에서 패치를 지워, 화면에는 편집이 남은 채 저장할 것이
    // 없다고 읽혔다 — 닫으면 묻지도 않고 편집이 사라졌다.
    // 제목(rcdata)은 프리뷰가 아니라 호스트 필드에서 고치므로 pristine 경로가 아니다.
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((x) => x.locked === null && !x.rcdata);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    useEditor.getState().onEdit(target?.id ?? -1, '고친 값', true);

    expect(useEditor.getState().patches.get(target?.id ?? -1)).toBe('고친 값');
    expect(useEditor.getState().unsaved).toBe(true);
  });

  it('pristine 으로 나온 것은 편집 순서도 바꾸지 않는다', async () => {
    // 들어갔다 나온 것을 "가장 최근 변경" 으로 올리면 Ctrl+Z 가 엉뚱한 블록을 되돌린다.
    await useEditor.getState().loadDropped(dropped());
    const [a, b] = useEditor.getState().blocks.filter((x) => x.locked === null && !x.rcdata);
    useEditor.getState().onEdit(a?.id ?? -1, 'A 수정');
    useEditor.getState().onEdit(b?.id ?? -1, 'B 수정');

    useEditor.getState().onEdit(a?.id ?? -1, 'A 수정', true);
    useEditor.getState().undoLast();

    const { patches } = useEditor.getState();
    expect(patches.has(b?.id ?? -1)).toBe(false);
    expect(patches.get(a?.id ?? -1)).toBe('A 수정');
  });
});

describe('editor · 폴더 연결이 문서 자리를 되찾는다', () => {
  it('옛 경로가 없으면 새 폴더에 실제로 있는 꼬리 경로로 옮긴다', async () => {
    // 이름만 남기면 deck/slides/index.html 을 deck 폴더에 연결했을 때 slides/ 가
    // 사라져, 문서 옆의 자원을 전부 못 찾는다 (spec §5.1).
    const text =
      '<html><head><link rel="stylesheet" href="style.css"></head><body><p>본문</p></body></html>';
    useEditor.setState({
      file: { name: 'index.html', text, handle: null, path: 'deck/slides/index.html' },
    });
    pickerReturns(
      fakeTree('deck', { slides: { 'index.html': text, 'style.css': 'p{color:red}' } })
    );

    await useEditor.getState().linkFolder();

    // 되찾은 자리는 자원을 찾는 기준(docDir)으로만 쓴다. 같은 파일임을 증명하지
    // 못했으므로 묶음 경로(docPath)로는 삼지 않는다 (spec §5.1).
    expect(useEditor.getState().docDir).toBe('slides');
    expect(useEditor.getState().docPath).toBe('');
    expect(useEditor.getState().notice).toEqual({
      key: 'notice.assetsLinked',
      params: { count: 1 },
    });
  });
});

describe('editor · 겹친 갈아 끼우기는 나중에 시작한 쪽이 이긴다 (spec §5)', () => {
  /** text() 가 release 를 부를 때까지 멈춰 있는 폴더 — 흐름의 완료 순서를 손에 쥔다 */
  function gatedFolder(tag: string) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const html = `<html><body><p>${tag}</p><img src="pic.png"></body></html>`;
    const files = new Map<string, unknown>([
      [
        'index.html',
        {
          text: async () => {
            await gate;
            return html;
          },
        },
      ],
      ['pic.png', new Blob(['png'], { type: 'image/png' })],
    ]);
    return {
      read: { files, handles: new Map(), truncated: false } as unknown as FolderRead,
      release,
    };
  }

  /** blob URL 의 생성·회수를 기록한다 — 누가 무엇을 놓아줬는지 봐야 한다 */
  function trackUrls() {
    let at = 0;
    const created: string[] = [];
    const revoked: string[] = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => {
        const url = `blob:${++at}`;
        created.push(url);
        return url;
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    });
    return { created, revoked };
  }

  it('옛 흐름이 뒤늦게 끝나도 새 문서를 덮지 않고, 새 문서의 blob 도 놓지 않는다', async () => {
    // 표(doc)는 설치될 때 바뀌므로 겹친 둘은 같은 표를 들고 시작한다 — 그걸로 가리면
    // 뒤늦게 끝난 옛 흐름이 새 문서의 blob 을 놓아 버리고 제 상태를 덮어쓴다.
    const { created, revoked } = trackUrls();
    try {
      const first = gatedFolder('첫 폴더');
      const second = gatedFolder('둘째 폴더');
      const opening1 = useEditor.getState().loadFolder(first.read);
      const opening2 = useEditor.getState().loadFolder(second.read);

      second.release();
      await opening2;
      const installed = useReplacement.getState().installed;
      // 첫 폴더의 읽기는 아직 멈춰 있다 — 지금까지 만든 URL 은 전부 둘째 폴더의 것이다.
      const secondUrls = [...created];
      first.release();
      await opening1;

      expect(useEditor.getState().source).toContain('둘째 폴더');
      // 옛 흐름은 설치하지 않는다 — 설치 세대도 그대로다.
      expect(useReplacement.getState().installed).toBe(installed);
      // 옛 흐름은 제가 만든 것만 놓아준다 — 화면이 쓰는 둘째 폴더의 blob 은 살아 있다.
      const firstUrls = created.filter((url) => !secondUrls.includes(url));
      expect(firstUrls.length).toBeGreaterThan(0);
      expect(firstUrls.every((url) => revoked.includes(url))).toBe(true);
      expect(secondUrls.some((url) => revoked.includes(url))).toBe(false);
      expect(useReplacement.getState().replacing).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('옛 흐름이 먼저 끝나도 설치하지 않는다 — 마지막에 놓은 폴더가 열린다', async () => {
    trackUrls();
    try {
      const first = gatedFolder('첫 폴더');
      const second = gatedFolder('둘째 폴더');
      const opening1 = useEditor.getState().loadFolder(first.read);
      const opening2 = useEditor.getState().loadFolder(second.read);

      first.release();
      await opening1;
      // 사용자의 마지막 선택은 둘째 폴더다 — 먼저 끝났다고 첫 폴더를 세우면 안 된다.
      expect(useEditor.getState().source).not.toContain('첫 폴더');
      // 물러난 흐름이 화면 잠금을 풀면, 아직 읽는 중인데 편집이 들어온다.
      expect(useReplacement.getState().replacing).toBe(true);

      second.release();
      await opening2;

      expect(useEditor.getState().source).toContain('둘째 폴더');
      expect(useReplacement.getState().replacing).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('editor · 드롭은 놓은 순간 예약된다 (spec §5 · 갈아 끼우기 예약)', () => {
  const page = (body: string): FolderRead => ({
    files: new Map([
      ['index.html', new File([`<html><body><p>${body}</p></body></html>`], 'index.html')],
    ]),
    handles: new Map(),
    truncated: false,
  });

  it('먼저 놓은 폴더의 훑기가 늦게 끝나도 나중에 놓은 폴더를 덮지 않는다', async () => {
    // 예약을 훑기 뒤에 받으면, 먼저 놓았지만 늦게 훑힌 폴더가 더 새 예약을 받아
    // 사용자의 마지막 선택(나중에 놓은 폴더)을 덮는다.
    let releaseScan!: (read: FolderRead) => void;
    const slowScan = new Promise<FolderRead | null>((r) => (releaseScan = r));
    const first = useEditor.getState().openDropped(undefined, slowScan);

    await useEditor.getState().openDropped(undefined, Promise.resolve(page('둘째 폴더')));
    expect(useEditor.getState().source).toContain('둘째 폴더');
    const installed = useReplacement.getState().installed;

    releaseScan(page('첫 폴더'));
    await first;

    expect(useEditor.getState().source).toContain('둘째 폴더');
    expect(useReplacement.getState().installed).toBe(installed);
    expect(useReplacement.getState().replacing).toBe(false);
  });

  it('물음에 답하고 훑기를 기다리는 동안 화면이 잠긴다', async () => {
    // 답한 뒤에도 훑기가 도는 사이 화면에는 이전 문서가 떠 있다 — 이때의 편집은
    // 설치 순간 갈 곳이 없어, 잠그고 들어온 확정은 거절한다 (spec §4).
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null && !b.rcdata);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    let releaseScan!: (read: FolderRead) => void;
    const slowScan = new Promise<FolderRead | null>((r) => (releaseScan = r));
    const opening = useEditor.getState().openDropped(undefined, slowScan);
    await answerWith('discard');
    // 답이 keepEdits 를 지나 잠금이 서기까지 마이크로태스크를 흘려보낸다.
    for (let tries = 0; !useReplacement.getState().replacing && tries < 1000; tries++) {
      await Promise.resolve();
    }
    expect(useReplacement.getState().replacing).toBe(true);

    useEditor.getState().onEdit(target?.id ?? -1, '사라질 편집');
    expect(useEditor.getState().patches.get(target?.id ?? -1)).toBe('고친 값');
    expect(useToasts.getState().toasts.some((t) => t.notice.key === 'app.editWhileReplacing')).toBe(
      true
    );

    releaseScan(page('새 폴더'));
    await opening;
    expect(useEditor.getState().source).toContain('새 폴더');
    expect(useReplacement.getState().replacing).toBe(false);
  });
});

describe('editor · 물음에 저장으로 답한 순간부터 잠긴다 (spec §4)', () => {
  it('저장이 파일을 쓰는 사이의 편집도 거절하고 알린다', async () => {
    // 이 저장은 갈아 끼우기의 일부다 — 이어질 설치가 상태를 통째로 갈아, 쓰는 사이에
    // 받은 편집은 조용히 사라질 자리다. 홀로 도는 저장(편집이 살아남는 쪽)과 다르다.
    let releaseWrite: (() => void) | undefined;
    const writeGate = new Promise<void>((resolve) => (releaseWrite = resolve));
    const handle = {
      name: 'old.html',
      getFile: () =>
        Promise.resolve(new File(['<p>옛 문서</p>'], 'old.html', { type: 'text/html' })),
      createWritable: () =>
        Promise.resolve({ write: () => writeGate, close: () => Promise.resolve() }),
    };
    await useEditor.getState().adopt({
      name: 'old.html',
      text: '<html><body><p>하나</p><p>둘</p></body></html>',
      handle,
    });
    const [a, b] = useEditor.getState().blocks.filter((x) => x.locked === null && !x.rcdata);
    useEditor.getState().onEdit(a?.id ?? -1, 'A 수정');

    const adopting = useEditor.getState().adopt({
      name: 'new.html',
      text: '<html><body><p>새 문서</p></body></html>',
      handle: null,
    });
    await answerWith('save');
    for (let tries = 0; !useReplacement.getState().replacing && tries < 1000; tries++) {
      await Promise.resolve();
    }
    // 답한 순간부터 잠겨 있다 — 쓰기는 아직 끝나지 않았다.
    expect(useReplacement.getState().replacing).toBe(true);

    useEditor.getState().onEdit(b?.id ?? -1, '사라질 편집');
    expect(useEditor.getState().patches.has(b?.id ?? -1)).toBe(false);
    expect(useToasts.getState().toasts.some((t) => t.notice.key === 'app.editWhileReplacing')).toBe(
      true
    );

    releaseWrite?.();
    await adopting;
    expect(useEditor.getState().file?.name).toBe('new.html');
    expect(useReplacement.getState().replacing).toBe(false);
  });
});

describe('editor · 밀려난 드롭의 훑기 실패는 알리지 않는다 (spec §5)', () => {
  it('남이 세운 문서 위에 "못 열었다" 를 띄우지 않는다', async () => {
    // 취소한 경우의 실패 알림(대원칙 3)은 그대로다 — 취소는 예약을 새로 만들지
    // 않으므로, 알리지 않는 것은 더 새 흐름에 밀려난 드롭의 실패뿐이다.
    let failScan!: (e: Error) => void;
    const slowScan = new Promise<FolderRead | null>((_, reject) => (failScan = reject));
    const first = useEditor.getState().openDropped(undefined, slowScan);

    await useEditor
      .getState()
      .loadDropped(new File(['<html><body><p>둘째</p></body></html>'], 'b.html'));
    expect(useEditor.getState().source).toContain('둘째');

    failScan(new Error('접근 거부'));
    await first;

    expect(useEditor.getState().notice).toBeNull();
  });
});

describe('editor · 저장을 기다리는 사이 시작된 더 새 흐름이 이긴다 (spec §5)', () => {
  it('물음에 저장으로 답한 열기는 저장을 마치고 돌아와도 밀려났으면 물러난다', async () => {
    // 옛 코드는 keepEdits 가 돌아온 **뒤에** 세대를 받아, 먼저 시작한 열기가 더 새
    // 세대를 쥐고 나중에 시작한 드롭의 문서를 덮었다. 예약은 행동의 순간에 받고,
    // 물음에서 돌아오면 최신인지부터 확인한다.
    let releaseWrite: (() => void) | undefined;
    const writeGate = new Promise<void>((resolve) => (releaseWrite = resolve));
    const handle = {
      name: 'old.html',
      getFile: () =>
        Promise.resolve(new File(['<p>옛 문서</p>'], 'old.html', { type: 'text/html' })),
      createWritable: () =>
        Promise.resolve({ write: () => writeGate, close: () => Promise.resolve() }),
    };
    await useEditor.getState().adopt({
      name: 'old.html',
      text: '<html><body><p>옛 문서</p></body></html>',
      handle,
    });
    const target = useEditor.getState().blocks.find((b) => b.locked === null && !b.rcdata);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    // A: 열기 — 물음에 저장으로 답한다. 쓰기는 아직 멈춰 있다.
    const adopting = useEditor.getState().adopt({
      name: 'a.html',
      text: '<html><body><p>A 문서</p></body></html>',
      handle: null,
    });
    await answerWith('save');

    // B: 저장이 도는 사이의 더 새 드롭 — 읽기는 멈춰 있다.
    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => (releaseRead = r));
    const read = {
      files: new Map<string, unknown>([
        [
          'index.html',
          {
            text: async () => {
              await readGate;
              return '<html><body><p>B 문서</p></body></html>';
            },
          },
        ],
      ]),
      handles: new Map(),
      truncated: false,
    } as unknown as FolderRead;
    const opening = useEditor.getState().loadFolder(read);

    // A 의 저장이 B 의 설치보다 먼저 끝난다 — 옛 코드가 지던 바로 그 순서다.
    releaseWrite?.();
    await adopting;

    // A 는 밀려났다 — 설치하지 않고, B 의 잠금도 풀지 않는다.
    expect(useEditor.getState().file?.name).toBe('old.html');
    expect(useReplacement.getState().replacing).toBe(true);

    releaseRead();
    await opening;
    expect(useEditor.getState().source).toContain('B 문서');
    expect(useReplacement.getState().replacing).toBe(false);
  });
});

describe('editor · 물음의 "{count}곳" 은 파일과 다른 블록 수다 (spec §4)', () => {
  it('저장한 패치는 세지 않는다 — 패치는 저장해도 남는다 (INV-1)', async () => {
    await useEditor.getState().loadDropped(dropped());
    const [a, b] = useEditor.getState().blocks.filter((x) => x.locked === null);
    useEditor.getState().onEdit(a?.id ?? -1, '고침 A');
    expect(await useEditor.getState().save()).toBe(true);

    useEditor.getState().onEdit(b?.id ?? -1, '고침 B');

    // 패치는 둘이지만 파일과 다른 곳은 저장하지 않은 한 곳뿐이다.
    expect(useEditor.getState().patches.size).toBe(2);
    expect(unsavedCount(useEditor.getState())).toBe(1);
  });

  it('저장한 편집을 되돌린 자리는 패치가 없어도 한 곳으로 센다', async () => {
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((x) => x.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    expect(await useEditor.getState().save()).toBe(true);

    useEditor.getState().revert(target?.id ?? -1);

    // 패치는 0개지만 파일에는 옛 편집이 남아 있다 — 0곳이라고 말하면 거짓말이다.
    expect(useEditor.getState().patches.size).toBe(0);
    expect(useEditor.getState().unsaved).toBe(true);
    expect(unsavedCount(useEditor.getState())).toBe(1);
  });
});

describe('editor · 대조가 지우는 패치는 조용히 사라지지 않는다 (spec §4)', () => {
  it('뒤늦게 잠긴 블록의 패치는 프리뷰 되돌리기와 알림을 남긴다', async () => {
    // 정상 경로에서는 대조 전에 편집이 열리지 않는다. 그래도 패치가 있었다면
    // 지우기만 하면 화면에는 고친 것이 남아, 화면과 저장본이 갈라진다 (대원칙 3).
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    if (!target) throw new Error('편집 가능한 블록이 필요하다');
    useEditor.getState().onEdit(target.id, '대조 전의 편집');

    // 스크립트가 그 블록의 글자를 바꿔치기한 라이브 텍스트를 흉내 낸다.
    const live = useEditor.getState().blocks.map((b) => ({
      id: b.id,
      text: b.id === target.id ? '스크립트가 바꾼 글자' : b.sourceText,
    }));
    useEditor.getState().onReady(live);

    const s = useEditor.getState();
    expect(s.scanned).toBe(true);
    expect(s.patches.has(target.id)).toBe(false);
    // 프리뷰도 소스 내용으로 함께 되돌아간다.
    expect(s.revertQueue).toContainEqual({ id: target.id, html: target.sourceInner });
    // 그리고 되돌렸다는 사실을 말한다.
    expect(useToasts.getState().toasts.some((t) => t.notice.key === 'app.editsReverted')).toBe(
      true
    );
    // 지운 패치는 저장할 것도 아니다 — 화면·저장본·파일이 전부 같은 상태다.
    expect(s.unsaved).toBe(false);
  });

  it('지울 패치가 없으면 알림도 되돌리기도 없다', async () => {
    await useEditor.getState().loadDropped(dropped());

    useEditor
      .getState()
      .onReady(useEditor.getState().blocks.map((b) => ({ id: b.id, text: b.sourceText })));

    expect(useEditor.getState().revertQueue).toHaveLength(0);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it('대조 전의 클릭은 편집이 열리지 않았다고 말한다', () => {
    useEditor.getState().onNotReady();

    expect(useToasts.getState().toasts.some((t) => t.notice.key === 'app.editBeforeScan')).toBe(
      true
    );
  });
});
