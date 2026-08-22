// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useEditor } from '@/store/editor';
import type { Block } from '@/core/types';
import { useReplacement } from '@/store/replacement';
import { FLUSH_TIMEOUT, flushPreviewEdits } from '@/store/unsaved';
import { PreviewFrame } from './PreviewFrame';

// React's act only accepts this as a test environment, and runs without warnings, when this flag is set.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  useEditor.setState({
    previewDoc: '<html><body><p data-ne-id="0">본문</p></body></html>',
    blocks: [],
    scanned: false,
  });
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

// The later-registered afterEach runs first — the unmount above must run on real timers.
afterEach(() => {
  vi.useRealTimers();
});

describe('PreviewFrame · formatting labels are resent once the agent is ready (spec §4.1)', () => {
  it('resends the labels when verification ends (ready)', () => {
    // A send right after the document switches can vanish — the new iframe has
    // not run the agent yet. Without the resend after ready, the first bar
    // shows up with empty titles.
    act(() => {
      root = createRoot(host!);
      root.render(createElement(PreviewFrame));
    });
    const frame = host!.querySelector('iframe');
    if (!frame?.contentWindow) throw new Error('iframe 이 그려지지 않았다');
    const posted: unknown[] = [];
    vi.spyOn(frame.contentWindow, 'postMessage').mockImplementation(((msg: unknown) => {
      posted.push(msg);
    }) as typeof frame.contentWindow.postMessage);

    act(() => {
      useEditor.setState({ scanned: true });
    });

    const labels = posted.find((m) => (m as { type?: string }).type === 'labels') as
      { labels?: Record<string, string> } | undefined;
    expect(labels).toBeDefined();
    expect(labels?.labels?.['format.bold']).toBeTruthy();
  });
});

describe('PreviewFrame · the preview locks during replacement (spec §4)', () => {
  it('clicks cannot reach it while replacing, and it revives when that ends', () => {
    // What is on screen in between is still the previous document — an edit
    // started here would vanish the moment the new document stands, so even
    // starting one is blocked.
    act(() => {
      root = createRoot(host!);
      root.render(createElement(PreviewFrame));
    });

    act(() => {
      useReplacement.setState({ replacing: true });
    });
    expect(host!.querySelector('iframe')?.classList.contains('pointer-events-none')).toBe(true);

    act(() => {
      useReplacement.setState({ replacing: false });
    });
    expect(host!.querySelector('iframe')?.classList.contains('pointer-events-none')).toBe(false);
  });
});

describe('PreviewFrame · messages from the old preview arriving after a switch are dropped (spec §5)', () => {
  function mountFrame(): HTMLIFrameElement {
    act(() => {
      root = createRoot(host!);
      root.render(createElement(PreviewFrame));
    });
    const frame = host!.querySelector('iframe');
    if (!frame?.contentWindow) throw new Error('iframe 이 그려지지 않았다');
    return frame;
  }

  const arrive = (frame: HTMLIFrameElement, data: unknown) =>
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow }));
    });

  it('a ready with the wrong token cannot establish verification', () => {
    // The iframe is reused; swapping srcDoc keeps the contentWindow identity —
    // the source check alone cannot screen out the old document's messages.
    // Block ids restart at 0 in every document, so accepting an old ready
    // writes the old document's locks onto the new one.
    useEditor.setState({ previewToken: 'doc-2' });
    const frame = mountFrame();

    arrive(frame, { type: 'ready', blocks: [], token: 'doc-1' });
    expect(useEditor.getState().scanned).toBe(false);

    arrive(frame, { type: 'ready', blocks: [], token: 'doc-2' });
    expect(useEditor.getState().scanned).toBe(true);
  });

  it('an edit with the wrong token cannot become a patch', () => {
    useEditor.setState({
      previewToken: 'doc-2',
      blocks: [
        {
          id: 0,
          tag: 'p',
          sourceInner: '원래',
          sourceText: '원래',
          innerStart: 0,
          innerEnd: 2,
          locked: null,
          rcdata: false,
        } as unknown as Block,
      ],
      patches: new Map(),
    });
    const frame = mountFrame();

    arrive(frame, { type: 'edit', id: 0, html: '옛 문서의 내용', pristine: false, token: 'doc-1' });
    expect(useEditor.getState().patches.size).toBe(0);

    arrive(frame, {
      type: 'edit',
      id: 0,
      html: '지금 문서의 내용',
      pristine: false,
      token: 'doc-2',
    });
    expect(useEditor.getState().patches.get(0)).toBe('지금 문서의 내용');
  });
});

describe('PreviewFrame · preview flush requests (spec §4)', () => {
  function mountFrame(): HTMLIFrameElement {
    act(() => {
      root = createRoot(host!);
      root.render(createElement(PreviewFrame));
    });
    const frame = host!.querySelector('iframe');
    if (!frame?.contentWindow) throw new Error('iframe 이 그려지지 않았다');
    return frame;
  }

  const arrive = (frame: HTMLIFrameElement, data: unknown) =>
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow }));
    });

  it("requests a flush from the iframe and only resolves on the current document's flushed", async () => {
    useEditor.setState({ previewToken: 'doc-2' });
    const frame = mountFrame();
    const posted: { type?: string; seq?: number }[] = [];
    vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(((msg: unknown) => {
      posted.push(msg as { type?: string; seq?: number });
    }) as typeof window.postMessage);

    let done = false;
    const pending = flushPreviewEdits().then(() => {
      done = true;
    });
    const flush = posted.find((m) => m.type === 'flush');
    expect(flush?.seq).toBeTypeOf('number');

    // The old preview's reply is filtered by the token check — it must not release the new request (spec §5).
    arrive(frame, { type: 'flushed', seq: flush?.seq, token: 'doc-1' });
    await act(async () => {});
    expect(done).toBe(false);

    arrive(frame, { type: 'flushed', seq: flush?.seq, token: 'doc-2' });
    await pending;
    expect(done).toBe(true);
  });

  it("a reply also clears that request's timeout timer", async () => {
    // A waiter's lifetime ends through settle alone — a timer surviving the
    // reply splits entry cleanup into two paths, and regressions creep in
    // through fixes that touch only one.
    vi.useFakeTimers();
    useEditor.setState({ previewToken: 'doc-2' });
    const frame = mountFrame();
    const posted: { type?: string; seq?: number }[] = [];
    vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(((msg: unknown) => {
      posted.push(msg as { type?: string; seq?: number });
    }) as typeof window.postMessage);

    const before = vi.getTimerCount();
    const pending = flushPreviewEdits();
    // Two timers per request — the entry's timeout and the requester's (flushPreviewEdits).
    expect(vi.getTimerCount()).toBe(before + 2);

    const flush = posted.find((m) => m.type === 'flush');
    arrive(frame, { type: 'flushed', seq: flush?.seq, token: 'doc-2' });
    await pending;

    // The reply cleared the entry's timer — the one left is the requester's race.
    expect(vi.getTimerCount()).toBe(before + 1);
  });

  it('a timed-out waiter does not linger in the map — a late reply changes nothing', async () => {
    // Retrying replacement against an unresponsive preview would leave
    // timed-out waiters in the map, piling up until unmount — each entry must
    // clean itself up on timeout.
    vi.useFakeTimers();
    useEditor.setState({ previewToken: 'doc-2' });
    const frame = mountFrame();
    const posted: { type?: string; seq?: number }[] = [];
    vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(((msg: unknown) => {
      posted.push(msg as { type?: string; seq?: number });
    }) as typeof window.postMessage);

    const first = flushPreviewEdits();
    const second = flushPreviewEdits();
    await vi.advanceTimersByTimeAsync(FLUSH_TIMEOUT);
    await first;
    await second;
    // Every timer is cleaned up — the entry's timeout fired and removed the entry with it.
    expect(vi.getTimerCount()).toBe(0);

    // A late reply to a cleaned-up request passes quietly — it neither revives a dead entry nor throws.
    for (const m of posted) {
      if (m.type === 'flush') arrive(frame, { type: 'flushed', seq: m.seq, token: 'doc-2' });
    }
  });

  it('unmounting releases waiting requests — there is no way left to deliver a reply', async () => {
    useEditor.setState({ previewToken: 'doc-2' });
    const frame = mountFrame();
    vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation((() => {
      /* an unresponsive preview */
    }) as typeof window.postMessage);

    const pending = flushPreviewEdits();
    act(() => root?.unmount());
    root = null;

    // Resolves right away without waiting out the timeout (1s) — hanging here is the test's evidence.
    await pending;
  });
});
