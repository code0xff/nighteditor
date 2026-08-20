// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewAgent } from './agent.js';
import { DARK_ATTR, LOCKED_ATTR, MARKER_ATTR } from '../core/markers.js';

/** 에이전트가 parent 로 보낸 메시지를 모은다 */
let sent: Record<string, unknown>[] = [];
let dispose: (() => void) | null = null;

function mount(html: string): void {
  document.body.innerHTML = html;
  sent = [];
  vi.spyOn(window.parent, 'postMessage').mockImplementation(((msg: unknown) => {
    sent.push(msg as Record<string, unknown>);
  }) as typeof window.parent.postMessage);
  dispose = previewAgent();
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

/** 에이전트는 호스트가 보낸 메시지만 받는다 */
const fromHost = (data: unknown) =>
  window.dispatchEvent(new MessageEvent('message', { data, source: window.parent }));

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
