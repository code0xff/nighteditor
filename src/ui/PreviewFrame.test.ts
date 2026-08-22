// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useEditor } from '@/store/editor';
import type { Block } from '@/core/types';
import { useReplacement } from '@/store/replacement';
import { FLUSH_TIMEOUT, flushPreviewEdits } from '@/store/unsaved';
import { PreviewFrame } from './PreviewFrame';

// react 의 act 는 이 표식이 있어야 테스트 환경으로 인정하고 경고 없이 돈다.
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

// 나중에 등록한 afterEach 가 먼저 돈다 — 위의 unmount 는 실제 타이머로 돌아야 한다.
afterEach(() => {
  vi.useRealTimers();
});

describe('PreviewFrame · 서식 문구는 에이전트가 준비된 뒤에 다시 보낸다 (spec §4.1)', () => {
  it('대조가 끝나면(ready) 문구를 다시 보낸다', () => {
    // 문서가 갈린 직후의 전송은 새 iframe 이 에이전트를 실행하기 전이라 사라질 수 있다.
    // ready 뒤의 재전송이 없으면 첫 막대가 빈 제목으로 뜬다.
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

describe('PreviewFrame · 갈아 끼우는 동안은 프리뷰를 잠근다 (spec §4)', () => {
  it('replacing 동안 클릭이 닿지 않고, 끝나면 되살아난다', () => {
    // 이 사이 화면에 뜬 것은 아직 이전 문서다 — 여기서 시작한 편집은 새 문서가
    // 서는 순간 사라질 자리라, 시작 자체를 막는다.
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

describe('PreviewFrame · 갈아탄 뒤 도착한 옛 프리뷰의 메시지는 버린다 (spec §5)', () => {
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

  it('표가 다른 ready 는 대조를 세우지 못한다', () => {
    // iframe 은 재사용되어 srcDoc 을 갈아도 contentWindow 신원이 그대로다 — 출처
    // 검사만으로는 옛 문서의 메시지를 못 가린다. 블록 id 는 문서마다 0부터 다시
    // 시작하므로, 옛 ready 를 받으면 옛 문서의 잠금이 새 문서에 적힌다.
    useEditor.setState({ previewToken: 'doc-2' });
    const frame = mountFrame();

    arrive(frame, { type: 'ready', blocks: [], token: 'doc-1' });
    expect(useEditor.getState().scanned).toBe(false);

    arrive(frame, { type: 'ready', blocks: [], token: 'doc-2' });
    expect(useEditor.getState().scanned).toBe(true);
  });

  it('표가 다른 edit 는 패치가 되지 못한다', () => {
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

describe('PreviewFrame · 프리뷰 확정 청 (spec §4)', () => {
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

  it('iframe 에 flush 를 청하고, 지금 문서의 flushed 가 와야 풀린다', async () => {
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

    // 옛 프리뷰의 답은 표 검사가 걸러낸다 — 새 청을 풀면 안 된다 (spec §5).
    arrive(frame, { type: 'flushed', seq: flush?.seq, token: 'doc-1' });
    await act(async () => {});
    expect(done).toBe(false);

    arrive(frame, { type: 'flushed', seq: flush?.seq, token: 'doc-2' });
    await pending;
    expect(done).toBe(true);
  });

  it('답이 오면 그 청의 한도 타이머도 함께 걷는다', async () => {
    // 대기 항목의 수명은 settle 하나로 끝난다 — 답이 왔는데 타이머가 남으면
    // 항목 정리가 두 갈래가 되고, 한 갈래만 고치는 회귀가 스며든다.
    vi.useFakeTimers();
    useEditor.setState({ previewToken: 'doc-2' });
    const frame = mountFrame();
    const posted: { type?: string; seq?: number }[] = [];
    vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(((msg: unknown) => {
      posted.push(msg as { type?: string; seq?: number });
    }) as typeof window.postMessage);

    const before = vi.getTimerCount();
    const pending = flushPreviewEdits();
    // 청 하나에 타이머 둘 — 항목의 한도와 청한 쪽(flushPreviewEdits)의 한도.
    expect(vi.getTimerCount()).toBe(before + 2);

    const flush = posted.find((m) => m.type === 'flush');
    arrive(frame, { type: 'flushed', seq: flush?.seq, token: 'doc-2' });
    await pending;

    // 항목의 타이머는 답이 걷었다 — 남은 하나는 청한 쪽의 race 다.
    expect(vi.getTimerCount()).toBe(before + 1);
  });

  it('한도가 지난 대기는 목록에 남지 않는다 — 늦은 답이 와도 아무 일 없다', async () => {
    // 답 없는 프리뷰 앞에서 갈아 끼우기를 거듭 시도하면, 시간이 다 된 대기가
    // 목록에 남아 화면이 내려갈 때까지 쌓인다 — 항목 스스로 한도에 정리해야 한다.
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
    // 모든 타이머가 정리됐다 — 대기 항목의 한도가 발동해 항목도 함께 지웠다.
    expect(vi.getTimerCount()).toBe(0);

    // 정리된 청의 늦은 답은 조용히 지나간다 — 죽은 항목을 되살리거나 던지지 않는다.
    for (const m of posted) {
      if (m.type === 'flush') arrive(frame, { type: 'flushed', seq: m.seq, token: 'doc-2' });
    }
  });

  it('화면이 내려가면 기다리던 청을 푼다 — 답을 전달할 길이 없다', async () => {
    useEditor.setState({ previewToken: 'doc-2' });
    const frame = mountFrame();
    vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation((() => {
      /* 답 없는 프리뷰 */
    }) as typeof window.postMessage);

    const pending = flushPreviewEdits();
    act(() => root?.unmount());
    root = null;

    // 한도(1초)를 기다리지 않고 바로 풀린다 — 여기서 멈추면 테스트가 그 증거다.
    await pending;
  });
});
