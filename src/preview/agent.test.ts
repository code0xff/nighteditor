// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewAgent } from './agent.js';
import { MARKER_ATTR } from '../core/markers.js';

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
const click = (node: Element) => node.dispatchEvent(new MouseEvent('click', { bubbles: true }));

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

  it('마커 밖을 클릭해도 아티팩트 핸들러는 막힌다', () => {
    mount(`<p ${MARKER_ATTR}="0">본문</p><div id="bg">여백</div>`);
    const artifact = vi.fn();
    document.addEventListener('click', artifact);

    click(document.getElementById('bg')!);

    expect(artifact).not.toHaveBeenCalled();
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

    expect(sent).toContainEqual({ type: 'edit', id: 0, html: '고친 <b>본문</b>' });
    expect(el(0)?.hasAttribute('contenteditable')).toBe(false);
  });

  it('잠긴 블록은 편집을 열지 않고 blocked 를 보낸다 (INV-5)', () => {
    mount(`<p ${MARKER_ATTR}="3">코드</p>`);
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'locked', ids: [3] } }));

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
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'revert', id: 0, html: '원래 값' } })
    );
    expect(el(0)?.innerHTML).toBe('원래 값');
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

    expect(sent).toContainEqual({ type: 'edit', id: 0, html: '한글' });
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
