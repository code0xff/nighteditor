/**
 * The editing agent that runs inside the iframe.
 *
 * **It must be a self-contained function** (ADR-007). No imports, no references
 * to outer scope. The host stringifies it with `previewAgent.toString()` and
 * injects it at the very front of the document. That is why constants like
 * `data-ne-id` are written out again here — they must match core/markers.ts,
 * and agent.test.ts catches any drift.
 *
 * @param token This preview document's token. The iframe is reused, so
 *   `contentWindow` identity cannot tell documents apart — every message carries
 *   this token so the host can drop messages from an old preview that arrive
 *   after switching documents (spec §5).
 * @returns A function that removes every listener the agent attached. Called
 *   when opening another file.
 */
export function previewAgent(token = ''): () => void {
  const MARKER = 'data-ne-id';
  const LOCKED = 'data-ne-locked';
  const DARK = 'data-ne-dark';
  const REVEALED = 'data-ne-revealed';
  const BAR = 'data-ne-bar';

  /** Cap the color swatches here. Any more and picking becomes work of its own */
  const MAX_COLORS = 10;

  // Must be removable. If a previous agent lingers when another file is opened,
  // it intercepts events with stale state and disrupts editing in the new document.
  const bound: { target: EventTarget; type: string; fn: EventListener }[] = [];
  const on = (target: EventTarget, type: string, fn: EventListener): void => {
    target.addEventListener(type, fn);
    bound.push({ target, type, fn });
  };
  const post = (msg: Record<string, unknown>): void => {
    // Attach the document's token to every message (spec §5). Calling without a
    // token happens only where none is needed (the test harness) — then the
    // message goes out as is.
    parent.postMessage(token ? { ...msg, token } : msg, '*');
  };

  let editingId: number | null = null;
  /**
   * **The element** being edited. Commit and restore never look it up again by
   * id — if the document (or an artifact script) mimics a `data-ne-id` with the
   * same id, querySelector returns the impostor earlier in the document, and the
   * impostor's content gets saved as this block's edit (spec §3).
   */
  let editingEl: HTMLElement | null = null;
  /** innerHTML at the moment editing opened. Used for Escape restore and the pristine check. */
  let snapshot: string | null = null;
  let composing = false;
  /** When to clear the reveal highlight. Picking again cancels the previous one */
  let revealTimer: ReturnType<typeof setTimeout> | null = null;
  let revealed: HTMLElement | null = null;
  /** The formatting bar, and the selection range kept alive while pressing it */
  let bar: HTMLElement | null = null;
  let saved: Range | null = null;
  /**
   * Whether the bar is being pressed. A selection that collapses during the
   * press is not the user leaving, so keep `saved`; if the selection collapses
   * anywhere else, drop `saved` too — keeping it would make the next Ctrl+B
   * land on the old text instead of the current pick (spec §4.1).
   */
  let barHeld = false;
  /** Whether a commit was deferred because composition is in progress */
  let pendingCommit = false;
  /**
   * Sequence numbers of flush requests that arrived while a commit was deferred
   * and were deferred along with it (spec §4). The reply (flushed) means "every
   * pending commit has been sent" — replying before the deferred commit would
   * make the host assume it is current and swap the document, losing the
   * characters being composed.
   */
  const pendingFlush: number[] = [];
  /** Send the deferred flush replies now — the deferred commit went out (commit) or was dropped (cancel) */
  const answerFlushes = (): void => {
    for (const seq of pendingFlush.splice(0)) post({ type: 'flushed', seq });
  };
  const locked = new Set<number>();
  /**
   * Every real block id the host announced. The document can mimic `data-ne-id`
   * (spec §3), so a marker not on this roster does not count as a block — if
   * editing opened on an impostor, its commit would belong to no block and
   * vanish silently. null means the roster has not arrived yet.
   */
  let known: Set<number> | null = null;
  /**
   * id → **the elements** captured at verification. The roster (known) screens
   * numbers only, so a script that inserts another element with the same number
   * after verification passes the number check — clicking that impostor and
   * committing would save the impostor's content into the real block's slot
   * (spec §3). An element that is not the one remembered here does not count as
   * a block even when the number matches. null means no scan yet.
   *
   * When several elements were scanned under the same id, keep **all** of them
   * (spec §3). The host locks the clash as MARKER_CLASH; keeping only the first
   * would drop the rest (usually the real block) from block detection — clicks
   * on them would leak to the artifact handler without any lock notice.
   */
  let verifiedEl: Map<number, HTMLElement[]> | null = null;
  /**
   * Whether verification (ADR-005) finished and the lock list arrived. No edit
   * opens before that — an edit opened earlier is erased from the save the
   * moment verification locks that block, splitting the screen from the saved
   * file, and with the locks still unknown, editing could open even on locked
   * blocks (spec §4).
   */
  let verified = false;

  /**
   * Record the document's real markers, id → elements. Duplicate ids are not
   * discarded — the host locks the clash as MARKER_CLASH, but the lock notice
   * and click blocking must reach **every** clashing element (spec §3). Keeping
   * only the first would let clicks on the rest flow to the artifact handler
   * without notice.
   */
  const snapshotMarkers = (): Map<number, HTMLElement[]> => {
    const map = new Map<number, HTMLElement[]>();
    for (const el of document.querySelectorAll<HTMLElement>('[' + MARKER + ']')) {
      // A marker inside another marker is a mimic — real blocks never nest (spec §3).
      if (mimicked(el)) continue;
      const id = Number(el.getAttribute(MARKER));
      const seen = map.get(id);
      if (seen) seen.push(el);
      else map.set(id, [el]);
    }
    return map;
  };

  /**
   * Never re-query the document by id — if a mimic (spec §3) sits earlier in
   * the document, querySelector returns the impostor first, and restore/reveal
   * touch the impostor.
   */
  const elementFor = (id: number): HTMLElement | null =>
    verifiedEl
      ? (verifiedEl.get(id)?.[0] ?? null)
      : document.querySelector<HTMLElement>('[' + MARKER + '="' + id + '"]');

  /** Clear the reveal highlight */
  const clearReveal = (): void => {
    if (revealTimer !== null) clearTimeout(revealTimer);
    revealTimer = null;
    revealed?.removeAttribute(REVEALED);
    revealed = null;
  };

  /** A marker nested inside another marker — real blocks never nest, so the document mimicked it (spec §3) */
  const mimicked = (el: Element): boolean => !!el.parentElement?.closest('[' + MARKER + ']');

  /**
   * Walk up from the event target to find an ancestor carrying a marker.
   *
   * Markers not on the roster (known) and markers nested inside other markers
   * are mimics — keep climbing past them so the click flows to the real block
   * outside, or to the document (spec §3). Before the roster arrives (before
   * verification), treat any marker as a block and route it to the "not ready
   * yet" notice.
   */
  const blockOf = (target: EventTarget | null): HTMLElement | null => {
    let el = target instanceof Element ? target : null;
    while (el) {
      if (el.hasAttribute(MARKER) && !mimicked(el)) {
        const id = Number(el.getAttribute(MARKER));
        // The number alone is not enough — an element inserted after
        // verification with the same number passes the roster check. Only **the
        // element** captured at verification is a block (spec §3).
        // Elements scanned under a clashing id all count as blocks — whichever
        // is clicked goes to the lock notice (MARKER_CLASH), and the click
        // never leaks to the artifact handler.
        if (
          (verifiedEl === null || (verifiedEl.get(id)?.includes(el as HTMLElement) ?? false)) &&
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

  /** Commit the edit and send the result to the host */
  const commit = (): void => {
    if (editingId === null) return;
    // Never commit mid-composition. Defer it and finish in compositionend.
    // Just skipping would lose the whole edit when focus leaves mid-composition.
    if (composing) {
      pendingCommit = true;
      return;
    }
    // Never re-find by id — a mimic earlier in the document (spec §3) would be caught first.
    const el = editingEl;
    if (el) {
      el.removeAttribute('contenteditable');
      el.removeAttribute('enterkeyhint');
      // Last line of defense (INV-9): an artifact script may have churned the
      // DOM and moved the bar inside the block. Preview furniture must not leak
      // into the save via innerHTML, so move it back outside before reading.
      if (bar && el.contains(bar)) document.documentElement.appendChild(bar);
      // Compare against what the browser serialized. Comparing against the
      // source string would patch untouched blocks over normalization
      // differences like <br/> → <br>.
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
    // Send any deferred flush replies now — the commit (edit) went out first
    // above, so by the time this reply lands, the host's store knows the edit.
    answerFlushes();
  };

  /** Drop the edit and restore the content from before it opened */
  const cancel = (): void => {
    if (editingId === null) return;
    // Same reason as commit — re-finding by id would catch a mimic first (spec §3).
    const el = editingEl;
    if (el) {
      el.removeAttribute('contenteditable');
      el.removeAttribute('enterkeyhint');
      // Same defense as commit: an artifact script may have moved the bar
      // inside the block. Restoring innerHTML with the bar inside detaches it
      // from the DOM while the reference (bar) survives, so the next selection
      // neither rebuilds nor re-attaches it — the formatting bar is gone for
      // the rest of the session. Spirit it out of the block before restoring.
      if (bar && el.contains(bar)) document.documentElement.appendChild(bar);
      if (snapshot !== null) el.innerHTML = snapshot;
    }
    editingId = null;
    editingEl = null;
    snapshot = null;
    pendingCommit = false;
    hideBar();
    post({ type: 'select', id: null });
    // A dropped edit has no commit to send — no reason to hold the deferred flush replies either.
    answerFlushes();
  };

  const startEdit = (el: HTMLElement): void => {
    const id = idOf(el);
    // A click before verification finishes opens nothing; only report the
    // situation (spec §4 · Principle 3).
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
    // If composition deferred the commit, the previous edit is still open.
    // Opening a new one here would leave the previous block contenteditable.
    if (editingId !== null) return;
    editingId = id;
    editingEl = el;
    snapshot = el.innerHTML;
    el.setAttribute('contenteditable', 'true');
    // Name the return key on a virtual keyboard. It commits and closes the
    // block (Principle 4), so a key labelled "new line" would promise the one
    // thing it does not do. Like contenteditable, this sits on the element and
    // never on the innerHTML the commit reads (INV-9).
    el.setAttribute('enterkeyhint', 'done');
    el.focus();
    post({ type: 'select', id });
  };

  // --- Inline formatting (spec §4.1) -----------------------------------

  /**
   * Apply a formatting command.
   *
   * Set `styleWithCSS` **per command**. Setting it once would silently produce
   * different markup whenever something flips it elsewhere.
   *
   * - Off: bold, italic, underline come out as `<b>` `<i>` `<u>`. Better for a
   *   human-readable diff and matches the markup the document already uses
   * - On: color and size come out as `<span style>`. Off would produce `<font>`,
   *   and once that tag creeps in, the whole paragraph becomes uneditable the
   *   next time this file is opened
   */
  const CSS_COMMANDS = new Set(['foreColor', 'fontSize', 'backColor', 'hiliteColor']);

  const format = (command: string, value?: string): void => {
    if (editingId === null) return;
    const el = editingEl;
    if (!el) return;

    // The selection may have collapsed while the bar was pressed. Revive the
    // held range. Move it to a local first — if removeAllRanges fires
    // selectionchange synchronously, placeBar clears saved inside it and the
    // range to revive slips out of our hands.
    const restore = saved;
    if (restore) {
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(restore);
    }
    el.focus();
    // Do not apply when the selection reaches beyond this block into a
    // neighbor. execCommand changes the neighbor too, but the commit message
    // covers only the block being edited, so the neighbor's change would go
    // untracked and vanish from the save (Principle 2).
    const range = getSelection()?.rangeCount ? getSelection()?.getRangeAt(0) : null;
    if (!range || !el.contains(range.startContainer) || !el.contains(range.endContainer)) return;
    document.execCommand('styleWithCSS', false, String(CSS_COMMANDS.has(command)));
    document.execCommand(command, false, value);
    saved = getSelection()?.rangeCount ? (getSelection()?.getRangeAt(0) ?? null) : null;
    placeBar();
  };

  /** Is this the keyword value the `fontSize` command makes (execCommand's 7 = xxx-large) */
  const isBig = (node: HTMLElement): boolean =>
    node.style.fontSize === 'xxx-large' || node.style.fontSize === '-webkit-xxx-large';

  /**
   * Does the range cover every (non-empty) character of the element?
   *
   * Measure by **character positions**, not element boundaries — by boundary
   * points, (span,0) and (first char,0) look like the same spot on screen yet
   * compare differently because of structural order, so a range covering all of
   * the element's text would still come out as "outside".
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

  /** An ancestor containing the range that already carries the value. The block itself and marker elements are not split targets */
  const bigHostOf = (range: Range, el: HTMLElement): HTMLElement | null => {
    let node: Node | null = range.commonAncestorContainer;
    while (node && node !== el) {
      if (node instanceof HTMLElement && isBig(node) && !node.hasAttribute(MARKER)) return node;
      node = node.parentNode;
    }
    return null;
  };

  /**
   * When only **part** of an already-sized run (host) is selected — the command
   * makes nothing because that size is already applied. Split the host at the
   * selected range and write the new multiplier on just the selected part. The
   * unselected parts stay in shells that keep the original value (Principle 2).
   */
  const splitResize = (host: HTMLElement, range: Range, times: string): void => {
    // Extract the selected part. Afterwards the range sits collapsed in the gap.
    const picked = range.extractContents();
    // Extract what follows the gap too — host keeps only what precedes the selection.
    const tail = document.createRange();
    tail.selectNodeContents(host);
    tail.setStart(range.startContainer, range.startOffset);
    const rest = tail.extractContents();

    // The look (color and other inline styles) rides in shells cloned straight
    // from host. The id is not inherited — the document would end up with two
    // of the same id.
    const shell = (frag: DocumentFragment): HTMLElement => {
      const s = host.cloneNode(false) as HTMLElement;
      s.removeAttribute('id');
      s.appendChild(frag);
      return s;
    };
    const mid = shell(picked);
    mid.style.fontSize = times;
    host.parentNode?.insertBefore(mid, host.nextSibling);
    // A "hollow" fragment holds nothing but empty text nodes — judging by
    // textContent and elements alone would read a fragment of non-text nodes
    // (comments) as empty, and a comment the user never selected would vanish
    // from the save (Principles 1·2).
    const hollow = (node: Node): boolean => {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType !== Node.TEXT_NODE || (child.nodeValue ?? '').length > 0) return false;
      }
      return true;
    };
    // Never build a shell from a hollow fragment — empty elements would appear
    // in untouched structure and the diff would exceed the user's edit (Principle 2).
    if (!hollow(rest)) mid.parentNode?.insertBefore(shell(rest), mid.nextSibling);
    if (hollow(host)) host.remove();

    // Reselect the changed part — the bar follows, and consecutive commands
    // land on the same text.
    const sel = getSelection();
    const r = document.createRange();
    r.selectNodeContents(mid);
    sel?.removeAllRanges();
    sel?.addRange(r);
    placeBar();
  };

  /**
   * Sizes are written as multipliers.
   *
   * What `fontSize` makes is an absolute keyword like `x-large`. Artifacts
   * differ in base font size, so hardcoding an absolute value clashes with the
   * document's size system. After the command runs, rewrite the value as **a
   * multiple of the original size**.
   *
   * What to rewrite is chosen by **the selected range**, not by value
   * (spec §4.1). Choosing by value ("anything already that value before the
   * command belongs to the original") fails when the selected range itself is
   * already that value — a spot where the original used xxx-large — because the
   * command makes no new node and A-/A+ does nothing at all. Anything fully
   * inside the range is text the user asked to resize, whether the command made
   * it or the original had it; anything outside is the original's and stays
   * untouched.
   */
  const resize = (times: string): void => {
    if (editingId === null) return;
    const el = editingEl;
    if (!el) return;

    format('fontSize', '7');

    // The selection after the command — whatever the command made and however,
    // this is where the user asked for the change. Re-check the same fence as
    // format. If format backed out without doing anything (the range left the
    // block), back out here too, so we never clean up after a command that was
    // never applied.
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
    // If the range covers only part of an already-sized run, both the command
    // and the sweep above miss it. Split and write.
    if (!touched) {
      const host = bigHostOf(range, el);
      if (host) splitResize(host, range, times);
    }
    commitLater();
  };

  /** Formatting is a command, not typing, so the input event comes late. focusout does the commit */
  const commitLater = (): void => {
    saved = getSelection()?.rangeCount ? (getSelection()?.getRangeAt(0) ?? null) : null;
  };

  /**
   * Collect **the colors this document uses for text**, most used first.
   *
   * Handing out colors of our own choosing overrides the color system the
   * document already has. An artifact carries its own palette, and bringing in
   * a red it never had is not fixing — it is redesigning. The usable colors
   * are already inside the document.
   *
   * Count only elements that carry text — the color of an empty box never
   * appeared on screen.
   *
   * Colors that look the same are folded into one. `rgb(233,233,236)` and
   * `rgb(230,230,233)` are two different computed values, yet in a 12px dot
   * they cannot be told apart — a choice you cannot distinguish is no choice.
   */
  const paletteOf = (): string[] => {
    const used = new Map<string, number>();
    // Sweep from body itself — in a document where the text sits directly under
    // <body> and the color is set on body, querySelectorAll('*') skips body and
    // not a single color comes out (spec §4.1).
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

    // Take the most used first, skipping any that looks the same as one already taken.
    const palette: string[] = [];
    for (const [color] of [...used.entries()].sort((a, b) => b[1] - a[1])) {
      if (palette.length >= MAX_COLORS) break;
      if (!palette.some((kept) => alike(kept, color))) palette.push(color);
    }
    return palette;
  };

  /**
   * Do two colors look the same?
   *
   * The eye is most sensitive to green and least to blue — comparing channels
   * as-is would call two colors differing only in blue different. Measure with
   * the common weighted distance.
   * Alpha is ignored. Translucent text blends with whatever lies behind it, so
   * it cannot be judged here, and formatting inserts colors opaque anyway.
   */
  const alike = (a: string, b: string): boolean => {
    const one = colorOf(a);
    const two = colorOf(b);
    if (!one || !two) return a === b;
    const [r1, g1, b1] = one;
    const [r2, g2, b2] = two;
    const distance = Math.sqrt(2 * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + 3 * (b1 - b2) ** 2);
    // Where 12px dots start to look distinct. Set it too high and the
    // document's accent colors get folded together.
    return distance < 24;
  };

  /**
   * Labels for the bar. The host hands them over from the language pack
   * (spec §1). Until they arrive, leave them empty — hardcoding one language
   * here would freeze that language in.
   */
  let labels: Record<string, string> = {};

  const button = (label: string, name: string, run: () => void): HTMLElement => {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.setAttribute('data-ne-label', name);
    el.title = labels[name] ?? '';
    // A finger is not a mouse pointer: the same 12px dot that is easy to click
    // is a coin toss to tap. Widen the targets where the pointer is coarse.
    const touch = matchMedia('(pointer: coarse)').matches;
    el.style.cssText =
      `all:unset;cursor:pointer;padding:${touch ? '6px 10px' : '2px 6px'};` +
      'border-radius:4px;font:600 12px/1.4 system-ui;';
    // Focus moving at the moment of the press would collapse the selection.
    // Block the default first.
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
    // Mark that the bar is being pressed. If the selection collapses now, saved
    // must survive so it can be revived right before the command. The release
    // side is document's mouseup — so the flag never lingers when the press
    // ends outside the bar.
    box.addEventListener('mousedown', () => {
      barHeld = true;
    });
    // Wrapping is what keeps the bar inside a phone-sized window. The palette
    // grows with the document's colors, so on one line it would be wider than
    // the screen — and a bar hanging off the right edge scrolls the document
    // sideways the moment it appears.
    box.style.cssText =
      'position:absolute;z-index:2147483647;display:none;gap:2px;align-items:center;' +
      'flex-wrap:wrap;max-width:calc(100vw - 16px);box-sizing:border-box;' +
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
      // The base button is `all:unset`, so display is inline and side padding
      // remains. Left that way, width/height would not apply and the dot
      // becomes a sideways-stretched oval.
      const size = matchMedia('(pointer: coarse)').matches ? 20 : 12;
      dot.style.cssText +=
        `display:block;padding:0;width:${size}px;height:${size}px;border-radius:50%;` +
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

  /** Place the bar over the selected text. Hide it when nothing is selected */
  const placeBar = (): void => {
    const sel = getSelection();
    const el = editingEl;
    // Both ends must sit inside the block being edited. Checking only the start
    // would float the bar over a selection spanning into a neighbor, and the
    // formatting would change untracked neighbors too (Principle 2).
    const inside =
      el &&
      sel &&
      sel.rangeCount > 0 &&
      !sel.isCollapsed &&
      el.contains(sel.anchorNode) &&
      el.contains(sel.focusNode);
    if (!inside) {
      // If the bar is not being pressed, the user has left the selection. Drop
      // the held range too — keeping it would make the next Ctrl+B land on
      // old text.
      if (!barHeld) saved = null;
      if (bar) bar.style.display = 'none';
      return;
    }

    if (!bar) {
      bar = buildBar();
      // Keep it outside the block. In a document where <body> itself is a
      // block, attaching to body makes the bar a child of the block being
      // edited, and the innerHTML the commit reads would carry the editor
      // buttons wholesale into the save (INV-9). <html> holds head and body,
      // so it can never be a block.
      document.documentElement.appendChild(bar);
    }
    // The selection may collapse while the bar is pressed. Hold it now so there
    // is something to revive then.
    saved = sel.getRangeAt(0).cloneRange();
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    bar.style.display = 'flex';
    // Only after the bar is drawn is its size known. Convert to document
    // coordinates so it follows when scrolling.
    const top = rect.top + scrollY - bar.offsetHeight - 8;
    bar.style.top = `${Math.max(scrollY + 4, top)}px`;
    // Clamp both edges. Selecting a word near the right side of a narrow window
    // would otherwise push the bar past the edge and widen the document.
    const room = document.documentElement.clientWidth - bar.offsetWidth - 8;
    bar.style.left = `${scrollX + Math.max(4, Math.min(rect.left, room))}px`;
  };

  on(document, 'selectionchange', () => placeBar());
  // Release "pressing" anywhere in the document, so the flag never lingers
  // when the press ends outside the bar.
  on(document, 'mouseup', () => {
    barHeld = false;
  });

  // --- Event interception (ADR-007) ---------------------------------------
  // Block at the bubble phase. Cutting at capture would keep the event from
  // reaching its target and the caret would never be placed. This script runs
  // at the very front of the document, so it registers before the artifact
  // and therefore runs first.

  // An event used to open or close editing must do that and nothing else.
  // Only stopping propagation would leave the default of <a href> or a label
  // intact, and the document would simply navigate away (spec §4).
  const consume = (e: Event): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  on(document, 'click', ((e: MouseEvent) => {
    // The formatting bar is ours, not the document's. Counting it as an
    // outside-the-block click would end editing the moment it is pressed.
    // Compare against **the object we built**, not the attribute (spec §3) —
    // if the document has an ancestor mimicking data-ne-bar, every click on
    // blocks inside it would be swallowed here and they could never be edited.
    if (bar && e.target instanceof Node && bar.contains(e.target)) {
      e.stopImmediatePropagation();
      return;
    }
    const el = blockOf(e.target);
    if (el) {
      startEdit(el);
      // Keep it from reaching the artifact's global click handlers (slide
      // navigation and the like). The caret was already placed on mousedown,
      // so blocking the default here is safe.
      consume(e);
      return;
    }
    // A click outside any block. If editing was open, consume the click as
    // "end editing" and stop. If not, let it through — blocking it would kill
    // the artifact's navigation outright and no other slide could be reached.
    const wasEditing = editingId !== null;
    commit();
    if (wasEditing) consume(e);
  }) as EventListener);

  on(document, 'keydown', ((e: KeyboardEvent) => {
    // Ctrl/⌘+S — block the browser's "save page" and ask the host to save.
    // Key events inside the iframe never climb to the host window, so hand
    // them over here. (The host has the same check. This function cannot load
    // modules, so it cannot be shared, ADR-007)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
      consume(e);
      // Mid-composition the character is not finalized yet. Do nothing and
      // let the input finish.
      if (composing || e.isComposing) return;
      // Commit the open edit first. Otherwise the save goes out missing what
      // was just edited.
      commit();
      post({ type: e.shiftKey ? 'downloadCopy' : 'save' });
      return;
    }
    // Ctrl/⌘+Z — hands off while editing. The browser's native undo already
    // reverses in-block typing precisely. Only outside editing does it become
    // "undo the last change" for the host (spec §4).
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
    // Ctrl/⌘+B · I · U — bold, italic, underline (spec §4.1).
    // The browser has the same defaults, but without styleWithCSS on they
    // leave <font> behind.
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
    // Enter commits the edit and closes it. A block is one unit (Principle 4),
    // so committing and leaving is needed far more often than inserting a line
    // break. Line breaks are Shift+Enter. Mid-composition it is the IME
    // finalize key, so leave it alone — blocking it makes characters
    // impossible to complete. (The line break it leaves behind is cleaned up
    // by beforeinput below)
    if (e.key === 'Enter' && !e.shiftKey && !composing && !e.isComposing) {
      commit();
      consume(e);
      return;
    }
    if (e.key === 'Escape') cancel();
    // While editing, keep arrow keys and space from leaking into artifact navigation.
    e.stopImmediatePropagation();
  }) as EventListener);

  // Block the line break a mid-composition Enter would leave behind.
  // That Enter is the IME finalize key, so its default cannot be blocked in
  // keydown — that would keep the character from completing. But let it through
  // and the browser inserts a line break along with the finalization, creating
  // a <div> inside <p> and shipping untouched structure in the patch. So cut it
  // at the input stage, not the key. A non-composition Enter never reaches here
  // — keydown above already consumed it. Shift+Enter is insertLineBreak, so it
  // is not caught — in-block line breaks still go in.
  //
  // It is also the **only** commit path on a phone. Virtual keyboards do not
  // reliably raise a usable keydown — many report every key as `Unidentified`
  // — so the return key would block the line break above and then do nothing
  // at all. The input stage names the intent whatever the keyboard did, so
  // commit here too when no composition is in flight (mid-composition it is the
  // IME's finalize key, and committing on it would end the edit a keystroke
  // early).
  on(document, 'beforeinput', ((e: InputEvent) => {
    if (editingId === null) return;
    if (e.inputType !== 'insertParagraph') return;
    e.preventDefault();
    if (!composing && !e.isComposing) commit();
  }) as EventListener);

  // Keep the artifact's swipe handlers from firing while editing.
  on(document, 'touchend', (e) => {
    if (editingId !== null) e.stopImmediatePropagation();
  });

  // --- IME (Hangul composition) -------------------------------------------
  // Never read the value mid-composition. Reflecting an intermediate state
  // breaks the jamo apart.
  on(document, 'compositionstart', () => {
    composing = true;
  });
  on(document, 'compositionend', () => {
    composing = false;
    // If focus left mid-composition and a commit was deferred, finish it now.
    if (pendingCommit) commit();
  });

  on(document, 'focusout', (e) => {
    // Focus moving to the formatting bar is not the end of editing. For the
    // same reason as clicks, compare against the object we built, not the
    // attribute (spec §3) — focus escaping into a mimicked data-ne-bar would
    // skip the commit and leave the edit open with neither commit nor cancel.
    const to = (e as FocusEvent).relatedTarget;
    if (bar && to instanceof Node && bar.contains(to)) return;
    // commit handles composition itself. Filtering here would leave
    // pendingCommit unset, losing the whole edit when focus escapes
    // mid-composition.
    commit();
  });

  // Paste drops formatting and inserts plain text only.
  on(document, 'paste', ((e: ClipboardEvent) => {
    if (editingId === null) return;
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text);
  }) as EventListener);

  // --- Talking to the host --------------------------------------------------
  on(window, 'message', ((e: MessageEvent) => {
    // Accept only what the host sent. If anyone could empty locked, the second
    // line of defense for INV-5 would fall.
    if (e.source !== parent) return;
    const msg = e.data as {
      type?: string;
      ids?: number[];
      all?: number[];
      id?: number;
      html?: string;
      labels?: Record<string, string>;
      seq?: number;
    } | null;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'locked' && msg.ids) {
      // The lock list only comes after verification ends — editing is accepted
      // from this signal on (spec §4).
      verified = true;
      locked.clear();
      for (const id of msg.ids) locked.add(id);
      // The roster of real block ids — markers not on it are the document's
      // mimics and do not count as blocks (spec §3).
      if (msg.all) known = new Set(msg.all);
      // The elements verification was based on are recorded by scan. If absent
      // (the rare order where the lock signal arrives without a scan), record
      // them now — elements inserted after this point are not blocks (spec §3).
      if (verifiedEl === null) verifiedEl = snapshotMarkers();
      // Mirror the lock marks onto the DOM. The injected style watches them to
      // switch cursor and outline. Repaint everything each time — leftovers
      // from a previous list would make unlocked blocks look locked.
      //
      // Paint only where text is visible on screen. Covering elements with
      // nothing in source or on screen (bars drawn with CSS, etc.) in a
      // forbidden cursor makes the whole document look uneditable. Unpainted
      // blocks stay locked all the same — clicking one still shows the reason.
      //
      // The paint targets are the elements captured at verification.
      // Re-querying the whole document would also paint mimics inserted since
      // — a mark on a mimic only clutters the screen, but this way there is no
      // place where painting can diverge from the roster the edit decisions
      // use (spec §3).
      // Paint every element scanned under a clashing id — painting only the
      // first would leave the rest (usually the real block) unmarked: locked,
      // yet looking editable.
      for (const [id, els] of verifiedEl) {
        for (const el of els) {
          const show = locked.has(id) && (el.textContent ?? '').trim();
          if (show) el.setAttribute(LOCKED, '');
          else el.removeAttribute(LOCKED);
        }
      }
    } else if (msg.type === 'labels' && msg.labels) {
      labels = msg.labels;
      // Changing the language must also update a bar that is already drawn.
      for (const el of bar?.querySelectorAll('[data-ne-label]') ?? []) {
        el.setAttribute('title', labels[el.getAttribute('data-ne-label') ?? ''] ?? '');
      }
    } else if (msg.type === 'reveal' && typeof msg.id === 'number') {
      const el = elementFor(msg.id);
      if (el) {
        // If the artifact keeps slides hidden, scrolling alone shows nothing.
        // Getting the user there is our job; what to show is the artifact's call.
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        // Scrolling alone does not say which block it was. Highlight briefly,
        // then clear. Clear any earlier highlight first — swapping only the
        // timer would leave that mark forever.
        clearReveal();
        el.setAttribute(REVEALED, '');
        revealed = el;
        revealTimer = setTimeout(clearReveal, 1200);
      }
    } else if (msg.type === 'revert' && typeof msg.id === 'number') {
      const el = elementFor(msg.id);
      if (el) el.innerHTML = msg.html ?? '';
    } else if (msg.type === 'flush' && typeof msg.seq === 'number') {
      // Commit the open edit now — the host asks before anything that would
      // lose edits (close, open, switch) (spec §4). The commit (edit) goes out
      // **first** on the same channel, so by the time this reply reaches the
      // host, the commit has already reached the store.
      commit();
      // Mid-composition, commit defers (pendingCommit). The reply means "every
      // pending commit has been sent" (spec §4); replying right here would make
      // the host assume it is current and swap the document, losing the
      // characters being composed — defer the reply too, and send it after the
      // deferred commit goes out (compositionend→commit) or the edit is dropped
      // (cancel). A preview whose composition never ends is handled by the
      // host's limit (FLUSH_TIMEOUT).
      if (pendingCommit) pendingFlush.push(msg.seq);
      else post({ type: 'flushed', seq: msg.seq });
    }
  }) as EventListener);

  /** Pick `rgb()`/`rgba()` apart into [r, g, b, a]. null if it is not a color */
  const colorOf = (value: string): [number, number, number, number] | null => {
    const m = /^rgba?\(([^)]+)\)/.exec(value);
    if (!m?.[1]) return null;
    const [r, g, b, a = 1] = m[1].split(',').map(Number);
    if (r === undefined || g === undefined || b === undefined || Number.isNaN(a)) return null;
    return [r, g, b, a];
  };

  /**
   * Measure the brightness of the background actually behind each block and
   * mark the dark ones. The injected style watches the mark to pick a white or
   * black outline.
   *
   * Per block, not per document. Dark pages with light cards on top are a
   * common layout, and one verdict for the whole document would make the marks
   * inside the cards invisible.
   *
   * A translucent background cannot be read from its own color — `rgba(0,0,0,.1)`
   * on a white page is effectively white, and judging by the black value alone
   * would call it dark and drown the mark in the background. Collect layers
   * until an opaque background appears and measure the color composited on top
   * of it (spec §4 · visual marks).
   */
  const paintContrast = (): void => {
    for (const el of document.querySelectorAll<HTMLElement>('[' + MARKER + ']')) {
      // A marker inside another marker is a mimic — attaching and removing the
      // contrast mark would ride the outer block's innerHTML into the save
      // (spec §3 · INV-9).
      if (mimicked(el)) continue;
      const layers: [number, number, number, number][] = [];
      let node: HTMLElement | null = el;
      while (node) {
        const color = colorOf(getComputedStyle(node).backgroundColor);
        if (color && color[3] > 0) {
          layers.push(color);
          // Below an opaque layer nothing shows through.
          if (color[3] >= 1) break;
        }
        node = node.parentElement;
      }
      // Transparent all the way up means the browser's default white page.
      // Composite onto it starting from the outermost color.
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

  /** Collect the rendered result's actual text and send it to the host (for ADR-005 verification) */
  const scan = (): void => {
    const blocks: { id: number; text: string }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('[' + MARKER + ']')) {
      // A marker inside another marker is a mimic — content, not a block
      // (spec §3). Using a different rule here than snapshotMarkers would make
      // the host's verification see the same id twice and lock the healthy
      // outer block as MARKER_CLASH. Non-nested duplicates of the same id
      // (side-by-side impostors) go in as they are; that verdict remains the
      // host's (core's) to make.
      if (mimicked(el)) continue;
      blocks.push({ id: idOf(el), text: el.textContent ?? '' });
    }
    // Record the elements verification is based on right now — what the host
    // checks are the elements of this moment, so an element inserted later
    // under the same number is not a block (spec §3).
    verifiedEl = snapshotMarkers();
    // Only after the artifact's CSS and scripts have painted everything does
    // the measurement come out right.
    paintContrast();
    post({ type: 'ready', blocks });
  };

  // The sweep must run after the artifact's load handlers (DOM reshaping and
  // the like) finish. We register first, so push it one tick with setTimeout.
  on(window, 'load', () => setTimeout(scan, 0));
  if (document.readyState === 'complete') setTimeout(scan, 0);

  return () => {
    clearReveal();
    bar?.remove();
    bar = null;
    for (const { target, type, fn } of bound) target.removeEventListener(type, fn);
  };
}
