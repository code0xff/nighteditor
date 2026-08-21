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
  const DARK = 'data-ne-dark';
  const REVEALED = 'data-ne-revealed';
  const BAR = 'data-ne-bar';

  /** 색 칸은 이만큼까지만. 더 늘리면 고르는 일이 되어 버린다 */
  const MAX_COLORS = 10;

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
  /** 짚어둔 표시를 지울 시각. 연달아 고르면 앞의 것을 취소한다 */
  let revealTimer: ReturnType<typeof setTimeout> | null = null;
  let revealed: HTMLElement | null = null;
  /** 서식 막대와, 막대를 누르는 사이에 지켜 둘 선택 범위 */
  let bar: HTMLElement | null = null;
  let saved: Range | null = null;
  /**
   * 막대를 누르는 중인지. 그 사이에 풀린 선택은 사용자가 떠난 것이 아니라서
   * `saved` 를 지키고, 그 밖의 자리에서 선택이 풀리면 `saved` 도 버린다 —
   * 남겨 두면 다음 Ctrl+B 가 지금 고른 곳이 아니라 옛 글자에 걸린다 (spec §4.1).
   */
  let barHeld = false;
  /** 조합 중이라 미뤄둔 확정이 있는지 */
  let pendingCommit = false;
  const locked = new Set<number>();

  const elementFor = (id: number): HTMLElement | null =>
    document.querySelector<HTMLElement>('[' + MARKER + '="' + id + '"]');

  /** 짚어둔 표시를 지운다 */
  const clearReveal = (): void => {
    if (revealTimer !== null) clearTimeout(revealTimer);
    revealTimer = null;
    revealed?.removeAttribute(REVEALED);
    revealed = null;
  };

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
      // 마지막 방어선 (INV-9): 아티팩트 스크립트가 DOM 을 휘저어 막대를 블록 안으로
      // 옮겨 놨을 수 있다. 프리뷰 물건이 innerHTML 을 타고 저장본으로 새면 안 되므로
      // 읽기 전에 블록 밖으로 되돌린다.
      if (bar && el.contains(bar)) document.documentElement.appendChild(bar);
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
    hideBar();
    post({ type: 'select', id: null });
  };

  /** 편집을 버리고 열기 전 내용으로 되돌린다 */
  const cancel = (): void => {
    if (editingId === null) return;
    const el = elementFor(editingId);
    if (el) {
      el.removeAttribute('contenteditable');
      // commit 과 같은 방어: 아티팩트 스크립트가 막대를 블록 안으로 옮겨 놨을 수 있다.
      // 그대로 innerHTML 을 되돌리면 막대가 DOM 에서 떨어져 나가는데 참조(bar)는
      // 남아 있어, 다음 선택에서 placeBar 가 막대를 다시 만들지도 붙이지도 않는다 —
      // 세션 내내 서식 막대가 사라진다. 되돌리기 전에 블록 밖으로 빼돌린다.
      if (bar && el.contains(bar)) document.documentElement.appendChild(bar);
      if (snapshot !== null) el.innerHTML = snapshot;
    }
    editingId = null;
    snapshot = null;
    pendingCommit = false;
    hideBar();
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

  // --- 인라인 서식 (spec §4.1) -----------------------------------------

  /**
   * 서식을 건다.
   *
   * `styleWithCSS` 를 **명령마다** 정한다. 한 번만 켜 두면 어디선가 뒤집혔을 때
   * 조용히 다른 마크업이 나온다.
   *
   * - 끄면: 굵게·기울임·밑줄이 `<b>` `<i>` `<u>` 로 나온다. 사람이 읽는 diff 에 좋고
   *   문서가 이미 쓰던 표기와도 같다
   * - 켜면: 색·크기가 `<span style>` 로 나온다. 끄면 `<font>` 가 나오는데, 그 태그가
   *   섞이면 다음에 이 파일을 열 때 그 문단이 통째로 편집 불가가 된다
   */
  const CSS_COMMANDS = new Set(['foreColor', 'fontSize', 'backColor', 'hiliteColor']);

  const format = (command: string, value?: string): void => {
    if (editingId === null) return;
    const el = elementFor(editingId);
    if (!el) return;

    // 막대를 누르는 사이에 선택이 풀렸을 수 있다. 들고 있던 범위를 되살린다.
    // 지역 변수로 옮겨 놓고 쓴다 — removeAllRanges 가 selectionchange 를 동기로 쏘면
    // placeBar 가 그 안에서 saved 를 비워, 되살릴 범위가 손에서 사라진다.
    const restore = saved;
    if (restore) {
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(restore);
    }
    el.focus();
    // 선택이 이 블록을 벗어나 이웃까지 걸쳐 있으면 걸지 않는다. execCommand 는 이웃
    // 블록까지 바꾸는데, 확정 메시지는 편집 중인 블록 것만 나가서 이웃의 변경은
    // 추적되지 않은 채 저장에서 사라진다 (대원칙 2).
    const range = getSelection()?.rangeCount ? getSelection()?.getRangeAt(0) : null;
    if (!range || !el.contains(range.startContainer) || !el.contains(range.endContainer)) return;
    document.execCommand('styleWithCSS', false, String(CSS_COMMANDS.has(command)));
    document.execCommand(command, false, value);
    saved = getSelection()?.rangeCount ? (getSelection()?.getRangeAt(0) ?? null) : null;
    placeBar();
  };

  /**
   * 크기는 배수로 적는다.
   *
   * `fontSize` 가 만드는 것은 `x-large` 같은 절대 키워드다. 아티팩트마다 본문 크기가
   * 달라 절대값을 박으면 그 문서의 크기 체계와 어긋난다. 방금 만든 자리만 찾아
   * **원래 크기의 몇 배**로 고쳐 적는다.
   */
  const resize = (times: string): void => {
    if (editingId === null) return;
    const el = elementFor(editingId);
    if (!el) return;
    // 명령을 걸기 **전에** 이미 그 값을 쓰던 자리를 기억해 둔다. 원래 문서에 같은 값이
    // 있었다면, 그것까지 바꾸면 고르지도 않은 글자의 크기가 달라진다.
    const isBig = (node: HTMLElement): boolean =>
      node.style.fontSize === 'xxx-large' || node.style.fontSize === '-webkit-xxx-large';
    const before = new Set(
      [...el.querySelectorAll<HTMLElement>('[style*="font-size"]')].filter(isBig)
    );

    format('fontSize', '7');

    for (const node of el.querySelectorAll<HTMLElement>('[style*="font-size"]')) {
      if (isBig(node) && !before.has(node)) node.style.fontSize = times;
    }
    commitLater();
  };

  /** 서식은 입력이 아니라 명령이라 input 이벤트가 늦게 온다. 확정은 focusout 이 한다 */
  const commitLater = (): void => {
    saved = getSelection()?.rangeCount ? (getSelection()?.getRangeAt(0) ?? null) : null;
  };

  /**
   * **이 문서가 글자에 쓰는 색**을 많이 쓰인 순서로 모은다.
   *
   * 우리가 고른 색을 주면 문서가 가진 색 체계를 이긴다. 아티팩트는 제 배색이 있고,
   * 거기 없던 빨강을 새로 들이는 것은 고치는 일이 아니라 디자인을 바꾸는 일이다.
   * 쓸 수 있는 색은 이미 그 문서 안에 있다.
   *
   * 글자가 있는 요소만 센다 — 빈 칸의 색은 화면에 나타난 적이 없다.
   */
  const paletteOf = (): string[] => {
    const used = new Map<string, number>();
    for (const el of document.body?.querySelectorAll<HTMLElement>('*') ?? []) {
      const text = [...el.childNodes].some(
        (node) => node.nodeType === 3 && (node.nodeValue ?? '').trim().length > 0
      );
      if (!text) continue;
      const color = getComputedStyle(el).color;
      if (/^rgba?\(/.test(color)) used.set(color, (used.get(color) ?? 0) + 1);
    }

    return [...used.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_COLORS)
      .map(([color]) => color);
  };

  /**
   * 막대에 붙일 문구. 호스트가 언어팩에서 건네준다 (spec §1).
   * 아직 못 받았으면 비워 둔다 — 여기에 한 언어를 박으면 그 언어가 굳는다.
   */
  let labels: Record<string, string> = {};

  const button = (label: string, name: string, run: () => void): HTMLElement => {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.setAttribute('data-ne-label', name);
    el.title = labels[name] ?? '';
    el.style.cssText =
      'all:unset;cursor:pointer;padding:2px 6px;border-radius:4px;font:600 12px/1.4 system-ui;';
    // 누르는 순간 포커스가 옮겨 가면 선택이 풀린다. 기본 동작부터 막는다.
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      run();
    });
    return el;
  };

  const buildBar = (): HTMLElement => {
    const box = document.createElement('div');
    box.setAttribute(BAR, '');
    // 누르는 동안임을 표시한다. 이때 선택이 풀려도 saved 를 지켜야 명령 직전에 되살린다.
    // 내려놓는 쪽은 document 의 mouseup 이다 — 막대 밖에서 손을 떼도 표시가 남지 않게.
    box.addEventListener('mousedown', () => {
      barHeld = true;
    });
    box.style.cssText =
      'position:absolute;z-index:2147483647;display:none;gap:2px;align-items:center;' +
      'padding:4px;border-radius:8px;background:#101014;color:#e9e9ec;' +
      'box-shadow:0 6px 20px rgba(0,0,0,.35);font:12px system-ui;';

    box.append(
      button('B', 'format.bold', () => format('bold')),
      button('I', 'format.italic', () => format('italic')),
      button('U', 'format.underline', () => format('underline')),
      button('A-', 'format.smaller', () => resize('0.85em')),
      button('A+', 'format.bigger', () => resize('1.35em'))
    );

    for (const color of paletteOf()) {
      const dot = button(' ', 'format.color', () => format('foreColor', color));
      // 기본 버튼은 `all:unset` 이라 display 가 inline 이고 좌우 패딩이 남는다.
      // 그대로 두면 width·height 가 먹지 않아 옆으로 퍼진 타원이 된다.
      dot.style.cssText +=
        'display:block;padding:0;width:12px;height:12px;border-radius:50%;' +
        `background:${color};box-shadow:inset 0 0 0 1px rgba(255,255,255,.35);`;
      box.append(dot);
    }
    box.append(button('✕', 'format.clear', () => format('removeFormat')));
    return box;
  };

  const hideBar = (): void => {
    saved = null;
    if (bar) bar.style.display = 'none';
  };

  /** 고른 글자 위에 막대를 놓는다. 고른 것이 없으면 감춘다 */
  const placeBar = (): void => {
    const sel = getSelection();
    const el = editingId === null ? null : elementFor(editingId);
    // 시작과 끝 모두 편집 중인 블록 안이어야 한다. 시작만 보면 이웃 블록까지 걸친
    // 선택으로도 막대가 떠서, 서식이 추적되지 않는 이웃까지 바꾼다 (대원칙 2).
    const inside =
      el &&
      sel &&
      sel.rangeCount > 0 &&
      !sel.isCollapsed &&
      el.contains(sel.anchorNode) &&
      el.contains(sel.focusNode);
    if (!inside) {
      // 막대를 누르는 중이 아니라면 사용자가 선택을 떠난 것이다. 들고 있던 범위도
      // 버린다 — 남겨 두면 다음 Ctrl+B 가 옛 글자에 걸린다.
      if (!barHeld) saved = null;
      if (bar) bar.style.display = 'none';
      return;
    }

    if (!bar) {
      bar = buildBar();
      // 블록 밖에 둔다. <body> 자체가 블록인 문서에서 body 에 붙이면 막대가 편집 중인
      // 블록의 자식이 되고, 확정이 읽는 innerHTML 에 편집기 버튼이 통째로 실려
      // 저장본에 들어간다 (INV-9). <html> 은 head·body 를 품어 블록이 될 수 없다.
      document.documentElement.appendChild(bar);
    }
    // 막대를 누르는 사이 선택이 풀릴 수 있다. 지금 들고 있어야 그때 되살릴 것이 있다.
    saved = sel.getRangeAt(0).cloneRange();
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    bar.style.display = 'flex';
    // 막대를 그린 뒤라야 크기를 안다. 문서 좌표로 옮겨 스크롤해도 따라가게 한다.
    const top = rect.top + scrollY - bar.offsetHeight - 8;
    bar.style.top = `${Math.max(scrollY + 4, top)}px`;
    bar.style.left = `${Math.max(4, rect.left + scrollX)}px`;
  };

  on(document, 'selectionchange', () => placeBar());
  // 막대 밖에서 손을 떼도 "누르는 중" 이 남지 않게 문서 어디서든 내려놓는다.
  on(document, 'mouseup', () => {
    barHeld = false;
  });

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
    // 서식 막대는 문서가 아니라 우리 물건이다. 블록 밖 클릭으로 세면 누르는 순간 편집이 끝난다.
    if (e.target instanceof Element && e.target.closest(`[${BAR}]`)) {
      e.stopImmediatePropagation();
      return;
    }
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
    // Ctrl/⌘+B · I · U — 굵게 · 기울임 · 밑줄 (spec §4.1).
    // 브라우저에도 같은 기본 동작이 있지만 styleWithCSS 를 켜지 않아 <font> 를 남긴다.
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      const command =
        key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'u' ? 'underline' : '';
      if (command) {
        consume(e);
        format(command);
        return;
      }
    }
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

  on(document, 'focusout', (e) => {
    // 서식 막대로 포커스가 간 것은 편집을 끝낸 것이 아니다.
    const to = (e as FocusEvent).relatedTarget;
    if (to instanceof Element && to.closest(`[${BAR}]`)) return;
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
    const msg = e.data as {
      type?: string;
      ids?: number[];
      id?: number;
      html?: string;
      labels?: Record<string, string>;
    } | null;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'locked' && msg.ids) {
      locked.clear();
      for (const id of msg.ids) locked.add(id);
      // 잠금 표식을 DOM 에도 붙인다. 주입된 스타일이 이걸 보고 커서와 테두리를 바꾼다.
      // 매번 전체를 다시 칠한다 — 이전 목록이 남으면 풀린 블록이 잠긴 척한다.
      //
      // 화면에 글자가 보이는 자리에만 칠한다. 소스에도 화면에도 아무것도 없는 요소
      // (CSS 로 그린 막대 등)까지 금지 커서로 덮으면 문서가 통째로 "못 고침" 처럼 보인다.
      // 칠하지 않아도 잠금은 그대로라 눌러 보면 이유는 뜬다.
      for (const el of document.querySelectorAll('[' + MARKER + ']')) {
        const show = locked.has(Number(el.getAttribute(MARKER))) && (el.textContent ?? '').trim();
        if (show) el.setAttribute(LOCKED, '');
        else el.removeAttribute(LOCKED);
      }
    } else if (msg.type === 'labels' && msg.labels) {
      labels = msg.labels;
      // 언어를 바꾸면 이미 그려 둔 막대도 함께 바뀌어야 한다.
      for (const el of bar?.querySelectorAll('[data-ne-label]') ?? []) {
        el.setAttribute('title', labels[el.getAttribute('data-ne-label') ?? ''] ?? '');
      }
    } else if (msg.type === 'reveal' && typeof msg.id === 'number') {
      const el = elementFor(msg.id);
      if (el) {
        // 아티팩트가 슬라이드를 감추고 있으면 스크롤만으로는 보이지 않는다.
        // 그 자리로 데려가는 것까지가 우리 몫이고, 무엇을 보여줄지는 아티팩트가 정한다.
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        // 스크롤만 하면 어디가 그 블록인지 알 수 없다. 잠깐 짚었다가 지운다.
        // 앞서 짚어둔 것을 먼저 지운다 — 타이머만 갈아 끼우면 그 표시가 영영 남는다.
        clearReveal();
        el.setAttribute(REVEALED, '');
        revealed = el;
        revealTimer = setTimeout(clearReveal, 1200);
      }
    } else if (msg.type === 'revert' && typeof msg.id === 'number') {
      const el = elementFor(msg.id);
      if (el) el.innerHTML = msg.html ?? '';
    }
  }) as EventListener);

  /** `rgb()`/`rgba()` 를 [r, g, b, a] 로 뜯는다. 색이 아니면 null */
  const colorOf = (value: string): [number, number, number, number] | null => {
    const m = /^rgba?\(([^)]+)\)/.exec(value);
    if (!m?.[1]) return null;
    const [r, g, b, a = 1] = m[1].split(',').map(Number);
    if (r === undefined || g === undefined || b === undefined || Number.isNaN(a)) return null;
    return [r, g, b, a];
  };

  /**
   * 블록 뒤에 실제로 깔린 배경의 밝기를 재서 어두우면 표식을 붙인다.
   * 주입된 스타일이 이걸 보고 테두리를 흰색/검은색 중에 고른다.
   *
   * 문서 단위가 아니라 블록 단위다. 어두운 바탕에 밝은 카드를 얹는 구성이 흔한데,
   * 문서 하나로 정하면 카드 안 블록의 표시가 통째로 안 보인다.
   *
   * 반투명 배경은 제 색만 읽으면 안 된다 — `rgba(0,0,0,.1)` 은 흰 바탕에서는 사실상
   * 흰색인데 검은 값만 보고 어둡다고 하면 표시가 배경에 묻힌다. 불투명한 배경을 만날
   * 때까지 모아, 그 위에 합성한 색으로 잰다 (spec §4 · 시각 표시).
   */
  const paintContrast = (): void => {
    for (const el of document.querySelectorAll<HTMLElement>('[' + MARKER + ']')) {
      const layers: [number, number, number, number][] = [];
      let node: HTMLElement | null = el;
      while (node) {
        const color = colorOf(getComputedStyle(node).backgroundColor);
        if (color && color[3] > 0) {
          layers.push(color);
          // 불투명을 만나면 그 아래는 보이지 않는다.
          if (color[3] >= 1) break;
        }
        node = node.parentElement;
      }
      // 끝까지 투명했으면 브라우저 기본값인 흰 바탕이 깔린다. 그 위에 바깥 색부터 얹는다.
      let r = 255;
      let g = 255;
      let b = 255;
      for (let i = layers.length - 1; i >= 0; i--) {
        const [lr, lg, lb, a] = layers[i] as [number, number, number, number];
        r = a * lr + (1 - a) * r;
        g = a * lg + (1 - a) * g;
        b = a * lb + (1 - a) * b;
      }
      if (0.2126 * r + 0.7152 * g + 0.0722 * b < 128) el.setAttribute(DARK, '');
      else el.removeAttribute(DARK);
    }
  };

  /** 렌더 결과의 실제 텍스트를 모아 호스트로 보낸다 (ADR-005 대조용) */
  const scan = (): void => {
    const blocks: { id: number; text: string }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('[' + MARKER + ']')) {
      blocks.push({ id: idOf(el), text: el.textContent ?? '' });
    }
    // 아티팩트 CSS 와 스크립트가 색을 다 칠한 뒤라야 제대로 잰다.
    paintContrast();
    post({ type: 'ready', blocks });
  };

  // 아티팩트의 load 핸들러(DOM 재구성 등)가 끝난 뒤에 훑어야 한다.
  // 우리가 먼저 등록되므로 setTimeout 으로 한 틱 미룬다.
  on(window, 'load', () => setTimeout(scan, 0));
  if (document.readyState === 'complete') setTimeout(scan, 0);

  return () => {
    clearReveal();
    bar?.remove();
    bar = null;
    for (const { target, type, fn } of bound) target.removeEventListener(type, fn);
  };
}
