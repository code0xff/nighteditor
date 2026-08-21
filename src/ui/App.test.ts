// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useEditor } from '@/store/editor';
import { App } from './App';

// react 의 act 는 이 표식이 있어야 테스트 환경으로 인정하고 경고 없이 돈다.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  useEditor.setState({ file: null, patches: new Map(), unsaved: false, notice: null });
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

/** 실제 탭 닫기처럼 cancelable 로 보낸다 — 막았는지 봐야 한다 */
function leave(): Event {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e;
}

describe('App · 떠나기 전 확인은 파일과 다른가로 묻는다 (spec §4)', () => {
  it('저장을 마친 뒤에는 패치가 남아 있어도 붙잡지 않는다', () => {
    // 저장해도 patches 는 남는다(INV-1). 그걸로 물으면 저장한 사람까지 나갈 때마다 붙잡는다.
    act(() => {
      root = createRoot(host!);
      root.render(createElement(App));
    });

    act(() => {
      useEditor.setState({ patches: new Map([[0, '고친 값']]), unsaved: false });
    });

    expect(leave().defaultPrevented).toBe(false);
  });

  it('파일에 없는 편집이 있으면 붙잡는다', () => {
    act(() => {
      root = createRoot(host!);
      root.render(createElement(App));
    });

    act(() => {
      useEditor.setState({ patches: new Map([[0, '고친 값']]), unsaved: true });
    });

    expect(leave().defaultPrevented).toBe(true);
  });
});
