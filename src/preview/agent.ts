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
  /**
   * 편집 중인 **그 요소**. 확정·복원 때 id 로 되찾지 않는다 — 문서(또는 아티팩트
   * 스크립트)가 같은 id 의 `data-ne-id` 를 흉내 내면 querySelector 가 문서 앞쪽의
   * 가짜를 먼저 돌려줘, 가짜의 내용이 이 블록의 편집으로 저장에 실린다 (spec §3).
   */
  let editingEl: HTMLElement | null = null;
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
  /**
   * 호스트가 알려준 실제 블록 id 전부. 문서가 `data-ne-id` 를 흉내 낼 수 있어(spec §3),
   * 이 명단에 없는 표식은 블록으로 치지 않는다 — 가짜에 편집이 열리면 그 확정은
   * 어느 블록의 것도 아니어서 조용히 사라진다. null 이면 아직 명단을 못 받았다.
   */
  let known: Set<number> | null = null;
  /**
   * 대조 때 훑은 id → **그 요소**. 명단(known)은 번호만 가려서, 스크립트가 대조
   * 뒤에 같은 번호의 요소를 하나 더 만들면 번호 검사는 통과한다 — 그 가짜를 눌러
   * 확정하면 가짜의 내용이 진짜 블록의 자리에 저장된다 (spec §3). 여기 기억해 둔
   * 그 요소가 아니면 번호가 맞아도 블록으로 치지 않는다. null 이면 아직 안 훑었다.
   */
  let verifiedEl: Map<number, HTMLElement> | null = null;
  /**
   * 대조(ADR-005)가 끝나 잠금 목록을 받았는가. 그 전에는 편집을 열지 않는다 —
   * 이때 연 편집은 대조가 그 블록을 잠그는 순간 저장에서 지워져 화면과 저장본이
   * 갈라지고, 어느 블록이 잠길지도 아직 몰라 잠긴 블록의 편집까지 열린다 (spec §4).
   */
  let verified = false;

  /**
   * 지금 문서의 진짜 표식들을 id → 요소로 적어 둔다. 같은 id 가 겹치면 첫 요소를
   * 남긴다 — 겹침은 호스트의 대조가 MARKER_CLASH 로 잠그므로 어차피 편집이 안 열린다.
   */
  const snapshotMarkers = (): Map<number, HTMLElement> => {
    const map = new Map<number, HTMLElement>();
    for (const el of document.querySelectorAll<HTMLElement>('[' + MARKER + ']')) {
      // 다른 마커 안의 마커는 흉내다 — 진짜 블록은 겹치지 않는다 (spec §3).
      if (mimicked(el)) continue;
      const id = Number(el.getAttribute(MARKER));
      if (!map.has(id)) map.set(id, el);
    }
    return map;
  };

  /**
   * id 로 문서를 다시 뒤지지 않는다 — 흉내(spec §3)가 문서 앞쪽에 있으면
   * querySelector 가 가짜를 먼저 돌려줘, 복원·짚기가 가짜에 닿는다.
   */
  const elementFor = (id: number): HTMLElement | null =>
    verifiedEl
      ? (verifiedEl.get(id) ?? null)
      : document.querySelector<HTMLElement>('[' + MARKER + '="' + id + '"]');

  /** 짚어둔 표시를 지운다 */
  const clearReveal = (): void => {
    if (revealTimer !== null) clearTimeout(revealTimer);
    revealTimer = null;
    revealed?.removeAttribute(REVEALED);
    revealed = null;
  };

  /** 다른 마커 안에 든 마커 — 진짜 블록은 겹치지 않으므로 문서가 흉내 낸 것이다 (spec §3) */
  const mimicked = (el: Element): boolean => !!el.parentElement?.closest('[' + MARKER + ']');

  /**
   * 이벤트 대상에서 위로 올라가며 마커가 붙은 조상을 찾는다.
   *
   * 명단(known)에 없는 표식과 다른 표식 안에 든 표식은 흉내다 — 멈추지 않고 계속
   * 올라가, 클릭이 바깥의 진짜 블록이나 문서로 흘러가게 한다 (spec §3). 명단을
   * 받기 전(대조 전)에는 어느 표식이든 블록으로 보고 "아직 준비 안 됨" 안내로
   * 흘려보낸다.
   */
  const blockOf = (target: EventTarget | null): HTMLElement | null => {
    let el = target instanceof Element ? target : null;
    while (el) {
      if (el.hasAttribute(MARKER) && !mimicked(el)) {
        const id = Number(el.getAttribute(MARKER));
        // 번호만으로는 모자란다 — 대조 뒤에 끼워 넣은 같은 번호의 요소는 명단
        // 검사를 통과한다. 대조 때 훑은 **그 요소**여야 블록이다 (spec §3).
        if (
          (verifiedEl === null || verifiedEl.get(id) === el) &&
          (known === null || known.has(id))
        ) {
          return el as HTMLElement;
        }
      }
      el = el.parentElement;
    }
    return null;
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
    // id 로 되찾지 않는다 — 흉내(spec §3)가 앞쪽에 있으면 가짜가 먼저 잡힌다.
    const el = editingEl;
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
    editingEl = null;
    snapshot = null;
    pendingCommit = false;
    hideBar();
    post({ type: 'select', id: null });
  };

  /** 편집을 버리고 열기 전 내용으로 되돌린다 */
  const cancel = (): void => {
    if (editingId === null) return;
    // commit 과 같은 이유 — id 로 되찾으면 흉내가 먼저 잡힌다 (spec §3).
    const el = editingEl;
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
    editingEl = null;
    snapshot = null;
    pendingCommit = false;
    hideBar();
    post({ type: 'select', id: null });
  };

  const startEdit = (el: HTMLElement): void => {
    const id = idOf(el);
    // 대조가 끝나기 전의 클릭은 편집을 열지 않고 사정만 알린다 (spec §4 · 대원칙 3).
    if (!verified) {
      post({ type: 'notReady' });
      return;
    }
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
    editingEl = el;
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
    const el = editingEl;
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

  /** `fontSize` 명령이 만드는 키워드 값인가 (execCommand 의 7 = xxx-large) */
  const isBig = (node: HTMLElement): boolean =>
    node.style.fontSize === 'xxx-large' || node.style.fontSize === '-webkit-xxx-large';

  /**
   * 요소의 (비어 있지 않은) 글자 전부가 범위 안에 드는가.
   *
   * 요소 경계가 아니라 **글자 자리**로 잰다 — 경계점으로 재면 (span,0) 과
   * (첫 글자,0) 처럼 눈에는 같은 자리가 구조 순서 때문에 다르게 판정되어,
   * 범위가 요소의 글자를 전부 덮고 있어도 "밖" 이 되어 버린다.
   */
  const coveredBy = (range: Range, node: HTMLElement): boolean => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let found = false;
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if ((t.nodeValue ?? '').length === 0) continue;
      found = true;
      const tr = document.createRange();
      tr.selectNodeContents(t);
      if (
        range.compareBoundaryPoints(Range.START_TO_START, tr) > 0 ||
        range.compareBoundaryPoints(Range.END_TO_END, tr) < 0
      ) {
        return false;
      }
    }
    return found;
  };

  /** 범위를 품은, 이미 그 값이 걸린 조상. 블록 자신과 마커 요소는 가르는 대상이 아니다 */
  const bigHostOf = (range: Range, el: HTMLElement): HTMLElement | null => {
    let node: Node | null = range.commonAncestorContainer;
    while (node && node !== el) {
      if (node instanceof HTMLElement && isBig(node) && !node.hasAttribute(MARKER)) return node;
      node = node.parentNode;
    }
    return null;
  };

  /**
   * 이미 그 값이 걸린 자리(host)의 **일부**를 골랐을 때 — 명령은 이미 그 크기라
   * 아무것도 만들지 않는다. 자리를 고른 범위에서 갈라 고른 부분만 새 배수로 적는다.
   * 고르지 않은 부분은 원래 값 그대로의 껍데기에 남는다 (대원칙 2).
   */
  const splitResize = (host: HTMLElement, range: Range, times: string): void => {
    // 고른 부분을 들어낸다. 들어내고 나면 range 는 그 틈에서 접혀 있다.
    const picked = range.extractContents();
    // 틈 뒤에 남은 부분도 들어낸다 — host 에는 고른 부분 앞만 남는다.
    const tail = document.createRange();
    tail.selectNodeContents(host);
    tail.setStart(range.startContainer, range.startOffset);
    const rest = tail.extractContents();

    // 겉모습(색 등 다른 인라인 스타일)은 host 그대로 물려받는 껍데기에 담는다.
    // id 는 물려받지 않는다 — 문서에 같은 id 가 둘이 된다.
    const shell = (frag: DocumentFragment): HTMLElement => {
      const s = host.cloneNode(false) as HTMLElement;
      s.removeAttribute('id');
      s.appendChild(frag);
      return s;
    };
    const mid = shell(picked);
    mid.style.fontSize = times;
    host.parentNode?.insertBefore(mid, host.nextSibling);
    // 글자도 요소도 없는 조각으로는 껍데기를 만들지 않는다 — 고치지 않은 구조에
    // 빈 요소가 생겨 diff 가 사용자의 편집 범위를 넘는다 (대원칙 2).
    if ((rest.textContent ?? '').length > 0 || rest.querySelector('*') !== null) {
      mid.parentNode?.insertBefore(shell(rest), mid.nextSibling);
    }
    if ((host.textContent ?? '').length === 0 && host.querySelector('*') === null) host.remove();

    // 고친 자리를 다시 골라 둔다 — 막대가 따라오고, 잇단 명령이 같은 글자에 걸린다.
    const sel = getSelection();
    const r = document.createRange();
    r.selectNodeContents(mid);
    sel?.removeAllRanges();
    sel?.addRange(r);
    placeBar();
  };

  /**
   * 크기는 배수로 적는다.
   *
   * `fontSize` 가 만드는 것은 `x-large` 같은 절대 키워드다. 아티팩트마다 본문 크기가
   * 달라 절대값을 박으면 그 문서의 크기 체계와 어긋난다. 명령이 지나간 뒤 그 값을
   * **원래 크기의 몇 배**로 고쳐 적는다.
   *
   * 고쳐 적을 자리는 값이 아니라 **고른 범위**로 가려낸다 (spec §4.1). 값으로 가려내면
   * ("명령 전에 이미 그 값이던 자리는 원본의 것") 고른 범위 자체가 이미 그 값일 때 —
   * 원본이 xxx-large 를 쓰던 자리 — 명령이 아무 노드도 새로 만들지 않아 A-/A+ 가
   * 아무 일도 하지 않는다. 범위 안에 온전히 든 자리는 명령이 만들었든 원본에 있었든
   * 사용자가 크기를 청한 글자고, 범위 밖은 원본의 것이라 건드리지 않는다.
   */
  const resize = (times: string): void => {
    if (editingId === null) return;
    const el = editingEl;
    if (!el) return;

    format('fontSize', '7');

    // 명령 뒤의 선택 범위 — 명령이 무엇을 어떻게 만들었든 이 안이 사용자가 청한 곳이다.
    // format 과 같은 울타리를 다시 확인한다. format 이 (범위가 블록을 벗어나) 아무것도
    // 하지 않고 물러났다면 여기서도 물러나야, 걸지 않은 명령의 뒷정리를 하지 않는다.
    const sel = getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    if (
      !range ||
      range.collapsed ||
      !el.contains(range.startContainer) ||
      !el.contains(range.endContainer)
    ) {
      return;
    }

    let touched = false;
    for (const node of el.querySelectorAll<HTMLElement>('[style*="font-size"]')) {
      if (isBig(node) && coveredBy(range, node)) {
        node.style.fontSize = times;
        touched = true;
      }
    }
    // 범위가 그 값 자리의 일부에만 걸쳐 있으면 명령도 위 훑기도 지나친다. 갈라서 적는다.
    if (!touched) {
      const host = bigHostOf(range, el);
      if (host) splitResize(host, range, times);
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
   *
   * 눈에 같아 보이는 색은 하나로 묶는다. `rgb(233,233,236)` 과 `rgb(230,230,233)` 은
   * 계산된 값이 달라 둘로 세지만 12px 짜리 동그라미에서는 구분되지 않는다 —
   * 고를 수 없는 선택지는 선택지가 아니다.
   */
  const paletteOf = (): string[] => {
    const used = new Map<string, number>();
    // body 자신부터 훑는다 — 글자가 <body> 바로 아래에 있고 색이 body 에 걸린 문서에서
    // querySelectorAll('*') 은 body 를 건너뛰어 색이 하나도 안 나온다 (spec §4.1).
    const body = document.body;
    const scope: HTMLElement[] = body ? [body, ...body.querySelectorAll<HTMLElement>('*')] : [];
    for (const el of scope) {
      const text = [...el.childNodes].some(
        (node) => node.nodeType === 3 && (node.nodeValue ?? '').trim().length > 0
      );
      if (!text) continue;
      const color = getComputedStyle(el).color;
      if (/^rgba?\(/.test(color)) used.set(color, (used.get(color) ?? 0) + 1);
    }

    // 많이 쓰인 것부터 담되, 이미 담은 것과 눈에 같으면 건너뛴다.
    const palette: string[] = [];
    for (const [color] of [...used.entries()].sort((a, b) => b[1] - a[1])) {
      if (palette.length >= MAX_COLORS) break;
      if (!palette.some((kept) => alike(kept, color))) palette.push(color);
    }
    return palette;
  };

  /**
   * 두 색이 눈에 같은가.
   *
   * 사람 눈은 초록에 가장 민감하고 파랑에 가장 둔하다 — 채널을 그대로 견주면 파랑만
   * 다른 두 색을 다르다고 판정해 버린다. 흔히 쓰는 가중 거리로 잰다.
   * 투명도는 보지 않는다. 반투명 글자는 뒤에 깔린 것과 섞여 보이므로 여기서 알 수 없고,
   * 어차피 서식으로 넣을 때는 불투명하게 들어간다.
   */
  const alike = (a: string, b: string): boolean => {
    const one = colorOf(a);
    const two = colorOf(b);
    if (!one || !two) return a === b;
    const [r1, g1, b1] = one;
    const [r2, g2, b2] = two;
    const distance = Math.sqrt(2 * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + 3 * (b1 - b2) ** 2);
    // 12px 동그라미에서 갈라 보이기 시작하는 지점. 넘치게 잡으면 문서의 강조색이 묶인다.
    return distance < 24;
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
    const el = editingEl;
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
    // 속성이 아니라 **우리가 만든 그 객체**와 견준다 (spec §3) — 문서에 data-ne-bar 를
    // 흉내 낸 조상이 있으면 그 안 블록의 클릭이 전부 여기서 삼켜져 영영 편집할 수 없다.
    if (bar && e.target instanceof Node && bar.contains(e.target)) {
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
    // 서식 막대로 포커스가 간 것은 편집을 끝낸 것이 아니다. 클릭과 같은 이유로
    // 속성이 아니라 우리가 만든 그 객체와 견준다 (spec §3) — 흉내 낸 data-ne-bar 로
    // 포커스가 빠지면 확정이 건너뛰어져 편집이 확정도 취소도 없이 열린 채 남는다.
    const to = (e as FocusEvent).relatedTarget;
    if (bar && to instanceof Node && bar.contains(to)) return;
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
      all?: number[];
      id?: number;
      html?: string;
      labels?: Record<string, string>;
    } | null;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'locked' && msg.ids) {
      // 잠금 목록은 대조가 끝난 뒤에만 온다 — 이 신호부터 편집을 받는다 (spec §4).
      verified = true;
      locked.clear();
      for (const id of msg.ids) locked.add(id);
      // 실제 블록 id 명단 — 여기 없는 표식은 문서의 흉내라 블록으로 치지 않는다 (spec §3).
      if (msg.all) known = new Set(msg.all);
      // 대조의 근거가 된 요소들은 scan 이 적어 둔다. 없으면(대조 신호가 훑기 없이
      // 온 드문 순서) 지금 적는다 — 이 뒤에 끼워 넣은 요소는 블록으로 치지 않는다 (spec §3).
      if (verifiedEl === null) verifiedEl = snapshotMarkers();
      // 잠금 표식을 DOM 에도 붙인다. 주입된 스타일이 이걸 보고 커서와 테두리를 바꾼다.
      // 매번 전체를 다시 칠한다 — 이전 목록이 남으면 풀린 블록이 잠긴 척한다.
      //
      // 화면에 글자가 보이는 자리에만 칠한다. 소스에도 화면에도 아무것도 없는 요소
      // (CSS 로 그린 막대 등)까지 금지 커서로 덮으면 문서가 통째로 "못 고침" 처럼 보인다.
      // 칠하지 않아도 잠금은 그대로라 눌러 보면 이유는 뜬다.
      //
      // 칠하는 대상은 대조 때 훑은 요소들이다. 문서 전체를 다시 뒤지면 그 사이
      // 끼워 넣은 흉내에도 표식을 칠하게 된다 — 흉내에 붙는 표식은 화면만 어지럽히지만,
      // 편집 판정과 같은 명단을 쓰는 쪽이 어긋날 자리가 없다 (spec §3).
      for (const [id, el] of verifiedEl) {
        const show = locked.has(id) && (el.textContent ?? '').trim();
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
      // 다른 마커 안의 마커는 흉내다 — 명암 표식을 붙였다 떼면 그 변화가 바깥 블록의
      // innerHTML 에 실려 저장본으로 샌다 (spec §3 · INV-9).
      if (mimicked(el)) continue;
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
    // 대조의 근거가 된 요소들을 지금 적어 둔다 — 호스트가 검사하는 것은 이 순간의
    // 요소들이라, 이 뒤에 같은 번호로 끼워 넣은 요소는 블록이 아니다 (spec §3).
    verifiedEl = snapshotMarkers();
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
