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

/** State with one edited block showing in the list */
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

/** The revert-style buttons — the card jump (reveal) is a role=button card, not a button */
function revertButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter((b) =>
    /되돌리기|Revert/.test(b.textContent ?? '')
  );
}

describe('ChangeList · revert is locked during replacement (spec §4)', () => {
  it('revert and revert-all cannot be pressed while replacing', () => {
    // What the list shows is still the previous document — a revert made here
    // has nowhere to go the moment the new document stands. The lock's basis
    // is the single reservation state (ADR-010).
    act(() => {
      useReplacement.setState({ replacing: true });
    });

    const buttons = revertButtons();
    expect(buttons.length).toBeGreaterThan(1); // individual + all
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });

  it('becomes pressable again when it ends', () => {
    act(() => {
      useReplacement.setState({ replacing: true });
    });
    act(() => {
      useReplacement.setState({ replacing: false });
    });

    expect(revertButtons().every((b) => !b.disabled)).toBe(true);
  });
});
