// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewAgent } from './agent.js';
import { DARK_ATTR, LOCKED_ATTR, MARKER_ATTR } from '../core/markers.js';

/** 에이전트가 parent 로 보낸 메시지를 모은다 */
let sent: Record<string, unknown>[] = [];
let dispose: (() => void) | null = null;

/** 에이전트는 호스트가 보낸 메시지만 받는다 */
const fromHost = (data: unknown) =>
  window.dispatchEvent(new MessageEvent('message', { data, source: window.parent }));

/**
 * @param verified 대조가 끝난 상태로 세울지. 기본이 true 다 — 편집은 잠금 목록이
 *   온 뒤에만 열리므로(spec §4), 대부분의 테스트는 그 뒤의 세계를 다룬다.
 */
function mount(html: string, { verified = true } = {}): void {
  document.body.innerHTML = html;
  sent = [];
  vi.spyOn(window.parent, 'postMessage').mockImplementation(((msg: unknown) => {
    sent.push(msg as Record<string, unknown>);
  }) as typeof window.parent.postMessage);
  dispose = previewAgent();
  // 잠금 목록이 대조 종료의 신호다. 빈 목록이라도 보내야 편집이 열린다.
  if (verified) fromHost({ type: 'locked', ids: [] });
  sent = [];
}

const el = (id: number) => document.querySelector<HTMLElement>(`[${MARKER_ATTR}="${id}"]`);
/** 실제 브라우저 클릭처럼 cancelable 로 보낸다 — preventDefault 여부를 볼 수 있어야 한다 */
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

/** 브라우저가 실제 편집을 반영하기 직전에 보내는 이벤트 */
const beforeinput = (inputType: string): InputEvent => {
  const e = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e;
};

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

// 리스너는 document 에 남는다. 떼지 않으면 앞 테스트의 에이전트가
// 옛 상태로 이벤트를 가로채 뒤 테스트를 오염시킨다.
afterEach(() => {
  dispose?.();
  dispose = null;
});

describe('previewAgent · 자기완결 제약 (ADR-007)', () => {
  it('core 와 같은 마커 이름을 쓴다', () => {
    // 에이전트는 import 를 쓸 수 없어 상수를 다시 적는다. 어긋나면 여기서 잡힌다.
    expect(previewAgent.toString()).toContain(MARKER_ATTR);
  });

  it('외부 스코프를 참조하지 않는다 — 문자열화해도 동작해야 한다', () => {
    expect(previewAgent.toString()).not.toMatch(/\bimport\b|\brequire\(/);
  });

  it('문자열화해서 되살린 함수가 그대로 동작한다', () => {
    // 실제 주입 방식과 같다. 클로저로 바깥 값을 참조하고 있었다면 여기서 죽는다.
    // 번들 최소화 후에도 살아남는 성질이 바로 이것이다.
    document.body.innerHTML = `<p ${MARKER_ATTR}="0">본문</p>`;
    sent = [];
    vi.spyOn(window.parent, 'postMessage').mockImplementation(((msg: unknown) => {
      sent.push(msg as Record<string, unknown>);
    }) as typeof window.parent.postMessage);

    const revived = new Function(`return (${previewAgent.toString()})`)() as typeof previewAgent;
    dispose = revived();
    // 편집은 대조가 끝나야 열린다 (spec §4) — 되살린 함수도 같은 계약을 따라야 한다.
    fromHost({ type: 'locked', ids: [] });

    click(el(0)!);
    expect(sent).toContainEqual({ type: 'select', id: 0 });
    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
  });
});

describe('previewAgent · 정리', () => {
  it('dispose 하면 더 이상 이벤트를 가로채지 않는다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    dispose?.();
    dispose = null;
    const artifact = vi.fn();
    document.addEventListener('click', artifact);

    click(el(0)!);

    expect(artifact).toHaveBeenCalled();
  });
});

describe('previewAgent · 이벤트 가로채기', () => {
  it('아티팩트의 전역 클릭 핸들러가 발동하지 않는다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    // 아티팩트 스크립트는 body 끝에 있으므로 에이전트보다 늦게 등록된다.
    const artifact = vi.fn();
    document.addEventListener('click', artifact);

    click(el(0)!);

    expect(artifact).not.toHaveBeenCalled();
    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
  });

  it('편집 중이 아니면 블록 밖 클릭을 통과시킨다 — 아티팩트 네비게이션이 살아 있어야 한다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p><div id="bg">여백</div>`);
    const artifact = vi.fn();
    document.addEventListener('click', artifact);

    click(document.getElementById('bg')!);

    expect(artifact).toHaveBeenCalled();
  });

  it('편집 중 블록 밖 클릭은 편집 종료로 소비하고 네비게이션으로 새지 않는다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p><div id="bg">여백</div>`);
    click(el(0)!);
    const artifact = vi.fn();
    document.addEventListener('click', artifact);

    click(document.getElementById('bg')!);

    expect(artifact).not.toHaveBeenCalled();
    expect(el(0)?.hasAttribute('contenteditable')).toBe(false);
  });

  it('편집 중 방향키가 아티팩트로 새지 않는다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    const artifact = vi.fn();
    document.addEventListener('keydown', artifact);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(artifact).not.toHaveBeenCalled();
  });

  it('편집 중이 아니면 방향키를 막지 않는다 — 아티팩트 네비게이션은 살아 있어야 한다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    const artifact = vi.fn();
    document.addEventListener('keydown', artifact);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(artifact).toHaveBeenCalled();
  });
});

describe('previewAgent · 대조 전에는 편집을 열지 않는다 (spec §4)', () => {
  it('잠금 목록이 오기 전의 클릭은 notReady 만 보낸다', () => {
    // 이때 연 편집은 대조가 그 블록을 잠그는 순간 저장에서 지워져
    // 화면과 저장본이 갈라진다 — 열지 않고 사정만 알린다 (대원칙 3).
    mount(`<p ${MARKER_ATTR}="0">본문</p>`, { verified: false });

    click(el(0)!);

    expect(sent).toContainEqual({ type: 'notReady' });
    expect(sent.find((m) => m.type === 'select')).toBeUndefined();
    expect(el(0)?.hasAttribute('contenteditable')).toBe(false);
  });

  it('잠금 목록이 오면 그때부터 편집이 열린다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`, { verified: false });
    click(el(0)!);
    expect(el(0)?.hasAttribute('contenteditable')).toBe(false);

    fromHost({ type: 'locked', ids: [] });
    click(el(0)!);

    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
  });
});

describe('previewAgent · 편집 흐름', () => {
  it('클릭하면 select 를 보내고 편집을 연다', () => {
    mount(`<p ${MARKER_ATTR}="7">본문</p>`);
    click(el(7)!);
    expect(sent).toContainEqual({ type: 'select', id: 7 });
  });

  it('포커스가 빠지면 편집 결과를 보낸다', () => {
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

  it('잠긴 블록은 편집을 열지 않고 blocked 를 보낸다 (INV-5)', () => {
    mount(`<p ${MARKER_ATTR}="3">코드</p>`);
    fromHost({ type: 'locked', ids: [3] });

    click(el(3)!);

    expect(sent).toContainEqual({ type: 'blocked', id: 3 });
    expect(el(3)?.hasAttribute('contenteditable')).toBe(false);
  });

  it('Escape 를 누르면 편집을 닫는다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(el(0)?.hasAttribute('contenteditable')).toBe(false);
  });

  it('revert 메시지로 원래 내용을 되돌린다', () => {
    mount(`<p ${MARKER_ATTR}="0">고쳐진 값</p>`);
    fromHost({ type: 'revert', id: 0, html: '원래 값' });
    expect(el(0)?.innerHTML).toBe('원래 값');
  });
});

describe('previewAgent · Enter 로 편집 닫기', () => {
  it('확정하고 편집을 닫는다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    el(0)!.innerHTML = '고친 본문';

    keydown('Enter');

    expect(sent).toContainEqual({ type: 'edit', id: 0, html: '고친 본문', pristine: false });
    expect(el(0)?.hasAttribute('contenteditable')).toBe(false);
  });

  it('아티팩트로 새지 않고 줄바꿈도 넣지 않는다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    const artifact = vi.fn();
    document.addEventListener('keydown', artifact);

    const e = keydown('Enter');

    expect(artifact).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it('조합 중 Enter 는 편집을 닫지 않는다 — 한글 확정 키다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));

    const e = keydown('Enter');

    // 확정을 막으면 글자를 완성할 수 없으므로 기본 동작을 살려 둔다.
    expect(e.defaultPrevented).toBe(false);
    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
    expect(sent.some((m) => m.type === 'edit')).toBe(false);
  });

  it('조합 중 Enter 가 남기려는 줄바꿈은 입력 단계에서 막는다', () => {
    // 브라우저는 조합 확정과 줄바꿈을 함께 처리한다. 키를 막을 수 없으니 입력을 막는다.
    // 놓치면 <p> 안에 <div> 가 생겨 고치지도 않은 구조가 패치에 실린다.
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    keydown('Enter');

    expect(beforeinput('insertParagraph').defaultPrevented).toBe(true);
  });

  it('편집 중이 아니면 줄바꿈 입력에 손대지 않는다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);

    expect(beforeinput('insertParagraph').defaultPrevented).toBe(false);
  });

  it('Shift+Enter 는 편집을 닫지 않고 블록 안에 줄바꿈을 넣는다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);

    const e = keydown('Enter', { shiftKey: true });

    // 기본 동작이 살아 있어야 브라우저가 <br> 을 넣는다.
    expect(e.defaultPrevented).toBe(false);
    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
    expect(sent.some((m) => m.type === 'edit')).toBe(false);
    expect(beforeinput('insertLineBreak').defaultPrevented).toBe(false);
  });

  it('편집 중이 아니면 Enter 를 아티팩트로 넘긴다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    const artifact = vi.fn();
    document.addEventListener('keydown', artifact);

    const e = keydown('Enter');

    expect(artifact).toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('previewAgent · 잠금 표식', () => {
  it('호스트가 알려준 잠긴 블록에 표식을 붙인다 — 스타일이 이걸 보고 표시한다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p><p ${MARKER_ATTR}="1">코드</p>`);

    fromHost({ type: 'locked', ids: [1] });

    expect(el(0)?.hasAttribute(LOCKED_ATTR)).toBe(false);
    expect(el(1)?.hasAttribute(LOCKED_ATTR)).toBe(true);
  });

  it('목록이 바뀌면 이전 표식을 지운다 — 풀린 블록이 잠긴 척하면 안 된다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p><p ${MARKER_ATTR}="1">코드</p>`);

    fromHost({ type: 'locked', ids: [0, 1] });
    fromHost({ type: 'locked', ids: [1] });

    expect(el(0)?.hasAttribute(LOCKED_ATTR)).toBe(false);
    expect(el(1)?.hasAttribute(LOCKED_ATTR)).toBe(true);
  });

  it('core 와 같은 잠금 표식 이름을 쓴다', () => {
    // 에이전트는 모듈을 불러올 수 없어 상수를 다시 적는다. 어긋나면 여기서 잡힌다.
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

  it('편집 중이면 확정하고 저장을 부탁한다 — 방금 고친 내용이 빠지면 안 된다', () => {
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

  it('편집 중이 아니어도 저장을 부탁한다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);

    ctrlS();

    expect(sent).toContainEqual({ type: 'save' });
  });

  it('브라우저의 페이지 저장을 막고 아티팩트로도 넘기지 않는다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    const artifact = vi.fn();
    document.addEventListener('keydown', artifact);

    const e = ctrlS();

    expect(e.defaultPrevented).toBe(true);
    expect(artifact).not.toHaveBeenCalled();
  });

  it('조합 중에는 저장하지 않는다 — 글자가 아직 확정되지 않았다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));

    const e = ctrlS();

    expect(sent.some((m) => m.type === 'save')).toBe(false);
    // 저장은 미루더라도 브라우저 대화상자는 뜨지 않아야 한다.
    expect(e.defaultPrevented).toBe(true);
  });

  it('Ctrl+Shift+S 는 사본 내려받기로 넘긴다 — 저장과 갈라져야 한다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    el(0)!.innerHTML = '고친 본문';

    const e = ctrlS({ shiftKey: true });

    expect(sent).toContainEqual({ type: 'downloadCopy' });
    expect(sent.some((m) => m.type === 'save')).toBe(false);
    // 사본도 열려 있는 편집을 확정한 뒤에 나가야 한다.
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

  it('편집 중이 아니면 되돌리기를 부탁한다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);

    const e = ctrlZ();

    expect(sent).toContainEqual({ type: 'undo' });
    expect(e.defaultPrevented).toBe(true);
  });

  it('편집 중에는 손대지 않는다 — 네이티브 undo 가 블록 안 타이핑을 되돌린다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);

    const e = ctrlZ();

    expect(sent.some((m) => m.type === 'undo')).toBe(false);
    expect(e.defaultPrevented).toBe(false);
    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
  });
});

describe('previewAgent · 클릭의 기본 동작', () => {
  it('블록 안의 링크를 눌러도 문서가 이동하지 않는다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문 <a href="#next">링크</a></p>`);

    const e = clickEvent(document.querySelector('a')!);

    expect(e.defaultPrevented).toBe(true);
    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
  });

  it('편집을 닫는 블록 밖 클릭도 기본 동작을 막는다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p><a id="nav" href="#next">이동</a>`);
    click(el(0)!);

    const e = clickEvent(document.getElementById('nav')!);

    expect(e.defaultPrevented).toBe(true);
    expect(el(0)?.hasAttribute('contenteditable')).toBe(false);
  });

  it('편집 중이 아니면 기본 동작을 막지 않는다 — 아티팩트 링크는 살아 있어야 한다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p><a id="nav" href="#next">이동</a>`);

    const e = clickEvent(document.getElementById('nav')!);

    expect(e.defaultPrevented).toBe(false);
  });
});

describe('previewAgent · IME (한글 조합)', () => {
  it('조합 중에는 확정하지 않는다 — 자모가 깨진다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    expect(sent.filter((m) => m.type === 'edit')).toHaveLength(0);
  });

  it('조합이 끝난 뒤에는 확정한다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el(0)!.innerHTML = '한글';
    document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    expect(sent).toContainEqual({ type: 'edit', id: 0, html: '한글', pristine: false });
  });
});

describe('previewAgent · 잠금 표시', () => {
  it('잠긴 블록에 표식을 붙인다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    fromHost({ type: 'locked', ids: [0] });

    expect(el(0)?.hasAttribute(LOCKED_ATTR)).toBe(true);
  });

  it('화면에 아무것도 없는 요소에는 칠하지 않는다', () => {
    // CSS 로 그린 막대까지 금지 커서로 덮으면 문서가 통째로 "못 고침" 처럼 보인다.
    mount(`<div ${MARKER_ATTR}="0" class="bar"></div>`);
    fromHost({ type: 'locked', ids: [0] });

    expect(el(0)?.hasAttribute(LOCKED_ATTR)).toBe(false);
  });

  it('칠하지 않아도 잠금은 그대로다 — 누르면 이유가 뜬다', () => {
    mount(`<div ${MARKER_ATTR}="0" class="bar"></div>`);
    fromHost({ type: 'locked', ids: [0] });

    click(el(0)!);

    expect(sent).toContainEqual({ type: 'blocked', id: 0 });
    expect(el(0)?.hasAttribute('contenteditable')).toBe(false);
  });
});

describe('previewAgent · 표시 색 맞추기', () => {
  const scan = async (): Promise<void> => {
    window.dispatchEvent(new Event('load'));
    await new Promise((r) => setTimeout(r, 0));
  };

  it('어두운 배경 위의 블록에 표식을 붙인다', async () => {
    mount(`<div style="background-color:rgb(16,16,20)"><p ${MARKER_ATTR}="0">본문</p></div>`);
    await scan();

    // 블록 자신은 투명하다 — 위로 올라가 실제로 깔린 색을 찾아야 한다.
    expect(el(0)?.hasAttribute(DARK_ATTR)).toBe(true);
  });

  it('밝은 배경 위의 블록에는 붙이지 않는다', async () => {
    mount(`<div style="background-color:rgb(255,255,255)"><p ${MARKER_ATTR}="0">본문</p></div>`);
    await scan();

    expect(el(0)?.hasAttribute(DARK_ATTR)).toBe(false);
  });

  it('한 문서 안에서 블록마다 따로 판정한다', async () => {
    // 어두운 바탕에 밝은 카드. 문서 단위로 정하면 카드 안 블록이 안 보인다.
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

describe('previewAgent · 렌더 후 대조 (ADR-005)', () => {
  it('마커가 붙은 모든 요소의 라이브 텍스트를 보고한다', async () => {
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

  it('스크립트가 DOM 을 재구성해도 마커를 따라간다 (ADR-003)', async () => {
    mount(`<section ${MARKER_ATTR}="9">원본</section>`);
    // wrapSheets() 처럼 자식을 새 wrapper 로 옮기는 상황
    const wrapper = document.createElement('div');
    const moved = el(9)!;
    document.body.appendChild(wrapper);
    wrapper.appendChild(moved);

    window.dispatchEvent(new Event('load'));
    await new Promise((r) => setTimeout(r, 0));

    expect(sent).toContainEqual({ type: 'ready', blocks: [{ id: 9, text: '원본' }] });
  });

  it('블록 안의 흉내 표식은 보고에 싣지 않는다 — 내용이지 블록이 아니다 (spec §3)', async () => {
    // snapshotMarkers 는 흉내를 거르는데 보고만 겹침째로 실으면, 호스트의 대조가
    // 같은 id 를 둘로 보고 멀쩡한 바깥 블록을 MARKER_CLASH 로 잠근다.
    mount(`<p ${MARKER_ATTR}="0">본문 <span ${MARKER_ATTR}="0">흉내</span></p>`);

    window.dispatchEvent(new Event('load'));
    await new Promise((r) => setTimeout(r, 0));

    // 흉내의 글자는 바깥 블록의 내용으로서 함께 실린다.
    expect(sent).toContainEqual({ type: 'ready', blocks: [{ id: 0, text: '본문 흉내' }] });
  });
});

describe('previewAgent · 리뷰 회귀', () => {
  it('Escape 는 내용을 열기 전으로 되돌린다', () => {
    mount(`<p ${MARKER_ATTR}="0">원래 내용</p>`);
    click(el(0)!);
    el(0)!.innerHTML = '고친 내용';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(el(0)?.innerHTML).toBe('원래 내용');
    // 잠긴 것도 아닌데 blocked 를 보내면 호스트가 "편집 불가 — null" 을 띄운다.
    expect(sent.filter((m) => m.type === 'blocked')).toHaveLength(0);
  });

  it('고치지 않고 빠져나오면 pristine 으로 알린다', () => {
    // 소스 문자열과 브라우저 직렬화는 다를 수 있다(<br/> → <br>).
    // 호스트가 소스와 비교하면 만지지도 않은 블록에 패치가 생긴다.
    mount(`<p ${MARKER_ATTR}="0">건드리지 않음</p>`);
    click(el(0)!);
    document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    const edit = sent.find((m) => m.type === 'edit');
    expect(edit?.pristine).toBe(true);
  });

  it('조합 중 포커스가 빠져도 편집을 잃지 않는다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el(0)!.innerHTML = '한글 입력';
    // 조합이 열린 채로 iframe 밖(호스트 툴바)을 클릭한 상황
    document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(sent.filter((m) => m.type === 'edit')).toHaveLength(0);

    document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));

    expect(sent).toContainEqual({ type: 'edit', id: 0, html: '한글 입력', pristine: false });
  });

  it('호스트가 아닌 곳에서 온 메시지는 무시한다', () => {
    mount(`<p ${MARKER_ATTR}="3">본문</p>`);
    fromHost({ type: 'locked', ids: [3] });
    // 제3자가 잠금을 비우려 시도한다
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'locked', ids: [] } }));

    click(el(3)!);

    expect(sent).toContainEqual({ type: 'blocked', id: 3 });
    expect(el(3)?.hasAttribute('contenteditable')).toBe(false);
  });

  it('null 메시지에 죽지 않는다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    expect(() => fromHost(null)).not.toThrow();
  });
});

describe('previewAgent · 고른 블록 보여주기', () => {
  it('그 자리로 데려가고 잠깐 짚어준다', async () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    const into = vi.fn();
    el(0)!.scrollIntoView = into;

    fromHost({ type: 'reveal', id: 0 });

    expect(into).toHaveBeenCalledOnce();
    // 스크롤만 하면 어디가 그 블록인지 알 수 없다.
    expect(el(0)?.hasAttribute('data-ne-revealed')).toBe(true);
  });

  it('짚어둔 표시는 스스로 사라진다', async () => {
    vi.useFakeTimers();
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    el(0)!.scrollIntoView = vi.fn();

    fromHost({ type: 'reveal', id: 0 });
    vi.advanceTimersByTime(2000);

    expect(el(0)?.hasAttribute('data-ne-revealed')).toBe(false);
    vi.useRealTimers();
  });

  it('없는 블록을 짚어 달라 해도 죽지 않는다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);

    expect(() => fromHost({ type: 'reveal', id: 99 })).not.toThrow();
  });
});

describe('previewAgent · 인라인 서식 (spec §4.1)', () => {
  // happy-dom 에는 execCommand 가 없다. 실제 편집은 브라우저가 하는 일이라,
  // 여기서는 **무엇을 어떤 모드로 부르는지**만 본다.
  beforeEach(() => {
    document.execCommand = (() => true) as typeof document.execCommand;
  });

  /** 블록 안의 글자 일부를 고른다 */
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

  it('고른 글자 위에 막대가 뜨고, 고른 것이 없으면 사라진다', () => {
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);

    select(0, 1, 4);
    const bar = document.querySelector<HTMLElement>('[data-ne-bar]');
    expect(bar?.style.display).toBe('flex');

    getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    expect(bar?.style.display).toBe('none');
  });

  it('편집 중이 아니면 막대를 띄우지 않는다', () => {
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);

    select(0, 1, 4);

    expect(document.querySelector<HTMLElement>('[data-ne-bar]')?.style.display ?? 'none').toBe(
      'none'
    );
  });

  it('막대를 누른 클릭은 편집을 닫지 않는다', () => {
    // 블록 밖 클릭으로 세면 서식 버튼을 누르는 순간 편집이 끝난다.
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);
    select(0, 1, 4);

    const button = document.querySelector('[data-ne-bar] button');
    click(button!);

    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
    expect(sent.some((m) => m.type === 'edit')).toBe(false);
  });

  it('굵게·기울임·밑줄은 태그로, 색·크기는 style 로 뽑는다', () => {
    // <font> 가 섞이면 다음에 이 파일을 열 때 그 문단이 통째로 편집 불가가 된다.
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

  it('Ctrl+B · I · U 가 아티팩트로 새지 않는다', () => {
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);
    const artifact = vi.fn();
    document.addEventListener('keydown', artifact);

    const e = keydown('b', { ctrlKey: true });

    expect(e.defaultPrevented).toBe(true);
    expect(artifact).not.toHaveBeenCalled();
  });

  it('막대 문구는 호스트가 건넨다 — 에이전트는 언어팩을 모른다', () => {
    // 여기에 한 언어를 박으면 그 언어가 굳는다. 화면 문구의 출처는 언어팩 하나다 (spec §1).
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);
    select(0, 1, 4);

    fromHost({ type: 'labels', labels: { 'format.bold': 'Bold' } });

    const bold = document.querySelector('[data-ne-label="format.bold"]');
    expect(bold?.getAttribute('title')).toBe('Bold');
  });

  it('문구를 받기 전에는 비워 둔다 — 한 언어를 박아 두지 않는다', () => {
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);
    select(0, 1, 4);

    const titles = [...document.querySelectorAll('[data-ne-label]')].map((b) =>
      b.getAttribute('title')
    );

    expect(titles.every((title) => title === '')).toBe(true);
  });

  it('언어를 바꾸면 떠 있는 막대도 바뀐다', () => {
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);
    select(0, 1, 4);
    fromHost({ type: 'labels', labels: { 'format.bold': 'Bold' } });

    fromHost({ type: 'labels', labels: { 'format.bold': '굵게' } });

    expect(document.querySelector('[data-ne-label="format.bold"]')?.getAttribute('title')).toBe(
      '굵게'
    );
  });

  it('색은 이 문서가 글자에 쓰는 것으로만 채운다', () => {
    // 우리가 고른 색을 주면 문서가 가진 배색을 이긴다. 거기 없던 색을 새로 들이는 것은
    // 고치는 일이 아니라 디자인을 바꾸는 일이다.
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

  it('눈에 같은 색은 하나로 묶는다', () => {
    // 계산된 값이 달라도 12px 동그라미에서 구분되지 않으면 고를 수 없는 선택지다.
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

  it('색 칸은 찌그러지지 않는다', () => {
    // 버튼 기본 스타일이 all:unset 이라 display 가 inline 이고 좌우 패딩이 남는다.
    // 그대로 두면 width·height 가 먹지 않아 옆으로 퍼진 타원이 된다.
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

  it('편집을 닫으면 막대도 사라진다', () => {
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p><div id="bg">여백</div>`);
    click(el(0)!);
    select(0, 1, 4);

    click(document.getElementById('bg')!);

    expect(document.querySelector<HTMLElement>('[data-ne-bar]')?.style.display).toBe('none');
  });
});

describe('previewAgent · 서식 범위는 편집 중인 블록을 넘지 않는다 (spec §4.1)', () => {
  beforeEach(() => {
    document.execCommand = (() => true) as typeof document.execCommand;
  });

  /** 블록 두 개에 걸치는 선택을 만든다 */
  function selectAcross(): void {
    const range = document.createRange();
    range.setStart(el(0)!.firstChild!, 1);
    range.setEnd(el(1)!.firstChild!, 2);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }

  it('이웃 블록까지 걸친 선택에는 막대를 띄우지 않는다', () => {
    // 시작만 보면 걸친 선택으로도 막대가 떠서, 추적되지 않는 이웃까지 바꾼다 (대원칙 2).
    mount(`<p ${MARKER_ATTR}="0">가나다라</p><p ${MARKER_ATTR}="1">마바사아</p>`);
    click(el(0)!);

    selectAcross();

    expect(document.querySelector<HTMLElement>('[data-ne-bar]')?.style.display ?? 'none').toBe(
      'none'
    );
  });

  it('이웃 블록까지 걸친 선택에는 Ctrl+B 도 걸리지 않는다', () => {
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

describe('previewAgent · 들고 있던 서식 범위의 수명 (spec §4.1)', () => {
  /** bold 가 걸린 순간의 선택 내용을 붙잡는다 */
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

  it('캐럿을 옮겨 선택을 떠나면 옛 범위를 버린다', () => {
    // 남겨 두면 다음 Ctrl+B 가 지금 자리가 아니라 옛 글자에 걸린다.
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);
    select(1, 4);

    // 캐럿만 남기고 이동한다 — 선택을 떠났다.
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

  it('막대를 누르는 사이에 풀린 선택은 명령 직전에 되살린다', () => {
    // 이 경우까지 버리면 막대의 존재 이유가 사라진다 — 누르는 동안 풀린 선택에
    // 아무 서식도 걸 수 없게 된다.
    mount(`<p ${MARKER_ATTR}="0">가나다라마바사</p>`);
    click(el(0)!);
    select(1, 4);

    const button = document.querySelector('[data-ne-bar] button')!;
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    // 브라우저가 이 순간 선택을 풀 수 있다.
    getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    click(button);

    expect(selectedAtBold).toBe('나다라');
  });
});

describe('previewAgent · 반투명 배경의 밝기 (spec §4 · 시각 표시)', () => {
  const scan = async (): Promise<void> => {
    window.dispatchEvent(new Event('load'));
    await new Promise((r) => setTimeout(r, 0));
  };

  it('흰 바탕 위의 옅은 검정은 밝은 배경이다', async () => {
    // rgba(0,0,0,.1) 의 색 값만 읽으면 어둡다고 잘못 판정해 표시가 배경에 묻힌다.
    mount(
      `<div style="background-color:rgb(255,255,255)">` +
        `<div style="background-color:rgba(0,0,0,0.1)"><p ${MARKER_ATTR}="0">본문</p></div>` +
        `</div>`
    );
    await scan();

    expect(el(0)?.hasAttribute(DARK_ATTR)).toBe(false);
  });

  it('어두운 바탕 위의 옅은 흰색은 여전히 어두운 배경이다', async () => {
    mount(
      `<div style="background-color:rgb(16,16,20)">` +
        `<div style="background-color:rgba(255,255,255,0.1)"><p ${MARKER_ATTR}="0">본문</p></div>` +
        `</div>`
    );
    await scan();

    expect(el(0)?.hasAttribute(DARK_ATTR)).toBe(true);
  });
});

describe('previewAgent · 서식 막대는 저장본에 실리지 않는다 (INV-9)', () => {
  beforeEach(() => {
    document.execCommand = (() => true) as typeof document.execCommand;
  });

  // body 는 요소 자식 없이 텍스트만 가지면 그 자체로 블록이 된다 (spec §2).
  // mount() 는 body **안에** 마크업을 넣으므로 여기서는 body 에 직접 마커를 붙인다.
  function mountBodyBlock(): void {
    document.body.innerHTML = '';
    document.body.textContent = '가나다라마바사';
    document.body.setAttribute(MARKER_ATTR, '0');
    sent = [];
    vi.spyOn(window.parent, 'postMessage').mockImplementation(((msg: unknown) => {
      sent.push(msg as Record<string, unknown>);
    }) as typeof window.parent.postMessage);
    dispose = previewAgent();
    // 편집은 대조가 끝나야 열린다 (spec §4) — 잠금 목록이 그 신호다.
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
    // 다음 테스트의 "블록 밖 클릭" 판정이 body 마커에 걸리지 않게 지운다.
    document.body.removeAttribute(MARKER_ATTR);
    // body 에 남은 포커스도 내려놓는다. 남으면 다음 테스트의 focus() 가 동기로
    // focusout 을 쏘아 방금 연 편집을 그 자리에서 확정해 버린다.
    (document.activeElement as HTMLElement | null)?.blur?.();
  });

  it('<body> 자체가 블록이어도 막대가 블록 안에 들어가지 않는다', () => {
    mountBodyBlock();
    click(document.body);
    selectBodyText();

    const bar = document.querySelector<HTMLElement>('[data-ne-bar]');
    expect(bar?.style.display).toBe('flex');
    // body 에 붙이면 이 블록의 innerHTML 에 편집기 버튼이 통째로 들어간다.
    expect(document.body.contains(bar)).toBe(false);
  });

  it('Enter 확정이 보내는 innerHTML 에 막대가 없다', () => {
    mountBodyBlock();
    click(document.body);
    selectBodyText();

    keydown('Enter');

    const edit = sent.find((m) => m.type === 'edit');
    expect(edit).toBeDefined();
    expect(String(edit?.html)).toBe('가나다라마바사');
    expect(String(edit?.html)).not.toContain('data-ne-bar');
  });

  it('막대가 블록 안으로 옮겨져 있어도 확정 전에 걷어낸다', () => {
    // 아티팩트 스크립트는 DOM 을 재구성한다(wrapSheets 식). 막대가 블록 안으로
    // 끌려 들어간 채 확정되면 저장본에 편집기 UI 가 실린다 — 마지막 방어선을 본다.
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

  it('막대가 블록 안으로 옮겨져 있어도 취소가 막대를 죽이지 않는다', () => {
    // Escape 는 innerHTML 을 스냅숏으로 되돌린다. 막대가 블록 안에 있는 채로 되돌리면
    // 막대가 DOM 에서 떨어지는데 참조는 남아, 다음 선택부터 막대를 다시 만들지도
    // 붙이지도 않는다 — 세션 내내 서식 기능이 사라진다.
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

    // 막대는 살아 있고, 되돌린 블록에는 막대가 없다.
    expect(document.documentElement.contains(bar)).toBe(true);
    expect(el(0)!.innerHTML).toBe('가나다라마바사');

    // 다시 편집하고 글자를 고르면 그 막대가 다시 뜬다.
    click(el(0)!);
    selectText();
    expect(bar.style.display).toBe('flex');
  });
});

describe('previewAgent · 크기 조절은 고른 범위로 가려낸다 (spec §4.1)', () => {
  /** 텍스트 노드 하나에서 범위를 고른다 */
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

  it('명령이 만든 자리는 배수로 바뀌고, 원본의 같은 값 자리는 그대로다', () => {
    // 브라우저처럼: fontSize 명령이 고른 범위를 xxx-large 스팬으로 감싼다.
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
    // 고르지 않은, 원본이 같은 값을 쓰던 자리는 그대로다 (대원칙 2).
    expect(el(0)!.querySelector<HTMLElement>('#orig')?.style.fontSize).toBe('xxx-large');
  });

  it('고른 범위 자체가 이미 그 값이면 — 명령이 아무것도 안 만들어도 — 배수가 적힌다', () => {
    // 브라우저는 이미 그 크기인 범위에 fontSize 명령을 걸면 아무것도 바꾸지 않는다.
    // 값("명령 전에 이미 그 값이던 자리")으로 가려내면 이때 A-/A+ 가 통째로 무시된다.
    document.execCommand = (() => true) as typeof document.execCommand;
    mount(
      `<p ${MARKER_ATTR}="0"><span id="big" style="font-size: xxx-large">가나다</span>라마</p>`
    );
    click(el(0)!);
    selectIn(document.getElementById('big')!.firstChild!, 0, 3);

    click(sizeButton('A-'));

    expect(document.getElementById('big')?.style.fontSize).toBe('0.85em');
    expect(el(0)!.textContent).toBe('가나다라마');
    // 고르지 않은 글자에는 아무것도 생기지 않는다.
    expect(el(0)!.querySelectorAll('span').length).toBe(1);
  });

  it('이미 그 값인 자리의 일부만 골랐으면 갈라서 고른 부분만 바꾼다', () => {
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
    // 겉모습(색)은 물려받는다 — 사용자는 크기만 청했다.
    expect(spans.map((s) => s.style.color)).toEqual([
      'rgb(1, 2, 3)',
      'rgb(1, 2, 3)',
      'rgb(1, 2, 3)',
    ]);
  });

  it('갈라도 앞자리의 주석은 남는다 — 사용자가 쓴 것이 사라지면 안 된다 (대원칙 1·2)', () => {
    // 고른 범위 앞이 주석뿐이면 textContent 로만 재는 빈자리 판정이 host 를 지워,
    // 고르지도 않은 주석이 저장본에서 사라진다.
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

  it('갈라도 뒷자리의 주석은 남는다', () => {
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

describe('previewAgent · 팔레트는 body 자신도 훑는다 (spec §4.1)', () => {
  beforeEach(() => {
    document.execCommand = (() => true) as typeof document.execCommand;
  });

  afterEach(() => {
    document.body.removeAttribute(MARKER_ATTR);
    document.body.removeAttribute('style');
    (document.activeElement as HTMLElement | null)?.blur?.();
  });

  it('글자가 <body> 바로 아래 있고 색이 body 에 걸려 있어도 색이 나온다', () => {
    // 자손만 훑으면(querySelectorAll('*')) body 를 건너뛰어 색 칸이 하나도 없다.
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

describe('previewAgent · 문서의 표 (spec §5)', () => {
  it('표를 받으면 모든 메시지에 붙인다 — 호스트가 옛 프리뷰의 메시지를 가릴 수 있어야 한다', () => {
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

  it('표 없이 부르면 메시지를 그대로 보낸다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    expect(sent).toContainEqual({ type: 'select', id: 0 });
  });
});

describe('previewAgent · 문서가 우리 표식을 흉내 낼 때 (spec §3)', () => {
  it('흉내 낸 data-ne-bar 속 블록도 편집이 열린다 — 견주는 것은 속성이 아니라 우리 막대다', () => {
    // closest('[data-ne-bar]') 로 걸렀다면 이 블록의 클릭이 전부 막대 클릭으로
    // 삼켜져, 그 안의 블록은 영영 편집할 수 없다.
    mount(`<div data-ne-bar=""><p ${MARKER_ATTR}="0">본문</p></div>`);

    click(el(0)!);

    expect(sent).toContainEqual({ type: 'select', id: 0 });
    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
  });

  it('흉내 낸 data-ne-bar 로 포커스가 빠져도 확정된다', () => {
    // 속성으로 거르면 확정이 건너뛰어져 편집이 확정도 취소도 없이 열린 채 남는다.
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

  it('명단(all)에 없는 표식은 블록이 아니다 — 편집이 열리지 않는다', () => {
    // 가짜에 편집이 열리면 그 확정은 어느 블록의 것도 아니어서 조용히 사라진다.
    mount(`<div ${MARKER_ATTR}="99">가짜</div><p ${MARKER_ATTR}="0">본문</p>`, {
      verified: false,
    });
    fromHost({ type: 'locked', ids: [], all: [0] });
    sent = [];
    const fake = document.querySelector(`[${MARKER_ATTR}="99"]`)!;

    click(fake);

    expect(fake.getAttribute('contenteditable')).toBeNull();
    expect(sent.filter((m) => m.type === 'select' || m.type === 'edit')).toHaveLength(0);

    // 진짜 블록은 여느 때처럼 열린다.
    click(el(0)!);
    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
  });

  it('대조 뒤에 끼워 넣은 같은 번호의 요소는 블록이 아니다 (spec §3)', () => {
    // 명단은 번호만 가린다 — 스크립트가 대조 뒤에 같은 번호의 요소를 만들면 번호
    // 검사는 통과한다. 그 가짜를 눌러 확정하면 가짜의 내용이 진짜 블록의 자리에
    // 저장되므로, 대조 때 훑은 그 요소가 아니면 편집을 열지 않는다.
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

    // 진짜 블록은 여느 때처럼 열린다 — 문서 앞쪽의 가짜가 밀어내지 못한다.
    click(real);
    expect(real.getAttribute('contenteditable')).toBe('true');
    expect(fake.getAttribute('contenteditable')).toBeNull();
  });

  it('되돌리기는 문서 앞쪽의 흉내가 아니라 대조 때 훑은 그 요소에 닿는다 (spec §3)', () => {
    mount(`<p ${MARKER_ATTR}="0">원래</p>`, { verified: false });
    const real = el(0)!;
    fromHost({ type: 'locked', ids: [], all: [0] });
    const fake = document.createElement('p');
    fake.setAttribute(MARKER_ATTR, '0');
    fake.textContent = '가짜';
    document.body.prepend(fake);

    fromHost({ type: 'revert', id: 0, html: '되돌림' });

    // querySelector 로 되찾으면 앞쪽의 가짜가 먼저 잡혀, 진짜 블록은 고친 채 남는다.
    expect(real.innerHTML).toBe('되돌림');
    expect(fake.innerHTML).toBe('가짜');
  });

  it('블록 안의 흉내 표식은 내용이다 — 클릭이 바깥의 진짜 블록으로 흘러간다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문 <span ${MARKER_ATTR}="99">가짜</span></p>`, {
      verified: false,
    });
    fromHost({ type: 'locked', ids: [], all: [0] });
    const fake = document.querySelector(`[${MARKER_ATTR}="99"]`)!;

    click(fake);

    expect(el(0)?.getAttribute('contenteditable')).toBe('true');
    expect(fake.getAttribute('contenteditable')).toBeNull();
  });

  it('확정은 편집을 연 그 요소에서 읽는다 — 뒤늦게 끼어든 흉내가 가로채지 못한다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(document.querySelector(`p[${MARKER_ATTR}="0"]`)!);
    // 아티팩트 스크립트가 편집 중에 같은 id 의 표식을 문서 앞쪽에 끼워 넣는다 —
    // id 로 되찾으면 querySelector 가 이 가짜를 먼저 돌려준다.
    document.body.insertAdjacentHTML('afterbegin', `<div ${MARKER_ATTR}="0">가짜</div>`);
    sent = [];

    keydown('Enter');

    const edit = sent.find((m) => m.type === 'edit');
    expect(String(edit?.html)).toBe('본문');
  });

  it('겹친 id 는 어느 요소를 눌러도 잠금 안내로 간다 — 클릭이 아티팩트로 새지 않는다', () => {
    // 가짜가 문서 앞쪽에 있으면 첫 요소만 남기는 훑기는 가짜를 기억한다 — 진짜 요소의
    // 클릭이 "그 요소" 검사에서 떨어져, blocked 안내도 없이 아티팩트 핸들러로 흘러간다.
    mount(`<div ${MARKER_ATTR}="0">가짜</div><p ${MARKER_ATTR}="0">진짜</p>`, {
      verified: false,
    });
    // 호스트의 대조는 겹친 id 를 MARKER_CLASH 로 잠근다 (spec §3).
    fromHost({ type: 'locked', ids: [0], all: [0] });
    const artifact = vi.fn();
    document.addEventListener('click', artifact);
    sent = [];

    click(document.querySelector(`p[${MARKER_ATTR}="0"]`)!);

    expect(sent).toContainEqual({ type: 'blocked', id: 0 });
    expect(artifact).not.toHaveBeenCalled();
    // 잠금 표식도 겹친 요소 전부에 칠한다 — 진짜 요소만 비면 고칠 수 있어 보인다.
    expect(document.querySelector(`p[${MARKER_ATTR}="0"]`)!.hasAttribute(LOCKED_ATTR)).toBe(true);
  });

  it('블록 안의 흉내에는 잠금 표식을 칠하지 않는다 — 내용에 실려 저장본으로 샌다', () => {
    // 흉내가 미리 달고 온 data-ne-locked 를 떼면 그 변화가 바깥 블록의 innerHTML 에
    // 실려, 그 블록을 편집하는 순간 저장본이 바뀐다 (INV-9).
    mount(`<p ${MARKER_ATTR}="0">본문 <span ${MARKER_ATTR}="7" ${LOCKED_ATTR}="">가짜</span></p>`, {
      verified: false,
    });
    fromHost({ type: 'locked', ids: [], all: [0] });

    const fake = document.querySelector(`[${MARKER_ATTR}="7"]`)!;
    expect(fake.hasAttribute(LOCKED_ATTR)).toBe(true);
    // 진짜 블록의 표식은 여느 때처럼 관리된다 — 잠기지 않았으니 없다.
    expect(el(0)?.hasAttribute(LOCKED_ATTR)).toBe(false);
  });
});

describe('previewAgent · flush — 열려 있는 편집을 지금 확정한다 (spec §4)', () => {
  it('편집 중이면 확정(edit)을 먼저 보내고 flushed 로 답한다', () => {
    // 호스트는 이 순서에 기대어 unsaved 를 판정한다 — flushed 가 먼저 가면
    // 확정이 아직 안 닿은 채 물음이 돌아 편집이 조용히 사라진다.
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
    // 편집은 닫혔다 — contenteditable 이 남으면 안 된다.
    expect(el(0)!.hasAttribute('contenteditable')).toBe(false);
  });

  it('편집 중이 아니어도 flushed 로 답한다 — 청한 쪽이 한도까지 기다리면 안 된다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);

    fromHost({ type: 'flush', seq: 3 });

    expect(sent).toEqual([{ type: 'flushed', seq: 3 }]);
  });

  it('조합 중이면 답을 미뤘다가, 미룬 확정이 나간 뒤에 답한다', () => {
    // 답의 뜻은 "내보낼 확정을 전부 내보냈다" 다 (spec §4). 확정이 미뤄졌는데 답부터
    // 보내면 호스트가 최신인 줄 알고 갈아 끼워, 조합 중이던 글자가 사라진다.
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el(0)!.innerHTML = '조합하던 본문';
    sent = [];

    fromHost({ type: 'flush', seq: 11 });
    // 확정도 답도 아직이다 — 조합 중의 innerHTML 은 읽지 않는다.
    expect(sent).toEqual([]);

    document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));

    const editAt = sent.findIndex((m) => m.type === 'edit');
    const flushedAt = sent.findIndex((m) => m.type === 'flushed');
    expect(sent[editAt]).toMatchObject({ type: 'edit', id: 0, html: '조합하던 본문' });
    expect(sent[flushedAt]).toMatchObject({ type: 'flushed', seq: 11 });
    expect(editAt).toBeLessThan(flushedAt);
  });

  it('미룬 답은 편집을 버릴 때(Escape)도 나간다 — 내보낼 확정이 없어졌다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p>`);
    click(el(0)!);
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el(0)!.innerHTML = '조합하던 본문';
    sent = [];

    fromHost({ type: 'flush', seq: 12 });
    keydown('Escape');

    // 버린 편집에는 확정이 없다 — edit 없이 답만 나가고, 내용은 열기 전으로 돌아간다.
    expect(sent.find((m) => m.type === 'edit')).toBeUndefined();
    expect(sent).toContainEqual({ type: 'flushed', seq: 12 });
    expect(el(0)!.innerHTML).toBe('본문');
  });
});
