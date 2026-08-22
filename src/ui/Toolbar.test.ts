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
    // The title field only opens after verification (spec §4) — these tests live in the world after it.
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

/** The save button — download-copy is icon-only, so the one with text is save */
function saveButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((b) =>
    /저장|Save/.test(b.textContent ?? '')
  );
}

describe('Toolbar · the save button locks on "differs from the file" (spec §5)', () => {
  it('locks after a save even with patches remaining — no button that presses but does nothing', () => {
    // Patches survive a save (INV-1). Enabling by count diverges from save()'s
    // early return: the button presses and nothing happens.
    act(() => {
      useEditor.setState({ patches: new Map([[0, '고친 값']]), unsaved: false });
    });

    expect(saveButton()?.disabled).toBe(true);
  });

  it('reverting a saved edit makes it pressable even at zero patches — the file still needs rewriting to match the screen', () => {
    act(() => {
      useEditor.setState({ patches: new Map(), unsaved: true });
    });

    expect(saveButton()?.disabled).toBe(false);
  });
});

describe('Toolbar · the title field locks during replacement (spec §4)', () => {
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

  /** The title field — the only Input there is */
  const titleInput = (): HTMLInputElement | null =>
    document.querySelector<HTMLInputElement>('#doc-title');

  it('locks while replacing — an edit made in between has nowhere to go once the new document stands', () => {
    act(() => {
      useEditor.setState({ blocks: [title] });
      useReplacement.setState({ replacing: true });
    });

    expect(titleInput()?.disabled).toBe(true);
  });

  it('does not lock while saving — those edits survive (spec §5)', () => {
    act(() => {
      useEditor.setState({ blocks: [title], saving: true });
    });

    expect(titleInput()?.disabled).toBe(false);
  });

  it('locks before verification ends too — if a script changes the title, that patch gets erased (spec §4)', () => {
    act(() => {
      useEditor.setState({ blocks: [title], scanned: false });
    });

    expect(titleInput()?.disabled).toBe(true);
  });
});

describe('Toolbar · the header row is one height (spec §4 · ADR-013)', () => {
  it('every control carries the row height, and a taller step for a fingertip', () => {
    // The save button used to be one size smaller than its neighbours and sat
    // 4px low. What that costs is not obvious in the markup, so assert it here:
    // whatever a control is for, in this row it is the same height as the rest.
    const controls = [...document.querySelectorAll('header button, header a')];
    expect(controls.length).toBeGreaterThan(3);

    for (const control of controls) {
      expect(control.className).toMatch(/(^|\s)h-8(\s|$)/);
      expect(control.className).toMatch(/(^|\s)touch:h-10(\s|$)/);
    }
  });
});
