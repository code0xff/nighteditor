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
  const LOCKED = 'data-ne-locked';

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
  /** 편집을 열 때의 innerHTML. Escape 복원과 pristine 판정에 쓴다. */
  let snapshot: string | null = null;
  let composing = false;
  /** 조합 중이라 미뤄둔 확정이 있는지 */
  let pendingCommit = false;
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
    if (editingId === null) return;
    // 조합 중에는 확정하지 않는다. 대신 미뤄뒀다가 compositionend 에서 마저 한다.
    // 그냥 건너뛰면 조합 중 포커스가 빠졌을 때 편집이 통째로 사라진다.
    if (composing) {
      pendingCommit = true;
      return;
    }
    const el = elementFor(editingId);
    if (el) {
      el.removeAttribute('contenteditable');
      // 브라우저가 직렬화한 원본과 비교한다. 소스 문자열과 비교하면
      // <br/> → <br> 같은 정규화 차이 때문에 고치지도 않은 블록에 패치가 생긴다.
      post({
        type: 'edit',
        id: editingId,
        html: el.innerHTML,
        pristine: el.innerHTML === snapshot,
      });
    }
    editingId = null;
    snapshot = null;
    pendingCommit = false;
    post({ type: 'select', id: null });
  };

  /** 편집을 버리고 열기 전 내용으로 되돌린다 */
  const cancel = (): void => {
    if (editingId === null) return;
    const el = elementFor(editingId);
    if (el) {
      el.removeAttribute('contenteditable');
      if (snapshot !== null) el.innerHTML = snapshot;
    }
    editingId = null;
    snapshot = null;
    pendingCommit = false;
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
    // 조합 중이라 확정이 미뤄졌다면 이전 편집이 아직 열려 있다.
    // 여기서 새로 열면 이전 블록이 contenteditable 인 채로 남는다.
    if (editingId !== null) return;
    editingId = id;
    snapshot = el.innerHTML;
    el.setAttribute('contenteditable', 'true');
    el.focus();
    post({ type: 'select', id });
  };

  // --- 이벤트 가로채기 (ADR-007) ---------------------------------------
  // 버블 단계에서 막는다. 캡처에서 끊으면 이벤트가 대상에 도달하지 못해
  // 캐럿이 배치되지 않는다. 이 스크립트는 문서 맨 앞에서 실행되므로
  // 아티팩트보다 먼저 등록되고, 따라서 먼저 실행된다.

  // 편집을 여닫는 데 쓰인 이벤트는 그것만 하고 끝나야 한다. 전파만 끊으면
  // <a href> 나 라벨의 기본 동작이 남아 문서가 그대로 이동해 버린다 (spec §4).
  const consume = (e: Event): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  on(document, 'click', ((e: MouseEvent) => {
    const el = blockOf(e.target);
    if (el) {
      startEdit(el);
      // 아티팩트의 전역 클릭 핸들러(슬라이드 넘김 등)에 닿지 않게 한다.
      // 캐럿은 mousedown 에서 이미 놓였으므로 여기서 기본 동작을 막아도 안전하다.
      consume(e);
      return;
    }
    // 블록 밖 클릭. 편집 중이었다면 그 클릭은 "편집 종료"로 소비하고 끝낸다.
    // 편집 중이 아니었다면 통과시킨다 — 막으면 아티팩트의 네비게이션이
    // 통째로 죽어서 다른 슬라이드로 갈 수가 없다.
    const wasEditing = editingId !== null;
    commit();
    if (wasEditing) consume(e);
  }) as EventListener);

  on(document, 'keydown', ((e: KeyboardEvent) => {
    // Ctrl/⌘+S — 브라우저의 "페이지 저장"을 막고 호스트에 저장을 부탁한다.
    // iframe 안의 키 이벤트는 호스트 창까지 올라가지 않으므로 여기서 넘겨야 한다.
    // (호스트에도 같은 판정이 있다. 이 함수는 모듈을 불러올 수 없어 공유가 안 된다, ADR-007)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
      consume(e);
      // 조합 중이면 글자가 아직 확정되지 않았다. 아무것도 하지 않고 입력을 끝내게 둔다.
      if (composing || e.isComposing) return;
      // 열려 있는 편집을 먼저 확정한다. 안 하면 방금 고친 내용이 빠진 채 나간다.
      commit();
      post({ type: e.shiftKey ? 'downloadCopy' : 'save' });
      return;
    }
    // Ctrl/⌘+Z — 편집 중이면 손대지 않는다. 블록 안 타이핑은 브라우저의 네이티브 undo 가
    // 이미 정확히 되돌린다. 편집 중이 아닐 때만 "마지막 변경 되돌리기"로 넘긴다 (spec §4).
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.altKey &&
      !e.shiftKey &&
      (e.key === 'z' || e.key === 'Z') &&
      editingId === null
    ) {
      consume(e);
      post({ type: 'undo' });
      return;
    }
    if (editingId === null) return;
    // Enter 는 편집을 확정하고 닫는다. 블록은 한 덩어리라(대원칙 4) 줄바꿈을
    // 넣는 것보다 확정하고 나가는 쪽이 훨씬 자주 필요하다. 줄바꿈은 Shift+Enter 다.
    // 조합 중이라면 IME 확정 키이므로 건드리지 않는다 — 막으면 글자를 완성할 수 없다.
    // (그때 남는 줄바꿈은 아래 beforeinput 이 치운다)
    if (e.key === 'Enter' && !e.shiftKey && !composing && !e.isComposing) {
      commit();
      consume(e);
      return;
    }
    if (e.key === 'Escape') cancel();
    // 편집 중에는 방향키·스페이스가 아티팩트 네비게이션으로 새지 않게 한다.
    e.stopImmediatePropagation();
  }) as EventListener);

  // 조합 중의 Enter 가 남기는 줄바꿈을 막는다.
  // 그 Enter 는 IME 확정 키라 keydown 에서 기본 동작을 막을 수 없다. 막으면 글자가 완성되지
  // 않는다. 그런데 흘려보내면 브라우저가 확정과 함께 줄바꿈까지 넣어 <p> 안에 <div> 가 생기고,
  // 고치지도 않은 구조가 패치에 실린다. 그래서 키가 아니라 입력 단계에서 끊는다.
  // 조합이 아닌 Enter 는 위 keydown 이 이미 소비했으므로 여기까지 오지 않는다.
  // Shift+Enter 는 insertLineBreak 라 걸리지 않는다 — 블록 안 줄바꿈은 그대로 들어간다.
  on(document, 'beforeinput', ((e: InputEvent) => {
    if (editingId === null) return;
    if (e.inputType === 'insertParagraph') e.preventDefault();
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
    // 조합 중에 포커스가 빠져 미뤄둔 확정이 있으면 지금 마저 한다.
    if (pendingCommit) commit();
  });

  on(document, 'focusout', () => {
    // commit 이 조합 여부를 직접 처리한다. 여기서 걸러내면 pendingCommit 이
    // 세팅되지 않아 조합 중 포커스가 빠졌을 때 편집이 통째로 사라진다.
    commit();
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
    // 호스트가 보낸 것만 받는다. 아무나 locked 를 비우면 INV-5 의 두 번째 방어선이 뚫린다.
    if (e.source !== parent) return;
    const msg = e.data as { type?: string; ids?: number[]; id?: number; html?: string } | null;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'locked' && msg.ids) {
      locked.clear();
      for (const id of msg.ids) locked.add(id);
      // 잠금 표식을 DOM 에도 붙인다. 주입된 스타일이 이걸 보고 커서와 테두리를 바꾼다.
      // 매번 전체를 다시 칠한다 — 이전 목록이 남으면 풀린 블록이 잠긴 척한다.
      for (const el of document.querySelectorAll('[' + MARKER + ']')) {
        if (locked.has(Number(el.getAttribute(MARKER)))) el.setAttribute(LOCKED, '');
        else el.removeAttribute(LOCKED);
      }
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
