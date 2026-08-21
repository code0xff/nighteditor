// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useEditor } from '@/store/editor';
import { useUnsaved } from '@/store/unsaved';
import { App } from './App';

// react 의 act 는 이 표식이 있어야 테스트 환경으로 인정하고 경고 없이 돈다.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  useEditor.setState({ file: null, patches: new Map(), unsaved: false, notice: null });
  useUnsaved.setState({ why: null, answer: null });
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

describe('App · 물음이 떠 있는 동안의 Ctrl+S (spec §4)', () => {
  it('저장만 하고 물음을 남기지 않는다 — 물음의 "저장하고 계속" 으로 답한다', () => {
    // 저장만 하면 unsaved 가 풀린 채 물음이 남고, 그 뒤에 저장 버튼을 눌러도
    // 저장할 것이 없다며 하려던 일(열기·갈아타기)이 취소된다.
    act(() => {
      root = createRoot(host!);
      root.render(createElement(App));
    });
    const save = vi.fn().mockResolvedValue(true);
    const answer = vi.fn();
    act(() => {
      useEditor.setState({ unsaved: true, busy: false, save });
      useUnsaved.setState({ why: { key: 'confirm.whyOpen' }, answer });
    });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })
      );
    });

    // save() 를 직접 부르지 않는다 — 답이 keepEdits 로 흘러 거기서 저장이 이어진다.
    expect(answer).toHaveBeenCalledWith('save');
    expect(save).not.toHaveBeenCalled();
  });
});
