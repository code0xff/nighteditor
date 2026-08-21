// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Block } from '@/core/types';
import { useEditor } from '@/store/editor';
import { useReplacement } from '@/store/replacement';
import { ChangeList } from './ChangeList';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

/** 편집된 블록 하나가 목록에 뜬 상태 */
const block: Block = {
  id: 0,
  tag: 'p',
  innerStart: 0,
  innerEnd: 2,
  sourceInner: '본문',
  sourceText: '본문',
  rcdata: false,
  locked: null,
};

beforeEach(() => {
  useEditor.setState({ blocks: [block], patches: new Map([[0, '고친 값']]), scanned: true });
  useReplacement.setState({ replacing: false });
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host!);
    root.render(createElement(ChangeList));
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

/** 되돌리기류 버튼 — 카드 이동(reveal)은 버튼이 아니라 role=button 카드다 */
function revertButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter((b) =>
    /되돌리기|Revert/.test(b.textContent ?? '')
  );
}

describe('ChangeList · 갈아 끼우는 동안은 되돌리기를 잠근다 (spec §4)', () => {
  it('replacing 동안 되돌리기·전체 되돌리기가 눌리지 않는다', () => {
    // 목록이 보여주는 것은 아직 이전 문서다 — 여기서 되돌린 것은 새 문서가
    // 서는 순간 갈 곳이 없다. 잠금의 근거는 예약 상태 하나다 (ADR-010).
    act(() => {
      useReplacement.setState({ replacing: true });
    });

    const buttons = revertButtons();
    expect(buttons.length).toBeGreaterThan(1); // 개별 + 전체
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });

  it('끝나면 다시 눌린다', () => {
    act(() => {
      useReplacement.setState({ replacing: true });
    });
    act(() => {
      useReplacement.setState({ replacing: false });
    });

    expect(revertButtons().every((b) => !b.disabled)).toBe(true);
  });
});
