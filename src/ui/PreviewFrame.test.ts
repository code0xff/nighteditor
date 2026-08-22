// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useEditor } from '@/store/editor';
import type { Block } from '@/core/types';
import { useReplacement } from '@/store/replacement';
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
