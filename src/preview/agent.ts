/**
 * iframe 안에서 도는 편집 에이전트.
 *
 * **자기완결 함수여야 한다** (ADR-007). import 도, 외부 스코프 참조도 없다.
 * 호스트가 `previewAgent.toString()` 으로 문자열화해 문서 맨 앞에 주입하기 때문이다.
 * 그래서 `data-ne-id` 같은 상수도 여기서 다시 적는다 — core/markers.ts 와
 * 값이 같아야 하며, 어긋나면 agent.test.ts 가 잡는다.
 *
 * @returns 걸어둔 리스너를 모두 떼는 함수. 다른 파일을 열 때 호출한다.
 */
export function previewAgent(): () => void {
  const MARKER = 'data-ne-id';

  // 떼어낼 수 있어야 한다. 파일을 바꿔 열 때 이전 에이전트가 남아 있으면
  // 옛 상태로 이벤트를 가로채 새 문서의 편집을 방해한다.
  const bound: { target: EventTarget; type: string; fn: EventListener }[] = [];
  const on = (target: EventTarget, type: string, fn: EventListener): void => {
    target.addEventListener(type, fn);
    bound.push({ target, type, fn });
  };
  const post = (msg: unknown): void => {
    parent.postMessage(msg, '*');
  };

  let editingId: number | null = null;
  let composing = false;
  const locked = new Set<number>();

  const elementFor = (id: number): HTMLElement | null =>
    document.querySelector<HTMLElement>('[' + MARKER + '="' + id + '"]');

  /** 이벤트 대상에서 위로 올라가며 마커가 붙은 조상을 찾는다 */
  const blockOf = (target: EventTarget | null): HTMLElement | null => {
    let el = target instanceof Element ? target : null;
    while (el && !el.hasAttribute(MARKER)) el = el.parentElement;
    return el as HTMLElement | null;
  };

  const idOf = (el: HTMLElement): number => Number(el.getAttribute(MARKER));

  /** 편집을 확정하고 결과를 호스트로 보낸다 */
  const commit = (): void => {
    if (editingId === null || composing) return;
    const el = elementFor(editingId);
    if (el) {
      el.removeAttribute('contenteditable');
      post({ type: 'edit', id: editingId, html: el.innerHTML });
    }
    editingId = null;
    post({ type: 'select', id: null });
  };

  const startEdit = (el: HTMLElement): void => {
    const id = idOf(el);
    if (locked.has(id)) {
      post({ type: 'blocked', id });
      return;
    }
    if (editingId === id) return;
    commit();
    editingId = id;
    el.setAttribute('contenteditable', 'true');
    el.focus();
    post({ type: 'select', id });
  };

  // --- 이벤트 가로채기 (ADR-007) ---------------------------------------
  // 버블 단계에서 막는다. 캡처에서 끊으면 이벤트가 대상에 도달하지 못해
  // 캐럿이 배치되지 않는다. 이 스크립트는 문서 맨 앞에서 실행되므로
  // 아티팩트보다 먼저 등록되고, 따라서 먼저 실행된다.

  on(document, 'click', ((e: MouseEvent) => {
    const el = blockOf(e.target);
    if (el) {
      startEdit(el);
      // 아티팩트의 전역 클릭 핸들러(슬라이드 넘김 등)에 닿지 않게 한다.
      e.stopImmediatePropagation();
      return;
    }
    // 블록 밖 클릭. 편집 중이었다면 그 클릭은 "편집 종료"로 소비하고 끝낸다.
    // 편집 중이 아니었다면 통과시킨다 — 막으면 아티팩트의 네비게이션이
    // 통째로 죽어서 다른 슬라이드로 갈 수가 없다.
    const wasEditing = editingId !== null;
    commit();
    if (wasEditing) e.stopImmediatePropagation();
  }) as EventListener);

  on(document, 'keydown', ((e: KeyboardEvent) => {
    if (editingId === null) return;
    if (e.key === 'Escape') {
      const el = elementFor(editingId);
      el?.removeAttribute('contenteditable');
      const id = editingId;
      editingId = null;
      post({ type: 'select', id: null });
      post({ type: 'blocked', id });
    }
    // 편집 중에는 방향키·스페이스가 아티팩트 네비게이션으로 새지 않게 한다.
    e.stopImmediatePropagation();
  }) as EventListener);

  // 아티팩트의 스와이프 핸들러가 편집 중 발동하지 않게 한다.
  on(document, 'touchend', (e) => {
    if (editingId !== null) e.stopImmediatePropagation();
  });

  // --- IME (한글 조합) -------------------------------------------------
  // 조합 중에는 값을 읽지 않는다. 중간 상태를 반영하면 자모가 깨진다.
  on(document, 'compositionstart', () => {
    composing = true;
  });
  on(document, 'compositionend', () => {
    composing = false;
  });

  on(document, 'focusout', () => {
    // 조합이 끝나기 전에 확정하면 마지막 글자를 잃는다.
    if (!composing) commit();
  });

  // 붙여넣기는 서식을 버리고 평문만 넣는다.
  on(document, 'paste', ((e: ClipboardEvent) => {
    if (editingId === null) return;
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text);
  }) as EventListener);

  // --- 호스트와의 통신 --------------------------------------------------
  on(window, 'message', ((e: MessageEvent) => {
    const msg = e.data as { type?: string; ids?: number[]; id?: number; html?: string };
    if (msg.type === 'locked' && msg.ids) {
      locked.clear();
      for (const id of msg.ids) locked.add(id);
    } else if (msg.type === 'revert' && typeof msg.id === 'number') {
      const el = elementFor(msg.id);
      if (el) el.innerHTML = msg.html ?? '';
    }
  }) as EventListener);

  /** 렌더 결과의 실제 텍스트를 모아 호스트로 보낸다 (ADR-005 대조용) */
  const scan = (): void => {
    const blocks: { id: number; text: string }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('[' + MARKER + ']')) {
      blocks.push({ id: idOf(el), text: el.textContent ?? '' });
    }
    post({ type: 'ready', blocks });
  };

  // 아티팩트의 load 핸들러(DOM 재구성 등)가 끝난 뒤에 훑어야 한다.
  // 우리가 먼저 등록되므로 setTimeout 으로 한 틱 미룬다.
  on(window, 'load', () => setTimeout(scan, 0));
  if (document.readyState === 'complete') setTimeout(scan, 0);

  return () => {
    for (const { target, type, fn } of bound) target.removeEventListener(type, fn);
  };
}
