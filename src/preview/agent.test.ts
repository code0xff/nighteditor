// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewAgent } from './agent.js';
import { DARK_ATTR, LOCKED_ATTR, MARKER_ATTR } from '../core/markers.js';

/** Collects the messages the agent sent to parent */
let sent: Record<string, unknown>[] = [];
let dispose: (() => void) | null = null;

/** The agent only accepts messages sent by the host */
const fromHost = (data: unknown) =>
  window.dispatchEvent(new MessageEvent('message', { data, source: window.parent }));

/**
 * @param verified Whether to mount in the post-verification state. Defaults to
 *   true — editing only opens after the lock list arrives (spec §4), so most
 *   tests deal with the world after it.
 */
function mount(html: string, { verified = true } = {}): void {
  document.body.innerHTML = html;
  sent = [];
  vi.spyOn(window.parent, 'postMessage').mockImplementation(((msg: unknown) => {
    sent.push(msg as Record<string, unknown>);
  }) as typeof window.parent.postMessage);
  dispose = previewAgent();
  // The lock list is the end-of-verification signal. Even an empty one must be
  // sent for editing to open.
  if (verified) fromHost({ type: 'locked', ids: [] });
  sent = [];
}

const el = (id: number) => document.querySelector<HTMLElement>(`[${MARKER_ATTR}="${id}"]`);
/** Sent cancelable like a real browser click — preventDefault must be observable */
const clickEvent = (node: Element): MouseEvent => {
  const e = new MouseEvent('click', { bubbles: true, cancelable: true });
  node.dispatchEvent(e);
  return e;
};
const click = (node: Element) => clickEvent(node);

const keydown = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(e);
  return e;
};

/** The event the browser sends right before applying an actual edit */
const beforeinput = (inputType: string): InputEvent => {
  const e = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e;
};

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

// Listeners stay on document. Left attached, the previous test's agent
// intercepts events with stale state and contaminates the next test.
afterEach(() => {
  dispose?.();
  dispose = null;
});

describe('previewAgent · self-containment constraint (ADR-007)', () => {
  it('uses the same marker name as core', () => {
    // The agent cannot use imports, so it rewrites the constants. Drift is caught here.
    expect(previewAgent.toString()).toContain(MARKER_ATTR);
  });

  it('references no outer scope — it must work even stringified', () => {
    expect(previewAgent.toString()).not.toMatch(/\bimport\b|\brequire\(/);
  });

  it('a function revived from its string works unchanged', () => {
    // Same as the real injection path. Had it closed over an outer value, it
    // would die here. This is exactly the property that survives minification.
    document.body.innerHTML = `<p ${MARKER_ATTR}="0">본문</p>`;
    sent = [];
    vi.spyOn(window.parent, 'postMessage').mockImplementation(((msg: unknown) => {
      sent.push(msg as Record<string, unknown>);
    }) as typeof window.parent.postMessage);

    const revived = new Function(`return (${previewAgent.toString()})`)() as typeof previewAgent;
    dispose = revived();
    // Editing only opens after verification (spec §4) — the revived function
    // must honor the same contract.
    fromHost({ type: 'locked', ids: [] });

    click(el(0)!);
    expect(sent).toContainEqual({ type: 'select', id: 0 });
    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
  });
});

describe('previewAgent · cleanup', () => {
  it('after dispose it no longer intercepts events', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    dispose?.();
    dispose = null;
    const artifact = vi.fn();
    document.addEventListener('click', artifact);

    click(el(0)!);

    expect(artifact).toHaveBeenCalled();
  });
});

describe('previewAgent · event interception', () => {
  it("the artifact's global click handler does not fire", () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    // Artifact scripts sit at the end of body, so they register after the agent.
    const artifact = vi.fn();
    document.addEventListener('click', artifact);

    click(el(0)!);

    expect(artifact).not.toHaveBeenCalled();
    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
  });

  it('outside editing, clicks outside blocks pass through — artifact navigation must stay alive', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p><div id="bg">여백</div>`);
    const artifact = vi.fn();
    document.addEventListener('click', artifact);

    click(document.getElementById('bg')!);

    expect(artifact).toHaveBeenCalled();
  });

  it('while editing, a click outside blocks is consumed as end-of-editing and never leaks to navigation', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p><div id="bg">여백</div>`);
    click(el(0)!);
    const artifact = vi.fn();
    document.addEventListener('click', artifact);

    click(document.getElementById('bg')!);

    expect(artifact).not.toHaveBeenCalled();
    expect(el(0)?.hasAttribute('contenteditable')).toBe(false);
  });

  it('arrow keys never leak to the artifact while editing', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    const artifact = vi.fn();
    document.addEventListener('keydown', artifact);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(artifact).not.toHaveBeenCalled();
  });

  it('outside editing, arrow keys are not blocked — artifact navigation must stay alive', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    const artifact = vi.fn();
    document.addEventListener('keydown', artifact);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(artifact).toHaveBeenCalled();
  });
});

describe('previewAgent · no editing opens before verification (spec §4)', () => {
  it('a click before the lock list arrives sends only notReady', () => {
    // An edit opened now would be erased from the save the moment verification
    // locks that block, splitting the screen from the saved file — open
    // nothing and only report the situation (Principle 3).
    mount(`<p ${MARKER_ATTR}="0">본문</p>`, { verified: false });

    click(el(0)!);

    expect(sent).toContainEqual({ type: 'notReady' });
    expect(sent.find((m) => m.type === 'select')).toBeUndefined();
    expect(el(0)?.hasAttribute('contenteditable')).toBe(false);
  });

  it('editing opens once the lock list arrives', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`, { verified: false });
    click(el(0)!);
    expect(el(0)?.hasAttribute('contenteditable')).toBe(false);

    fromHost({ type: 'locked', ids: [] });
    click(el(0)!);

    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
  });
});

describe('previewAgent · editing flow', () => {
  it('clicking sends select and opens editing', () => {
    mount(`<p ${MARKER_ATTR}="7">본문</p>`);
    click(el(7)!);
    expect(sent).toContainEqual({ type: 'select', id: 7 });
  });

  it('sends the edit result when focus leaves', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    el(0)!.innerHTML = '고친 <b>본문</b>';
    document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    expect(sent).toContainEqual({
      type: 'edit',
      id: 0,
      html: '고친 <b>본문</b>',
      pristine: false,
    });
    expect(el(0)?.hasAttribute('contenteditable')).toBe(false);
  });

  it('a locked block opens no editing and sends blocked (INV-5)', () => {
    mount(`<p ${MARKER_ATTR}="3">코드</p>`);
    fromHost({ type: 'locked', ids: [3] });

    click(el(3)!);

    expect(sent).toContainEqual({ type: 'blocked', id: 3 });
    expect(el(3)?.hasAttribute('contenteditable')).toBe(false);
  });

  it('pressing Escape closes editing', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(el(0)?.hasAttribute('contenteditable')).toBe(false);
  });

  it('a revert message restores the original content', () => {
    mount(`<p ${MARKER_ATTR}="0">고쳐진 값</p>`);
    fromHost({ type: 'revert', id: 0, html: '원래 값' });
    expect(el(0)?.innerHTML).toBe('원래 값');
  });
});

describe('previewAgent · closing editing with Enter', () => {
  it('commits and closes the edit', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    el(0)!.innerHTML = '고친 본문';

    keydown('Enter');

    expect(sent).toContainEqual({ type: 'edit', id: 0, html: '고친 본문', pristine: false });
    expect(el(0)?.hasAttribute('contenteditable')).toBe(false);
  });

  it('never leaks to the artifact and inserts no line break', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    const artifact = vi.fn();
    document.addEventListener('keydown', artifact);

    const e = keydown('Enter');

    expect(artifact).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it('a mid-composition Enter does not close editing — it is the Hangul finalize key', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));

    const e = keydown('Enter');

    // Blocking the finalization would make characters impossible to complete,
    // so the default stays alive.
    expect(e.defaultPrevented).toBe(false);
    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
    expect(sent.some((m) => m.type === 'edit')).toBe(false);
  });

  it('the line break a mid-composition Enter would leave is blocked at the input stage', () => {
    // The browser handles finalization and the line break together. The key
    // cannot be blocked, so block the input. Missed, a <div> appears inside <p>
    // and untouched structure ships in the patch.
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    keydown('Enter');

    expect(beforeinput('insertParagraph').defaultPrevented).toBe(true);
  });

  it('outside editing, line break input is left alone', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);

    expect(beforeinput('insertParagraph').defaultPrevented).toBe(false);
  });

  it('Shift+Enter does not close editing and inserts a line break inside the block', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);

    const e = keydown('Enter', { shiftKey: true });

    // The default must stay alive for the browser to insert the <br>.
    expect(e.defaultPrevented).toBe(false);
    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
    expect(sent.some((m) => m.type === 'edit')).toBe(false);
    expect(beforeinput('insertLineBreak').defaultPrevented).toBe(false);
  });

  it('outside editing, Enter is handed to the artifact', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    const artifact = vi.fn();
    document.addEventListener('keydown', artifact);

    const e = keydown('Enter');

    expect(artifact).toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('previewAgent · lock marks', () => {
  it('marks the blocks the host reported locked — the style watches this to display them', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p><p ${MARKER_ATTR}="1">코드</p>`);

    fromHost({ type: 'locked', ids: [1] });

    expect(el(0)?.hasAttribute(LOCKED_ATTR)).toBe(false);
    expect(el(1)?.hasAttribute(LOCKED_ATTR)).toBe(true);
  });

  it('clears previous marks when the list changes — an unlocked block must not pose as locked', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p><p ${MARKER_ATTR}="1">코드</p>`);

    fromHost({ type: 'locked', ids: [0, 1] });
    fromHost({ type: 'locked', ids: [1] });

    expect(el(0)?.hasAttribute(LOCKED_ATTR)).toBe(false);
    expect(el(1)?.hasAttribute(LOCKED_ATTR)).toBe(true);
  });

  it('uses the same lock mark name as core', () => {
    // The agent cannot load modules, so it rewrites the constants. Drift is caught here.
    expect(previewAgent.toString()).toContain(LOCKED_ATTR);
  });
});

describe('previewAgent · Ctrl+S', () => {
  const ctrlS = (init = {}) => {
    const e = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    document.dispatchEvent(e);
    return e;
  };

  it('while editing, commits first and then asks to save — what was just edited must not be missing', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    el(0)!.innerHTML = '고친 본문';

    ctrlS();

    expect(sent).toContainEqual({ type: 'edit', id: 0, html: '고친 본문', pristine: false });
    expect(sent).toContainEqual({ type: 'save' });
    expect(sent.findIndex((m) => m.type === 'edit')).toBeLessThan(
      sent.findIndex((m) => m.type === 'save')
    );
  });

  it('asks to save even outside editing', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);

    ctrlS();

    expect(sent).toContainEqual({ type: 'save' });
  });

  it('blocks the browser page-save and does not hand the key to the artifact', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    const artifact = vi.fn();
    document.addEventListener('keydown', artifact);

    const e = ctrlS();

    expect(e.defaultPrevented).toBe(true);
    expect(artifact).not.toHaveBeenCalled();
  });

  it('does not save mid-composition — the character is not finalized yet', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));

    const e = ctrlS();

    expect(sent.some((m) => m.type === 'save')).toBe(false);
    // Even with the save deferred, the browser dialog must not appear.
    expect(e.defaultPrevented).toBe(true);
  });

  it('Ctrl+Shift+S goes to download-copy — it must diverge from save', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    el(0)!.innerHTML = '고친 본문';

    const e = ctrlS({ shiftKey: true });

    expect(sent).toContainEqual({ type: 'downloadCopy' });
    expect(sent.some((m) => m.type === 'save')).toBe(false);
    // The copy too must go out only after the open edit is committed.
    expect(sent).toContainEqual({ type: 'edit', id: 0, html: '고친 본문', pristine: false });
    expect(e.defaultPrevented).toBe(true);
  });
});

describe('previewAgent · Ctrl+Z', () => {
  const ctrlZ = () => {
    const e = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(e);
    return e;
  };

  it('outside editing, asks for an undo', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);

    const e = ctrlZ();

    expect(sent).toContainEqual({ type: 'undo' });
    expect(e.defaultPrevented).toBe(true);
  });

  it('hands off while editing — native undo reverses in-block typing', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);

    const e = ctrlZ();

    expect(sent.some((m) => m.type === 'undo')).toBe(false);
    expect(e.defaultPrevented).toBe(false);
    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
  });
});

describe('previewAgent · click defaults', () => {
  it('clicking a link inside a block does not navigate the document', () => {
    mount(`<p ${MARKER_ATTR}="0">본문 <a href="#next">링크</a></p>`);

    const e = clickEvent(document.querySelector('a')!);

    expect(e.defaultPrevented).toBe(true);
    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
  });

  it('the outside-block click that closes editing also blocks the default', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p><a id="nav" href="#next">이동</a>`);
    click(el(0)!);

    const e = clickEvent(document.getElementById('nav')!);

    expect(e.defaultPrevented).toBe(true);
    expect(el(0)?.hasAttribute('contenteditable')).toBe(false);
  });

  it('outside editing, defaults are not blocked — artifact links must stay alive', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p><a id="nav" href="#next">이동</a>`);

    const e = clickEvent(document.getElementById('nav')!);

    expect(e.defaultPrevented).toBe(false);
  });
});

describe('previewAgent · IME (Hangul composition)', () => {
  it('never commits mid-composition — the jamo break apart', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    expect(sent.filter((m) => m.type === 'edit')).toHaveLength(0);
  });

  it('commits once composition ends', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el(0)!.innerHTML = '한글';
    document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    expect(sent).toContainEqual({ type: 'edit', id: 0, html: '한글', pristine: false });
  });
});

describe('previewAgent · lock display', () => {
  it('marks locked blocks', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    fromHost({ type: 'locked', ids: [0] });

    expect(el(0)?.hasAttribute(LOCKED_ATTR)).toBe(true);
  });

  it('does not paint elements that show nothing on screen', () => {
    // Covering even CSS-drawn bars in a forbidden cursor makes the whole
    // document look uneditable.
    mount(`<div ${MARKER_ATTR}="0" class="bar"></div>`);
    fromHost({ type: 'locked', ids: [0] });

    expect(el(0)?.hasAttribute(LOCKED_ATTR)).toBe(false);
  });

  it('unpainted blocks stay locked — clicking still shows the reason', () => {
    mount(`<div ${MARKER_ATTR}="0" class="bar"></div>`);
    fromHost({ type: 'locked', ids: [0] });

    click(el(0)!);

    expect(sent).toContainEqual({ type: 'blocked', id: 0 });
    expect(el(0)?.hasAttribute('contenteditable')).toBe(false);
  });
});

describe('previewAgent · matching mark colors', () => {
  const scan = async (): Promise<void> => {
    window.dispatchEvent(new Event('load'));
    await new Promise((r) => setTimeout(r, 0));
  };

  it('marks a block on a dark background', async () => {
    mount(`<div style="background-color:rgb(16,16,20)"><p ${MARKER_ATTR}="0">본문</p></div>`);
    await scan();

    // The block itself is transparent — the color actually behind it must be
    // found by walking up.
    expect(el(0)?.hasAttribute(DARK_ATTR)).toBe(true);
  });

  it('does not mark a block on a light background', async () => {
    mount(`<div style="background-color:rgb(255,255,255)"><p ${MARKER_ATTR}="0">본문</p></div>`);
    await scan();

    expect(el(0)?.hasAttribute(DARK_ATTR)).toBe(false);
  });

  it('judges each block separately within one document', async () => {
    // A light card on a dark page. One verdict per document would hide the
    // blocks inside the card.
    mount(
      `<div style="background-color:rgb(16,16,20)">` +
        `<p ${MARKER_ATTR}="0">바탕 위</p>` +
        `<div style="background-color:rgb(255,255,255)"><p ${MARKER_ATTR}="1">카드 안</p></div>` +
        `</div>`
    );
    await scan();

    expect(el(0)?.hasAttribute(DARK_ATTR)).toBe(true);
    expect(el(1)?.hasAttribute(DARK_ATTR)).toBe(false);
  });
});

describe('previewAgent · post-render verification (ADR-005)', () => {
  it('reports the live text of every marked element', async () => {
    mount(`<p ${MARKER_ATTR}="0">가</p><span ${MARKER_ATTR}="1">나</span>`);
    window.dispatchEvent(new Event('load'));
    await new Promise((r) => setTimeout(r, 0));

    expect(sent).toContainEqual({
      type: 'ready',
      blocks: [
        { id: 0, text: '가' },
        { id: 1, text: '나' },
      ],
    });
  });

  it('follows markers even when a script reshapes the DOM (ADR-003)', async () => {
    mount(`<section ${MARKER_ATTR}="9">원본</section>`);
    // The wrapSheets() situation — children moved into a new wrapper
    const wrapper = document.createElement('div');
    const moved = el(9)!;
    document.body.appendChild(wrapper);
    wrapper.appendChild(moved);

    window.dispatchEvent(new Event('load'));
    await new Promise((r) => setTimeout(r, 0));

    expect(sent).toContainEqual({ type: 'ready', blocks: [{ id: 9, text: '원본' }] });
  });

  it('a mimic marker inside a block is left out of the report — it is content, not a block (spec §3)', async () => {
    // snapshotMarkers filters mimics; if the report alone shipped the clash,
    // the host's verification would see the same id twice and lock the healthy
    // outer block as MARKER_CLASH.
    mount(`<p ${MARKER_ATTR}="0">본문 <span ${MARKER_ATTR}="0">흉내</span></p>`);

    window.dispatchEvent(new Event('load'));
    await new Promise((r) => setTimeout(r, 0));

    // The mimic's text still ships as part of the outer block's content.
    expect(sent).toContainEqual({ type: 'ready', blocks: [{ id: 0, text: '본문 흉내' }] });
  });
});

describe('previewAgent · review regressions', () => {
  it('Escape restores the content from before editing opened', () => {
    mount(`<p ${MARKER_ATTR}="0">원래 내용</p>`);
    click(el(0)!);
    el(0)!.innerHTML = '고친 내용';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(el(0)?.innerHTML).toBe('원래 내용');
    // Sending blocked for something that is not even locked makes the host
    // show "not editable — null".
    expect(sent.filter((m) => m.type === 'blocked')).toHaveLength(0);
  });

  it('leaving without editing reports pristine', () => {
    // Source strings and browser serialization can differ (<br/> → <br>).
    // If the host compared against the source, untouched blocks would grow patches.
    mount(`<p ${MARKER_ATTR}="0">건드리지 않음</p>`);
    click(el(0)!);
    document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    const edit = sent.find((m) => m.type === 'edit');
    expect(edit?.pristine).toBe(true);
  });

  it('losing focus mid-composition does not lose the edit', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el(0)!.innerHTML = '한글 입력';
    // The situation of clicking outside the iframe (host toolbar) with
    // composition still open
    document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(sent.filter((m) => m.type === 'edit')).toHaveLength(0);

    document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));

    expect(sent).toContainEqual({ type: 'edit', id: 0, html: '한글 입력', pristine: false });
  });

  it('ignores messages not from the host', () => {
    mount(`<p ${MARKER_ATTR}="3">본문</p>`);
    fromHost({ type: 'locked', ids: [3] });
    // A third party tries to empty the locks
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'locked', ids: [] } }));

    click(el(3)!);

    expect(sent).toContainEqual({ type: 'blocked', id: 3 });
    expect(el(3)?.hasAttribute('contenteditable')).toBe(false);
  });

  it('does not die on a null message', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    expect(() => fromHost(null)).not.toThrow();
  });
});

describe('previewAgent · revealing a picked block', () => {
  it('takes the user there and highlights briefly', async () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    const into = vi.fn();
    el(0)!.scrollIntoView = into;

    fromHost({ type: 'reveal', id: 0 });

    expect(into).toHaveBeenCalledOnce();
    // Scrolling alone does not say which block it was.
    expect(el(0)?.hasAttribute('data-ne-revealed')).toBe(true);
  });

  it('the highlight clears itself', async () => {
    vi.useFakeTimers();
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    el(0)!.scrollIntoView = vi.fn();

    fromHost({ type: 'reveal', id: 0 });
    vi.advanceTimersByTime(2000);

    expect(el(0)?.hasAttribute('data-ne-revealed')).toBe(false);
    vi.useRealTimers();
  });

  it('does not die on a reveal for a block that does not exist', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);

    expect(() => fromHost({ type: 'reveal', id: 99 })).not.toThrow();
  });
});

describe('previewAgent · inline formatting (spec §4.1)', () => {
  // happy-dom has no execCommand. The actual editing is the browser's job, so
  // here we only check **what is called, in which mode**.
  beforeEach(() => {
    document.execCommand = (() => true) as typeof document.execCommand;
  });

  /** Select part of the text inside a block */
  function select(id: number, from: number, to: number): void {
    const node = el(id)?.firstChild;
    if (!node) throw new Error('고를 글자가 없다');
    const range = document.createRange();
    range.setStart(node, from);
    range.setEnd(node, to);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }

  it('the bar appears over selected text and disappears when nothing is selected', () => {
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);

    select(0, 1, 4);
    const bar = document.querySelector<HTMLElement>('[data-ne-bar]');
    expect(bar?.style.display).toBe('flex');

    getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    expect(bar?.style.display).toBe('none');
  });

  it('does not show the bar outside editing', () => {
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);

    select(0, 1, 4);

    expect(document.querySelector<HTMLElement>('[data-ne-bar]')?.style.display ?? 'none').toBe(
      'none'
    );
  });

  it('a click on the bar does not close editing', () => {
    // Counting it as an outside-block click would end editing the moment a
    // formatting button is pressed.
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);
    select(0, 1, 4);

    const button = document.querySelector('[data-ne-bar] button');
    click(button!);

    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
    expect(sent.some((m) => m.type === 'edit')).toBe(false);
  });

  it('bold, italic, underline come out as tags; color and size as style', () => {
    // Once <font> creeps in, the whole paragraph becomes uneditable the next
    // time this file is opened.
    const modes: [string, boolean][] = [];
    document.execCommand = ((command: string, _ui: boolean, value: string) => {
      if (command === 'styleWithCSS') modes.push(['pending', value === 'true']);
      else if (modes.length > 0) modes[modes.length - 1]![0] = command;
      return true;
    }) as typeof document.execCommand;

    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);
    select(0, 1, 4);
    const buttons = [...document.querySelectorAll('[data-ne-bar] button')];
    for (const button of buttons) click(button);

    expect(modes.filter(([c]) => c === 'bold' || c === 'italic' || c === 'underline')).toEqual([
      ['bold', false],
      ['italic', false],
      ['underline', false],
    ]);
    expect(modes.filter(([c]) => c === 'foreColor').every(([, css]) => css)).toBe(true);
    expect(modes.filter(([c]) => c === 'fontSize').every(([, css]) => css)).toBe(true);
  });

  it('Ctrl+B · I · U never leak to the artifact', () => {
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);
    const artifact = vi.fn();
    document.addEventListener('keydown', artifact);

    const e = keydown('b', { ctrlKey: true });

    expect(e.defaultPrevented).toBe(true);
    expect(artifact).not.toHaveBeenCalled();
  });

  it('bar labels come from the host — the agent knows no language pack', () => {
    // Hardcoding one language here would freeze that language in. Screen text
    // has one source: the language pack (spec §1).
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);
    select(0, 1, 4);

    fromHost({ type: 'labels', labels: { 'format.bold': 'Bold' } });

    const bold = document.querySelector('[data-ne-label="format.bold"]');
    expect(bold?.getAttribute('title')).toBe('Bold');
  });

  it('labels stay empty until they arrive — no language is baked in', () => {
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);
    select(0, 1, 4);

    const titles = [...document.querySelectorAll('[data-ne-label]')].map((b) =>
      b.getAttribute('title')
    );

    expect(titles.every((title) => title === '')).toBe(true);
  });

  it('changing the language changes a bar already on screen', () => {
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);
    select(0, 1, 4);
    fromHost({ type: 'labels', labels: { 'format.bold': 'Bold' } });

    fromHost({ type: 'labels', labels: { 'format.bold': '굵게' } });

    expect(document.querySelector('[data-ne-label="format.bold"]')?.getAttribute('title')).toBe(
      '굵게'
    );
  });

  it('the palette holds only colors this document uses for text', () => {
    // Handing out our own colors overrides the document's palette. Bringing in
    // a color it never had is not fixing — it is redesigning.
    mount(
      `<h1 ${MARKER_ATTR}="0" style="color: rgb(94, 201, 138)">제목</h1>` +
        `<p ${MARKER_ATTR}="1" style="color: rgb(233, 233, 236)">가나다라마바사</p>`
    );
    click(el(1)!);
    select(1, 1, 4);

    const dots = [...document.querySelectorAll<HTMLElement>('[data-ne-bar] button')].filter(
      (b) => b.style.borderRadius === '50%'
    );

    expect(dots.map((d) => d.style.backgroundColor).sort()).toEqual([
      'rgb(233, 233, 236)',
      'rgb(94, 201, 138)',
    ]);
  });

  it('colors that look the same are folded into one', () => {
    // Different computed values that cannot be told apart in a 12px dot are
    // not a real choice.
    mount(
      `<p ${MARKER_ATTR}="0" style="color: rgb(233, 233, 236)">가나다라마바사</p>` +
        `<p ${MARKER_ATTR}="1" style="color: rgb(231, 231, 234)">거의 같은 색</p>` +
        `<p ${MARKER_ATTR}="2" style="color: rgb(94, 201, 138)">다른 색</p>`
    );
    click(el(0)!);
    select(0, 1, 4);

    const dots = [...document.querySelectorAll<HTMLElement>('[data-ne-bar] button')].filter(
      (b) => b.style.borderRadius === '50%'
    );

    expect(dots).toHaveLength(2);
  });

  it('color dots do not get squashed', () => {
    // The base button style is all:unset, so display is inline and side
    // padding remains. Left that way, width/height would not apply and the dot
    // becomes a sideways-stretched oval.
    mount(`<p ${MARKER_ATTR}="0" style="color: rgb(0, 0, 0)">가나다라마바사</p>`);
    click(el(0)!);
    select(0, 1, 4);

    const dot = [...document.querySelectorAll<HTMLElement>('[data-ne-bar] button')].find(
      (b) => b.style.borderRadius === '50%'
    );

    expect(dot?.style.display).toBe('block');
    expect(dot?.style.padding).toBe('0px');
    expect(dot?.style.width).toBe(dot?.style.height);
  });

  it('closing the edit hides the bar too', () => {
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p><div id="bg">여백</div>`);
    click(el(0)!);
    select(0, 1, 4);

    click(document.getElementById('bg')!);

    expect(document.querySelector<HTMLElement>('[data-ne-bar]')?.style.display).toBe('none');
  });
});

describe('previewAgent · formatting never reaches beyond the block being edited (spec §4.1)', () => {
  beforeEach(() => {
    document.execCommand = (() => true) as typeof document.execCommand;
  });

  /** Make a selection spanning two blocks */
  function selectAcross(): void {
    const range = document.createRange();
    range.setStart(el(0)!.firstChild!, 1);
    range.setEnd(el(1)!.firstChild!, 2);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }

  it('no bar appears for a selection spanning into a neighbor block', () => {
    // Checking only the start would float the bar over a spanning selection,
    // changing untracked neighbors too (Principle 2).
    mount(`<p ${MARKER_ATTR}="0">가나다라</p><p ${MARKER_ATTR}="1">마바사아</p>`);
    click(el(0)!);

    selectAcross();

    expect(document.querySelector<HTMLElement>('[data-ne-bar]')?.style.display ?? 'none').toBe(
      'none'
    );
  });

  it('Ctrl+B does not apply to a selection spanning into a neighbor block either', () => {
    const commands: string[] = [];
    document.execCommand = ((command: string) => {
      commands.push(command);
      return true;
    }) as typeof document.execCommand;
    mount(`<p ${MARKER_ATTR}="0">가나다라</p><p ${MARKER_ATTR}="1">마바사아</p>`);
    click(el(0)!);
    selectAcross();

    keydown('b', { ctrlKey: true });

    expect(commands).not.toContain('bold');
  });
});

describe('previewAgent · the lifetime of the held formatting range (spec §4.1)', () => {
  /** Captures what was selected at the moment bold was applied */
  let selectedAtBold: string | null;

  beforeEach(() => {
    selectedAtBold = null;
    document.execCommand = ((command: string) => {
      if (command === 'bold') selectedAtBold = getSelection()?.toString() ?? '';
      return true;
    }) as typeof document.execCommand;
  });

  function select(from: number, to: number): void {
    const node = el(0)!.firstChild!;
    const range = document.createRange();
    range.setStart(node, from);
    range.setEnd(node, to);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }

  it('moving the caret away from the selection drops the old range', () => {
    // Kept, the next Ctrl+B would land on the old text, not the current spot.
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);
    select(1, 4);

    // Move leaving only a caret — the selection was abandoned.
    const caret = document.createRange();
    caret.setStart(el(0)!.firstChild!, 6);
    caret.collapse(true);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(caret);
    document.dispatchEvent(new Event('selectionchange'));

    keydown('b', { ctrlKey: true });

    expect(selectedAtBold).toBe('');
  });

  it('a selection that collapsed while pressing the bar is revived right before the command', () => {
    // Dropping even this case would defeat the bar's purpose — no formatting
    // could ever apply to a selection that collapses during the press.
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);
    select(1, 4);

    const button = document.querySelector('[data-ne-bar] button')!;
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    // The browser may drop the selection at this moment.
    getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    click(button);

    expect(selectedAtBold).toBe('나다라');
  });

  it('a tap on the bar holds the selection too — the emulated mouse events may never come', () => {
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);
    select(1, 4);

    const button = document.querySelector('[data-ne-bar] button')!;
    button.dispatchEvent(new Event('touchstart', { bubbles: true }));
    // A tap collapses the selection on the way in.
    getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    // The touch ends on the bar, so the hold stays — its click has not run yet.
    button.dispatchEvent(new Event('touchend', { bubbles: true }));
    click(button);

    expect(selectedAtBold).toBe('나다라');
  });

  it('a touch that ends anywhere else lets the selection go', () => {
    // Held forever, the next Ctrl+B would land on text the user left behind.
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p><p ${MARKER_ATTR}="1">아자차카</p>`);
    click(el(0)!);
    select(1, 4);

    document
      .querySelector('[data-ne-bar] button')!
      .dispatchEvent(new Event('touchstart', { bubbles: true }));
    el(1)!.dispatchEvent(new Event('touchend', { bubbles: true }));
    // The tap leaves a caret behind, the way tapping elsewhere does.
    const caret = document.createRange();
    caret.setStart(el(0)!.firstChild!, 6);
    caret.collapse(true);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(caret);
    document.dispatchEvent(new Event('selectionchange'));

    keydown('b', { ctrlKey: true });

    expect(selectedAtBold).toBe('');
  });
});

describe('previewAgent · brightness of translucent backgrounds (spec §4 · visual marks)', () => {
  const scan = async (): Promise<void> => {
    window.dispatchEvent(new Event('load'));
    await new Promise((r) => setTimeout(r, 0));
  };

  it('faint black on a white page is a light background', async () => {
    // Reading only the color value of rgba(0,0,0,.1) would wrongly call it
    // dark and drown the mark in the background.
    mount(
      `<div style="background-color:rgb(255,255,255)">` +
        `<div style="background-color:rgba(0,0,0,0.1)"><p ${MARKER_ATTR}="0">본문</p></div>` +
        `</div>`
    );
    await scan();

    expect(el(0)?.hasAttribute(DARK_ATTR)).toBe(false);
  });

  it('faint white on a dark page is still a dark background', async () => {
    mount(
      `<div style="background-color:rgb(16,16,20)">` +
        `<div style="background-color:rgba(255,255,255,0.1)"><p ${MARKER_ATTR}="0">본문</p></div>` +
        `</div>`
    );
    await scan();

    expect(el(0)?.hasAttribute(DARK_ATTR)).toBe(true);
  });
});

describe('previewAgent · the formatting bar never ships in the save (INV-9)', () => {
  beforeEach(() => {
    document.execCommand = (() => true) as typeof document.execCommand;
  });

  // body with only text and no element children is itself a block (spec §2).
  // mount() puts markup **inside** body, so here the marker goes on body itself.
  function mountBodyBlock(): void {
    document.body.innerHTML = '';
    document.body.textContent = '가나다라마바사';
    document.body.setAttribute(MARKER_ATTR, '0');
    sent = [];
    vi.spyOn(window.parent, 'postMessage').mockImplementation(((msg: unknown) => {
      sent.push(msg as Record<string, unknown>);
    }) as typeof window.parent.postMessage);
    dispose = previewAgent();
    // Editing only opens after verification (spec §4) — the lock list is that signal.
    fromHost({ type: 'locked', ids: [] });
  }

  function selectBodyText(): void {
    const node = document.body.firstChild;
    if (!node) throw new Error('고를 글자가 없다');
    const range = document.createRange();
    range.setStart(node, 1);
    range.setEnd(node, 4);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }

  afterEach(() => {
    // Remove it so the next test's outside-block click check does not catch
    // the body marker.
    document.body.removeAttribute(MARKER_ATTR);
    // Release any focus lingering on body. Left there, the next test's focus()
    // fires focusout synchronously and commits the just-opened edit on the spot.
    (document.activeElement as HTMLElement | null)?.blur?.();
  });

  it('even when <body> itself is a block, the bar never lands inside the block', () => {
    mountBodyBlock();
    click(document.body);
    selectBodyText();

    const bar = document.querySelector<HTMLElement>('[data-ne-bar]');
    expect(bar?.style.display).toBe('flex');
    // Attached to body, this block's innerHTML would carry the editor buttons wholesale.
    expect(document.body.contains(bar)).toBe(false);
  });

  it('the innerHTML an Enter commit sends contains no bar', () => {
    mountBodyBlock();
    click(document.body);
    selectBodyText();

    keydown('Enter');

    const edit = sent.find((m) => m.type === 'edit');
    expect(edit).toBeDefined();
    expect(String(edit?.html)).toBe('가나다라마바사');
    expect(String(edit?.html)).not.toContain('data-ne-bar');
  });

  it('even with the bar moved inside the block, it is removed before the commit', () => {
    // Artifact scripts reshape the DOM (the wrapSheets pattern). Committing
    // with the bar dragged inside the block would ship editor UI in the save —
    // this checks the last line of defense.
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);
    const node = el(0)!.firstChild!;
    const range = document.createRange();
    range.setStart(node, 1);
    range.setEnd(node, 4);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    const bar = document.querySelector<HTMLElement>('[data-ne-bar]');
    bar!.remove();
    el(0)!.appendChild(bar!);
    keydown('Enter');

    const edit = sent.find((m) => m.type === 'edit');
    expect(String(edit?.html)).not.toContain('data-ne-bar');
    expect(String(edit?.html)).toBe('가나다라마바사');
  });

  it('even with the bar moved inside the block, cancel does not kill the bar', () => {
    // Escape restores innerHTML from the snapshot. Restoring with the bar
    // inside the block detaches it from the DOM while the reference survives,
    // so from the next selection on it is neither rebuilt nor re-attached —
    // formatting is gone for the rest of the session.
    const selectText = () => {
      const node = el(0)!.firstChild!;
      const range = document.createRange();
      range.setStart(node, 1);
      range.setEnd(node, 4);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    };
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);
    selectText();

    const bar = document.querySelector<HTMLElement>('[data-ne-bar]')!;
    bar.remove();
    el(0)!.appendChild(bar);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // The bar is alive, and the restored block contains no bar.
    expect(document.documentElement.contains(bar)).toBe(true);
    expect(el(0)!.innerHTML).toBe('가나다라마바사');

    // Editing again and selecting text brings that same bar back up.
    click(el(0)!);
    selectText();
    expect(bar.style.display).toBe('flex');
  });
});

describe('previewAgent · resizing screens by the selected range (spec §4.1)', () => {
  /** Select a range within a single text node */
  function selectIn(node: Node, from: number, to: number): void {
    const range = document.createRange();
    range.setStart(node, from);
    range.setEnd(node, to);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }

  const sizeButton = (label: string): Element => {
    const button = [...document.querySelectorAll('[data-ne-bar] button')].find(
      (b) => b.textContent === label
    );
    if (!button) throw new Error('크기 버튼이 없다');
    return button;
  };

  it('what the command made turns into a multiplier; the original spot with the same value stays', () => {
    // Like the browser: the fontSize command wraps the selected range in an
    // xxx-large span.
    document.execCommand = ((command: string) => {
      if (command === 'fontSize') {
        const range = getSelection()!.getRangeAt(0);
        const span = document.createElement('span');
        span.style.fontSize = 'xxx-large';
        span.appendChild(range.extractContents());
        range.insertNode(span);
        const after = document.createRange();
        after.selectNodeContents(span);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(after);
      }
      return true;
    }) as typeof document.execCommand;
    mount(
      `<p ${MARKER_ATTR}="0">가나다라마바사<span id="orig" style="font-size: xxx-large">크게</span></p>`
    );
    click(el(0)!);
    selectIn(el(0)!.firstChild!, 1, 4);

    click(sizeButton('A+'));

    const made = el(0)!.querySelector<HTMLElement>('span:not(#orig)');
    expect(made?.textContent).toBe('나다라');
    expect(made?.style.fontSize).toBe('1.35em');
    // The unselected spot where the original used the same value stays (Principle 2).
    expect(el(0)!.querySelector<HTMLElement>('#orig')?.style.fontSize).toBe('xxx-large');
  });

  it('when the selected range itself is already that value — the command makes nothing — the multiplier is still written', () => {
    // The browser changes nothing when fontSize is applied to a range already
    // at that size. Screening by value ("what was already that value before
    // the command") makes A-/A+ a no-op in this case.
    document.execCommand = (() => true) as typeof document.execCommand;
    mount(
      `<p ${MARKER_ATTR}="0"><span id="big" style="font-size: xxx-large">가나다</span>라마</p>`
    );
    click(el(0)!);
    selectIn(document.getElementById('big')!.firstChild!, 0, 3);

    click(sizeButton('A-'));

    expect(document.getElementById('big')?.style.fontSize).toBe('0.85em');
    expect(el(0)!.textContent).toBe('가나다라마');
    // Nothing appears on the unselected text.
    expect(el(0)!.querySelectorAll('span').length).toBe(1);
  });

  it('selecting only part of an already-sized spot splits it and changes just the selection', () => {
    document.execCommand = (() => true) as typeof document.execCommand;
    mount(
      `<p ${MARKER_ATTR}="0"><span style="font-size: xxx-large; color: rgb(1, 2, 3)">가나다라마</span></p>`
    );
    click(el(0)!);
    selectIn(el(0)!.querySelector('span')!.firstChild!, 1, 4);

    click(sizeButton('A-'));

    const spans = [...el(0)!.querySelectorAll<HTMLElement>('span')];
    expect(el(0)!.textContent).toBe('가나다라마');
    expect(spans.map((s) => s.style.fontSize)).toEqual(['xxx-large', '0.85em', 'xxx-large']);
    expect(spans[1]?.textContent).toBe('나다라');
    // The look (color) is inherited — the user asked for size only.
    expect(spans.map((s) => s.style.color)).toEqual([
      'rgb(1, 2, 3)',
      'rgb(1, 2, 3)',
      'rgb(1, 2, 3)',
    ]);
  });

  it('splitting keeps a comment before the selection — what the user wrote must not vanish (Principles 1·2)', () => {
    // When only a comment precedes the selected range, an emptiness check
    // measured by textContent alone deletes the host, and a comment the user
    // never selected vanishes from the save.
    document.execCommand = (() => true) as typeof document.execCommand;
    mount(
      `<p ${MARKER_ATTR}="0"><span style="font-size: xxx-large"><!--메모-->가나다마</span></p>`
    );
    click(el(0)!);
    const text = el(0)!.querySelector('span')!.lastChild!;
    selectIn(text, 0, 3);

    click(sizeButton('A-'));

    expect(el(0)!.innerHTML).toContain('<!--메모-->');
    expect(el(0)!.textContent).toBe('가나다마');
  });

  it('splitting keeps a comment after the selection too', () => {
    document.execCommand = (() => true) as typeof document.execCommand;
    mount(`<p ${MARKER_ATTR}="0"><span style="font-size: xxx-large">가나다<!--끝--></span></p>`);
    click(el(0)!);
    const text = el(0)!.querySelector('span')!.firstChild!;
    selectIn(text, 1, 3);

    click(sizeButton('A-'));

    expect(el(0)!.innerHTML).toContain('<!--끝-->');
    expect(el(0)!.textContent).toBe('가나다');
  });
});

describe('previewAgent · the palette sweeps body itself too (spec §4.1)', () => {
  beforeEach(() => {
    document.execCommand = (() => true) as typeof document.execCommand;
  });

  afterEach(() => {
    document.body.removeAttribute(MARKER_ATTR);
    document.body.removeAttribute('style');
    (document.activeElement as HTMLElement | null)?.blur?.();
  });

  it('colors show up even when the text sits right under <body> and the color is on body', () => {
    // Sweeping descendants only (querySelectorAll('*')) skips body and leaves
    // no color dots at all.
    document.body.innerHTML = '';
    document.body.textContent = '가나다라마바사';
    document.body.setAttribute(MARKER_ATTR, '0');
    document.body.style.color = 'rgb(12, 34, 56)';
    sent = [];
    vi.spyOn(window.parent, 'postMessage').mockImplementation(((msg: unknown) => {
      sent.push(msg as Record<string, unknown>);
    }) as typeof window.parent.postMessage);
    dispose = previewAgent();
    fromHost({ type: 'locked', ids: [] });

    click(document.body);
    const node = document.body.firstChild!;
    const range = document.createRange();
    range.setStart(node, 1);
    range.setEnd(node, 4);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    const dots = [...document.querySelectorAll<HTMLElement>('[data-ne-bar] button')].filter(
      (b) => b.style.borderRadius === '50%'
    );
    expect(dots.map((d) => d.style.backgroundColor)).toContain('rgb(12, 34, 56)');
  });
});

describe('previewAgent · the document token (spec §5)', () => {
  it('once given a token, attaches it to every message — the host must be able to screen out old previews', () => {
    document.body.innerHTML = `<p ${MARKER_ATTR}="0">본문</p>`;
    sent = [];
    vi.spyOn(window.parent, 'postMessage').mockImplementation(((msg: unknown) => {
      sent.push(msg as Record<string, unknown>);
    }) as typeof window.parent.postMessage);
    dispose = previewAgent('doc-7');
    fromHost({ type: 'locked', ids: [] });
    sent = [];

    click(el(0)!);

    expect(sent).toContainEqual({ type: 'select', id: 0, token: 'doc-7' });
  });

  it('called without a token, sends messages as they are', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    expect(sent).toContainEqual({ type: 'select', id: 0 });
  });
});

describe('previewAgent · when the document mimics our marks (spec §3)', () => {
  it('a block inside a mimicked data-ne-bar still opens for editing — compared against our bar, not the attribute', () => {
    // Filtering by closest('[data-ne-bar]') would swallow every click on this
    // block as a bar click, and the blocks inside could never be edited.
    mount(`<div data-ne-bar=""><p ${MARKER_ATTR}="0">본문</p></div>`);

    click(el(0)!);

    expect(sent).toContainEqual({ type: 'select', id: 0 });
    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
  });

  it('focus escaping into a mimicked data-ne-bar still commits', () => {
    // Filtering by attribute would skip the commit and leave the edit open
    // with neither commit nor cancel.
    mount(`<div data-ne-bar=""><p ${MARKER_ATTR}="0">본문</p><button id="decoy">x</button></div>`);
    click(el(0)!);
    sent = [];

    el(0)!.dispatchEvent(
      new FocusEvent('focusout', {
        bubbles: true,
        relatedTarget: document.getElementById('decoy'),
      })
    );

    expect(sent.some((m) => m.type === 'edit' && m.id === 0)).toBe(true);
  });

  it('a marker missing from the roster (all) is not a block — no editing opens', () => {
    // If editing opened on the impostor, its commit would belong to no block
    // and vanish silently.
    mount(`<div ${MARKER_ATTR}="99">가짜</div><p ${MARKER_ATTR}="0">본문</p>`, {
      verified: false,
    });
    fromHost({ type: 'locked', ids: [], all: [0] });
    sent = [];
    const fake = document.querySelector(`[${MARKER_ATTR}="99"]`)!;

    click(fake);

    expect(fake.getAttribute('contenteditable')).toBeNull();
    expect(sent.filter((m) => m.type === 'select' || m.type === 'edit')).toHaveLength(0);

    // The real block opens as usual.
    click(el(0)!);
    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
  });

  it('an element inserted after verification with the same number is not a block (spec §3)', () => {
    // The roster screens numbers only — a script that makes an element with
    // the same number after verification passes the number check. Clicking
    // that impostor and committing would save the impostor's content into the
    // real block's slot, so no editing opens on anything but the element
    // captured at verification.
    mount(`<p ${MARKER_ATTR}="0">진짜</p>`, { verified: false });
    const real = el(0)!;
    fromHost({ type: 'locked', ids: [], all: [0] });
    sent = [];
    const fake = document.createElement('p');
    fake.setAttribute(MARKER_ATTR, '0');
    fake.textContent = '가짜';
    document.body.prepend(fake);

    click(fake);

    expect(fake.getAttribute('contenteditable')).toBeNull();
    expect(sent.filter((m) => m.type === 'select' || m.type === 'edit')).toHaveLength(0);

    // The real block opens as usual — an impostor earlier in the document
    // cannot push it out.
    click(real);
    expect(real.getAttribute('contenteditable')).toBe('true');
    expect(fake.getAttribute('contenteditable')).toBeNull();
  });

  it('revert reaches the element captured at verification, not the mimic earlier in the document (spec §3)', () => {
    mount(`<p ${MARKER_ATTR}="0">원래</p>`, { verified: false });
    const real = el(0)!;
    fromHost({ type: 'locked', ids: [], all: [0] });
    const fake = document.createElement('p');
    fake.setAttribute(MARKER_ATTR, '0');
    fake.textContent = '가짜';
    document.body.prepend(fake);

    fromHost({ type: 'revert', id: 0, html: '되돌림' });

    // Re-finding by querySelector would catch the impostor first, leaving the
    // real block edited.
    expect(real.innerHTML).toBe('되돌림');
    expect(fake.innerHTML).toBe('가짜');
  });

  it('a mimic marker inside a block is content — the click flows to the real block outside', () => {
    mount(`<p ${MARKER_ATTR}="0">본문 <span ${MARKER_ATTR}="99">가짜</span></p>`, {
      verified: false,
    });
    fromHost({ type: 'locked', ids: [], all: [0] });
    const fake = document.querySelector(`[${MARKER_ATTR}="99"]`)!;

    click(fake);

    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
    expect(fake.getAttribute('contenteditable')).toBeNull();
  });

  it('commits read from the element editing opened on — a late-arriving mimic cannot hijack it', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(document.querySelector(`p[${MARKER_ATTR}="0"]`)!);
    // An artifact script inserts a marker with the same id at the front of the
    // document mid-edit — re-finding by id makes querySelector return this
    // impostor first.
    document.body.insertAdjacentHTML('afterbegin', `<div ${MARKER_ATTR}="0">가짜</div>`);
    sent = [];

    keydown('Enter');

    const edit = sent.find((m) => m.type === 'edit');
    expect(String(edit?.html)).toBe('본문');
  });

  it('a clashing id goes to the lock notice whichever element is clicked — nothing leaks to the artifact', () => {
    // With the impostor earlier in the document, a scan keeping only the first
    // element remembers the impostor — the real element's click fails the
    // "that element" check and flows to the artifact handler with no blocked
    // notice at all.
    mount(`<div ${MARKER_ATTR}="0">가짜</div><p ${MARKER_ATTR}="0">진짜</p>`, {
      verified: false,
    });
    // The host's verification locks clashing ids as MARKER_CLASH (spec §3).
    fromHost({ type: 'locked', ids: [0], all: [0] });
    const artifact = vi.fn();
    document.addEventListener('click', artifact);
    sent = [];

    click(document.querySelector(`p[${MARKER_ATTR}="0"]`)!);

    expect(sent).toContainEqual({ type: 'blocked', id: 0 });
    expect(artifact).not.toHaveBeenCalled();
    // The lock mark is painted on every clashing element too — with only the
    // real one bare, it would look editable.
    expect(document.querySelector(`p[${MARKER_ATTR}="0"]`)!.hasAttribute(LOCKED_ATTR)).toBe(true);
  });

  it('a mimic inside a block gets no lock mark — it would ride the content into the save', () => {
    // Removing the data-ne-locked a mimic brought along would ride that change
    // in the outer block's innerHTML, changing the save the moment that block
    // is edited (INV-9).
    mount(`<p ${MARKER_ATTR}="0">본문 <span ${MARKER_ATTR}="7" ${LOCKED_ATTR}="">가짜</span></p>`, {
      verified: false,
    });
    fromHost({ type: 'locked', ids: [], all: [0] });

    const fake = document.querySelector(`[${MARKER_ATTR}="7"]`)!;
    expect(fake.hasAttribute(LOCKED_ATTR)).toBe(true);
    // The real block's mark is managed as usual — not locked, so absent.
    expect(el(0)?.hasAttribute(LOCKED_ATTR)).toBe(false);
  });
});

describe('previewAgent · flush — commit the open edit now (spec §4)', () => {
  it('while editing, sends the commit (edit) first and replies flushed', () => {
    // The host leans on this order to judge unsaved — if flushed went first,
    // the prompt would run before the commit lands and the edit would vanish
    // silently.
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    el(0)!.innerHTML = '고친 본문';
    sent = [];

    fromHost({ type: 'flush', seq: 7 });

    const editAt = sent.findIndex((m) => m.type === 'edit');
    const flushedAt = sent.findIndex((m) => m.type === 'flushed');
    expect(sent[editAt]).toMatchObject({ type: 'edit', id: 0, html: '고친 본문' });
    expect(sent[flushedAt]).toMatchObject({ type: 'flushed', seq: 7 });
    expect(editAt).toBeLessThan(flushedAt);
    // The edit is closed — no contenteditable may remain.
    expect(el(0)!.hasAttribute('contenteditable')).toBe(false);
  });

  it('replies flushed even outside editing — the requester must not wait out the timeout', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);

    fromHost({ type: 'flush', seq: 3 });

    expect(sent).toEqual([{ type: 'flushed', seq: 3 }]);
  });

  it('mid-composition, defers the reply and answers after the deferred commit goes out', () => {
    // The reply means "every pending commit has been sent" (spec §4). Replying
    // first with the commit deferred makes the host assume it is current and
    // swap the document, losing the characters being composed.
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el(0)!.innerHTML = '조합하던 본문';
    sent = [];

    fromHost({ type: 'flush', seq: 11 });
    // Neither commit nor reply yet — mid-composition innerHTML is never read.
    expect(sent).toEqual([]);

    document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));

    const editAt = sent.findIndex((m) => m.type === 'edit');
    const flushedAt = sent.findIndex((m) => m.type === 'flushed');
    expect(sent[editAt]).toMatchObject({ type: 'edit', id: 0, html: '조합하던 본문' });
    expect(sent[flushedAt]).toMatchObject({ type: 'flushed', seq: 11 });
    expect(editAt).toBeLessThan(flushedAt);
  });

  it('the deferred reply also goes out when the edit is dropped (Escape) — nothing is left to send', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el(0)!.innerHTML = '조합하던 본문';
    sent = [];

    fromHost({ type: 'flush', seq: 12 });
    keydown('Escape');

    // A dropped edit has no commit — only the reply goes out, no edit, and the
    // content returns to what it was before editing opened.
    expect(sent.find((m) => m.type === 'edit')).toBeUndefined();
    expect(sent).toContainEqual({ type: 'flushed', seq: 12 });
    expect(el(0)!.innerHTML).toBe('본문');
  });
});
