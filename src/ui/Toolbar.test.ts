// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useEditor } from '@/store/editor';
import { useReplacement } from '@/store/replacement';
import { Toolbar } from './Toolbar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  useEditor.setState({
    file: { name: 'artifact.html', text: '', handle: null },
    blocks: [],
    patches: new Map(),
    saving: false,
    unsaved: false,
    // 제목 칸은 대조가 끝나야 열린다 (spec §4) — 여기 테스트들은 그 뒤의 세계를 다룬다.
    scanned: true,
  });
  useReplacement.setState({ replacing: false });
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host!);
    root.render(createElement(Toolbar));
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

/** 저장 버튼 — 사본 내려받기는 아이콘뿐이라 글자가 있는 쪽이 저장이다 */
function saveButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((b) =>
    /저장|Save/.test(b.textContent ?? '')
  );
}

describe('Toolbar · 저장 버튼은 파일과 다른가로 잠긴다 (spec §5)', () => {
  it('저장한 뒤에는 패치가 남아 있어도 잠긴다 — 눌리는데 아무 일도 없는 버튼을 두지 않는다', () => {
    // 저장해도 patches 는 남는다(INV-1). 개수로 열어 두면 save() 의 조기 반환과
    // 어긋나, 버튼은 눌리는데 아무 일도 일어나지 않는다.
    act(() => {
      useEditor.setState({ patches: new Map([[0, '고친 값']]), unsaved: false });
    });

    expect(saveButton()?.disabled).toBe(true);
  });

  it('저장한 편집을 되돌리면 패치 0개여도 눌린다 — 파일을 화면과 같게 되쓸 일이 남았다', () => {
    act(() => {
      useEditor.setState({ patches: new Map(), unsaved: true });
    });

    expect(saveButton()?.disabled).toBe(false);
  });
});

describe('Toolbar · 갈아 끼우는 동안은 제목 칸을 잠근다 (spec §4)', () => {
  const title = {
    id: 0,
    tag: 'title',
    innerStart: 0,
    innerEnd: 2,
    sourceInner: '제목',
    sourceText: '제목',
    rcdata: true,
    locked: null,
  };

  /** 제목 칸 — Input 은 이것 하나다 */
  const titleInput = (): HTMLInputElement | null =>
    document.querySelector<HTMLInputElement>('#doc-title');

  it('replacing 동안 잠긴다 — 이 사이의 편집은 새 문서가 서면 사라질 자리다', () => {
    act(() => {
      useEditor.setState({ blocks: [title] });
      useReplacement.setState({ replacing: true });
    });

    expect(titleInput()?.disabled).toBe(true);
  });

  it('저장하는 동안(saving)은 잠기지 않는다 — 그 편집은 살아남는다 (spec §5)', () => {
    act(() => {
      useEditor.setState({ blocks: [title], saving: true });
    });

    expect(titleInput()?.disabled).toBe(false);
  });

  it('대조가 끝나기 전에도 잠긴다 — 스크립트가 제목을 바꾸면 그 패치가 지워진다 (spec §4)', () => {
    act(() => {
      useEditor.setState({ blocks: [title], scanned: false });
    });

    expect(titleInput()?.disabled).toBe(true);
  });
});
