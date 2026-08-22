# Spec

## 1. Scope

### What it does
- Opens an HTML file and click-edits text block by block
- Saves the result as a minimal diff against the original (overwrite the original, or download a copy)
- Marks uneditable regions visually and, on click, says why
- Applies inline formatting to selected text — bold·italic·underline·color·size (§4.1)
- Per-block revert, revert all, undo of the last change
- Opens folders and zips to attach the resources sitting alongside (§5.1)
- Lets you pick which document to open when a bundle holds several (§5.1)
- Asks whether to save before anything that would lose edits (§4)
- Switches the UI language between Korean and English

### Target documents

**Any self-contained single-file HTML** qualifies. It was designed with Claude
artifacts in mind, and the lock rules came from analyzing that structure, but that
is the only functional assumption — neither the parser nor the patcher asks where a
document came from. That is why the screen copy says "a single HTML file", not
"artifact". Describing usable documents narrowly makes usable documents unusable.

Documents that reference external CSS, JS, or images kept alongside also open. Hand
over the resources and it renders as intended; withhold them and editing and saving
are still exact. The detailed rules are in §5.

### Document encoding — UTF-8, bytes as they are

Documents are **read from bytes, preserving a leading BOM.** UTF-8 decoding of the
`Blob.text()` kind silently strips a leading BOM (EF BB BF) — the first bytes of a
document nobody edited vanish from the saved output, violating core principles 1
and 2. Whether opened as a single file, as a zip or folder entry, or re-read from
disk, every path reads the same way. Line ending notation (CRLF) is a value decoding
never touches, so it survives wherever you did not edit — inside an edited block the
browser DOM normalizes `\r\n` to `\n`, but that happens within the unit of editing,
the block (core principles 2·4).

Documents that are not UTF-8 (EUC-KR, UTF-16 …) are **refused with a reason**
(core principle 3). Open them with U+FFFD substitutions and mojibake masquerades as
the document; saving then rewrites that garbage as UTF-8 and quietly destroys the
original. Failing to open beats quietly destroying.

### UI language

Korean and English are supported, and every piece of screen copy comes **from the
language pack only.** Buttons, lock reasons, save notices — no hard-coded strings
anywhere.

- The first visit defaults to the browser language (`ko*` → Korean, otherwise
  English); the choice persists in localStorage
- Switching applies immediately. Notices already on screen are redrawn in the new
  language — which is why the store keeps **message keys, not finished sentences**
- `<html lang>` is updated along with it (screen readers and spellcheckers read it)
- Error text thrown by the browser (File System Access API and the like) is appended
  verbatim, untranslated. A guessed translation destroys the clue that would find
  the cause (core principle 3)

The artifact being edited is not translation material. User documents are never touched.

### What it does not do (out of scope)
- **Layout** editing (spacing, alignment, width) and editing CSS files themselves
- Adding, deleting, or moving elements
- Image replacement
- Multi-file **editing** — files open together only to restore the preview; the one thing edited and saved is always a single HTML document
- Collaboration, accounts, cloud storage
- Languages beyond Korean and English; translating artifact content
- Authoring HTML from scratch

---

## 2. Editable-block detection

### The inline tag set
```
b, strong, span, br, small, i, em, a, code, u, sup, sub
```

### The detection algorithm
Walk from the root; for each element:

1. If any child is a **non-inline element** → not a block; recurse into the children
2. Otherwise, if it holds non-whitespace text (directly or inside inline descendants) → **editable block**
3. Neither → ignore

That is: a block is "the outermost element that holds text, containing nothing but
inline markup."

### Whether to descend into inline children

For an element that failed to become a block, its inline children split on
**whether the parent holds direct text.**

| Parent's direct text | Handling | Rationale |
|---|---|---|
| Present | Do **not** descend into inlines | `<div>text <a>link</a><p>para</p></div>` — the inline is part of a sentence. Promoting it splits one sentence apart |
| Absent | **Descend** into inlines | `<div><span class="codelabel">title</span><ul>…</ul></div>` — the inline is a free-standing label. Not descending leaves visible text uneditable |

In the measured artifact, 70 `span`s — including 28 `.codelabel`s — were the second
case. (They are declared `display:block` in the CSS.)

**Known limitation** — in an element that has both direct text and block children,
that direct text is not editable. The parent cannot become a block because of its
block children, and there is no boundary that could carve the text out on its own.

Measured artifact result: **867 blocks** (`div` 256, `td` 241, `p` 103, `li` 72, `span` 70, `h2` 43, `th` 42, `h3` 36, `button` 2, `title` 1, `h1` 1)

### 2.1 The `<title>` exception

`<title>` becomes a block under the rules above but **is not rendered in the
preview, so no click can reach it.** It is edited through a **dedicated input
field** at the top of the editor. Its patch path is identical to every other block.

An empty `<title></title>` is **an exception to the empty-leaf lock
(EMPTY_IN_SOURCE).** That lock exists because click-editing in the preview cannot
trace script-filled text back to the source — but the title field takes its value
from the source, not the live DOM, so that concern does not apply. Lock it here and
a document with an empty title has no way to ever get one.
A script-filled title is locked separately by the post-render comparison (ADR-005).

Constraint — `<title>` is RCDATA; no tags can live inside it.
It is treated as **plain text only**, and `&`·`<`·`>` are encoded as entities on
save. Typed tags are not rejected but escaped — `<b>` shows on screen as the
literal characters `<b>`.

### 2.2 Beware synthetic nodes

parse5, per spec, **inserts nodes that do not exist in the source.**
In the measured artifact, 13 tables got an auto-inserted `<tbody>`, and those nodes'
`sourceCodeLocation` is `null`. Always guard for null during traversal
(`rules.md` INV-7).

### What a block records
```ts
type Block = {
  id: number
  tag: string
  innerStart: number   // offset into the original string (after the opening tag's '>')
  innerEnd: number     // before the closing tag's '<'
  sourceInner: string  // original innerHTML, verbatim
  sourceText: string   // pure text with tags stripped (for the comparison check)
  locked: LockReason | null
}
```

---

## 3. Lock rules

Anything matching the following is locked against editing, with the reason exposed
in the UI (core principle 3).

| Lock reason | Decided at | Description |
|---|---|---|
| `RAW_TEXT` | parse | Inside `script`, `style`, `textarea` — excluded from traversal wholesale, never becomes a block |
| `SCRIPT_GENERATED` | post-render | Live `textContent` ≠ `sourceText` (ADR-005) |
| `EMPTY_IN_SOURCE` | parse | A leaf element empty in the source — a slot a script fills |
| `CODE_BLOCK` | parse | Hand-highlighted code/JSON region (locked by default, can be unlocked in settings) |
| `AMBIGUOUS` | parse | A closing tag is omitted, so the inner range cannot be pinned down (`<li>a<li>b`) |
| `MARKER_CLASH` | post-render | Two or more edit markers (`data-ne-id`) with the same id — the document mimics our marker, and which one is the real block cannot be traced |

`EMPTY_IN_SOURCE` means **a leaf element that is empty in the source**
(`<span class="pg"></span>`). When a script fills it, the screen shows text, but
that text exists nowhere in the source and cannot be traced back. Drop it from the
block list because "it has no text" and clicking it does **nothing at all** — with
no way to learn why. So it is captured as a block and locked (core principle 3).
The measured artifact's 40 `<span class="pg">` elements fell here.

Three conditions:

- The opening tag **and closing tag both exist** — otherwise it is a void element
  like `<br>`·`<img>` and content can never appear inside
- No child **elements** — with any, it is a container and traversal descends
- The inner source is whitespace only — an element holding just a comment
  (`<div><!-- here --></div>`) is not empty

The lock **indicator** is painted only where text is visible on screen. Covering
elements that show nothing in the source and nothing on screen (bars drawn by CSS
and the like) with a not-allowed cursor makes the whole document look uneditable.
Unpainted or not, the lock still holds — click and the reason still shows.

### The document can mimic our markers

The edit marker (`data-ne-id`) is something we inject into the preview document, but
user HTML may already carry the same attribute, and artifact scripts can add it at
runtime. The rules for that case:

- **If two or more markers share one id, lock that block as `MARKER_CLASH`** —
  rendering alone cannot tell which one is the original block, and a guessed fix
  saves a fake element's content as that block's edit (core principle 3). The lock
  path carries **all** clashing elements — every same-id element seen during the
  scan announces the lock reason on click, and the click does not leak to artifact
  handlers. Remember only the first, and clicks on the real element slip through to
  the document unannounced, flipping slides
- **Markers not on the real block id roster do not count as blocks.** The preview
  receives the full roster of real block ids along with the lock list; markers not
  on the roster are passed over, letting the click flow to the real block or the
  document beyond — an edit opened here would commit into no block at all and
  silently vanish
- **A marker inserted after the scan is also a mimic.** The roster names numbers
  only, so a script that mints another element with the same number after the scan
  passes the number check — commit on that fake and its content saves into the real
  block's place. The preview remembers the **id → element** pairing from scan time
  and rejects any other element even when the number matches. Restore (revert) and
  reveal also find elements through this pairing
- **A marker inside another marker is content.** Real blocks never nest (§2), so it
  is a mimic — no lock or dark-mode indicator is painted on it. Painting and then
  removing would ride the outer block's innerHTML into the saved output (INV-9)
- **Commit and restore use the element the edit opened on — they never re-find it
  by id.** Re-finding by id grabs the fake first whenever the mimic sits earlier in
  the document
- Mimics of the format bar (`data-ne-bar`), lock (`data-ne-locked`), dark
  (`data-ne-dark`), and reveal (`data-ne-revealed`) markers can only disturb the
  visuals — behavior decisions run on the objects and state we built, never on
  attribute strings

### Entities — the comparison trap

The `SCRIPT_GENERATED` decision must compare **decoded text on both sides.** Compare
raw source slices and every healthy block containing an entity is a false-positive
lock.

```
source slice : "Appendix B · Protocols &amp; Standards"
live text    : "Appendix B · Protocols & Standards"      ← looks different, same content
```

The measured artifact had exactly one entity, so this stayed invisible — but
artifacts heavy with code samples carry `&lt;` / `&gt;` / `&amp;` in bulk.
See `rules.md` INV-8.

### A script-filled sibling locks the parent block too

The comparison works on **block-level text.** So if a block contains even one empty
element that a script fills, the whole block locks as `SCRIPT_GENERATED`.

The measured artifact's 40 `.foot` elements fell here.

```html
<div class="foot"><span>에이전트 결제</span><span class="pg"></span></div>
```

`.pg` is empty in the source but **does not become a block** — when the parent holds
direct text, we do not descend into inline children (§2). Once a script fills in
`1 / 45`, `.foot`'s live text no longer matches the source, and as a result even the
`에이전트 결제` label on the left becomes uneditable.

This is intended — saying "can't edit this" beats editing it wrong (core
principle 3). Higher precision would require excluding `.pg`'s live text from the
comparison, which would require putting a marker on `.pg`. **We do not** — `.pg`
lives *inside* an editable block, and a marker inside a block rides the block's
`innerHTML` into the saved output the moment that block is edited (INV-3).

For the same reason, blocks never overlap. When an element becomes a block,
traversal stops there. The empty-element lock in §3 likewise catches only empty leaf
elements **outside** any block (`<div id="cnt"></div>`) — those are the ones nobody
would otherwise explain, while `.pg` has a parent to speak for it.

### Why code blocks lock by default
The measured artifact's JSON samples are hand-highlighted with
`<span class="h">` / `<span class="v">`, not `<pre>`. These fragments dominate the
duplicate-string ranking (`":"` 67 times, `","` 61 times).
Free editing would shatter the highlighting structure, so the default is locked.

---

## 4. User flow

```
1. Open              file · folder · zip · drop (acquire a File System Access API handle, §5.1)
2. Resources         if opened as a bundle, attach neighbors as blob URLs; if not attached, say so
3. Render            render the marker-injected copy in the iframe; artifact scripts run normally
4. Compare           source-vs-live check → locks finalized → visual state on blocks (below)
5. Edit              click → contenteditable on → modify → commit via blur/Enter/Esc
6. Review            the change list shows before/after, line by line
7. Save              save button or `Ctrl+S` → overwrite the original (fallback: download)
```

Before anything that would lose edits (opening another file · switching documents
within a bundle · linking a folder · **closing the document**), it asks whether to
save first (below · protecting unsaved edits).

### No edits open before the comparison finishes

Between render (3) and comparison (4) — while resources are loading — the preview is
already on screen. Accept an edit here and the comparison will match that block's
live text against the source, lock it as "written by a script", and the lock erases
the patch just created — the screen shows the fix, the saved output lacks it
(a violation of core principle 3). Nor is it knowable which blocks will lock before
the comparison — this is also the problem of an edit opening on a to-be-locked block.

So until the comparison finishes and the lock list arrives, **clicks do not open
edits**, and a toast says the document is still being checked (core principle 3).
The title field is locked for the same window.

If the comparison must nonetheless erase existing patches (an unexpected path), it
does not erase quietly — the preview is also restored to the source content so
screen and saved output line up again, and a toast says how many spots were
reverted. Leaving the screen and the saved output split is the one thing that never
happens.

### Artifact navigation must stay alive

Block all outside-the-block clicks and the artifact's own navigation dies. The
measured artifact advances slides on empty-area clicks; block that and you are
stuck on slide one with no way to edit the rest.

| Click target | Editing? | Handling |
|---|---|---|
| A block | Either | Open the edit; do not forward to the artifact; **suppress the default action too** |
| Outside a block | Yes | Consume as "close the edit"; do not forward to the artifact; **suppress the default action too** |
| Outside a block | No | **Pass through to the artifact** |

For the click that closes an edit, stopping propagation is not enough. If it landed
on an `<a href>` or a label, the browser default remains and the document navigates
away. **A click consumed by editing has its default action suppressed too** — that
click's one job is "close the edit".

### Visual state

If what is editable is not visible, users must discover it by trial clicks. Styles
injected into the preview show the state (`core/markers.ts` · `injectEditorStyle`).

| State | Indicator |
|---|---|
| Editable · hover | Translucent solid outline, cursor `text` |
| Editing | Solid outline + a very faint background |
| Locked · hover | **Dashed** outline, cursor `not-allowed` |

**The color follows the document's background** — white on dark, black on light.
Artifacts color themselves every which way; any fixed color sinks into some
documents' backgrounds and intrudes on others' palettes. Black-and-white is visible
everywhere and collides with nothing.

Brightness is judged **per block**. Decide it per document and the common
light-card-on-dark-page layout makes every block inside the card invisible. At scan
time the agent walks upward from the block collecting background colors and
measures brightness, tagging dark ones with `data-ne-dark`.
A translucent background must not be read alone — `rgba(0,0,0,.1)` on white is
effectively white. Colors are collected until an opaque background is found and
measured as composited onto it.

Only `outline` is used — `border` changes box size and shifts the artifact's
layout. To hold against artifact CSS, just these few lines carry `!important` —
including the `--ne-*` variable definitions the indicators read. Let the variables
be overridden and the `!important`-protected outlines vanish wholesale, following
the variable's value.
The lock marker (`data-ne-locked`) is attached to the DOM by the agent after the
comparison finishes, and each time the list updates it is repainted in full — stale
markers would leave unlocked blocks looking locked.

### On a narrow screen

The screen holds two things that each want most of the width: the preview and the
change list. Below `lg` (1024px) they cannot share it — 288px of list inside a
500px window leaves 212px of document, too little to read or to click a paragraph
in. So the list stops being a column and becomes a **panel over the preview**,
opened by a button in the header and closed by pressing beside it, or by pressing a
change card (which jumps to a spot the panel would be covering). From `lg` up
nothing changes: the list stands beside the preview and the button is not there
(ADR-012).

The header keeps only what you act with. Below `lg` every label drops away and the
controls stand as icons — the open buttons, the save button, the language picker,
and the bundle's document picker (its path stays in the tooltip). The file name and
the overwrite hint return only at `xl`, being the two things the screen already says
elsewhere. This is not only about looks: **a header wider than the window scrolls
the whole document sideways** the moment a popup inside it opens, and
`body { overflow: hidden }` then keeps it there. Nothing in the header may overflow
at any width — measured with a five-document bundle open, which is the widest the
header ever gets.

**The title field is not a control, so below `md` it is not in the header.** Fitted
there it comes out around 20px wide, which is a field in name only; it moves to the
top of the change list instead. One instance either way, never two — the label
points at an id, and two of those point at whichever came first.

Anything off-screen must also be **out of reach** — the closed panel is `inert`, so
it cannot be tabbed into from the preview.

Where the pointer is a finger, the empty screen stops saying "drag a file here":
nothing can be dragged onto a phone, and no folder can be picked there either (the
folder button already hides itself where the browser cannot open one). Telling
someone to do what their device cannot is worse than saying nothing (Principle 3).
Buttons in the preview's format bar grow for the same reason — a 12px color dot is
a coin toss to tap.

**A finger cannot hover**, so the editable/locked outlines (§4 · Visual state) never
appear on a phone until the edit is already open. Under `(hover: none)` the same
outlines are drawn on `:active` instead — press feedback is all that is left to say
"this one, and it is editable" before it happens. The lock notice on tapping a locked
block is unchanged, and is what keeps Principle 3 met there.

Notices span the width below `sm` rather than sitting at a fixed 320px, and the
on-screen keyboard shrinks the layout viewport (`interactive-widget=resizes-content`)
instead of sliding over it — otherwise it covers the bottom of the app, which is
where the block being edited usually is.

The format bar's held range (§4.1) is held by **a touch as well as a press**. A tap
produces emulated mouse events, but not dependably, and if the selection collapses
before one arrives the range to format is already gone. A touch ending **on the bar**
keeps the hold — its click has not run yet, and that click is what needs the range;
a touch ending anywhere else is the user leaving, and drops it.

### Editing interactions
- Click: only that block gets `contenteditable=true`; the rest are false
- `Enter`: **commit and close.** Inserts no line break and is not forwarded to
  artifact key handlers
- `Shift+Enter`: line break **inside** the block (`<br>`). The edit stays open
- `Ctrl+S` (`⌘S`): commits any open edit, then saves. The browser's "save page" is
  suppressed. Works inside the preview too — iframe key events never reach the host
  window, so the agent forwards them as a message. With nothing edited, does nothing
- `Esc`: cancel the edit; restore the original content
- `Ctrl+Z`: **while editing**, native `contenteditable` undo, untouched — the
  browser already reverses in-block typing precisely.
  **Outside editing**, reverts the most recently committed change (same as
  **Revert** in the change list). When an input field (the title, etc.) has focus,
  hands off — that field's undo takes priority.
  There is no redo. A reverted block can simply be edited again
- `Ctrl+Shift+S`: **download a copy.** Leaves the original alone; the result goes to
  a file. Works with zero patches — also serves as a pre-edit backup
- Clicking a card in the change list **takes you to that spot in the preview.** In a
  long document, the list alone does not say where the edit lives. Scrolling alone
  does not say which block it was, so the block is briefly highlighted. The revert
  button inside a card does not bubble its click — reverting must not then try to
  navigate to a block that no longer exists
- Paste: formatting stripped, plain text inserted
- The artifact's own key handlers (arrow-key slide navigation and the like) are
  blocked during editing

A block is **one unit** — `p`·`li`·`td` (core principle 4). Committing and leaving
is needed far more often than growing lines inside one, so `Enter` means "close".
Line breaks keep `Shift+Enter` — `<br>` is inline and rides inside the block.

**`Enter` during IME composition is the exception.** It is the key that commits a
Hangul composition, so it does not close the edit. Nor can its default be blocked in
`keydown` — block it and the composition never commits, and the character cannot be
completed. But let it pass untouched and the browser processes **composition commit
and line break together**, spawning a `<div>` inside a `<p>`. So the **input** is
blocked, not the key: while editing, `insertParagraph` in `beforeinput` is always
`preventDefault()`-ed. The composition commits intact; only the line break vanishes.

**That same handler is the only commit path on a phone.** Virtual keyboards do not
reliably raise a usable `keydown` — many report every key as `Unidentified` — so the
return key would be blocked by the rule above and then do nothing at all. The input
stage names the intent whatever the keyboard did, so `insertParagraph` commits there
too when no composition is in flight. The key itself is labelled by
`enterkeyhint="done"` on the block being edited: it closes the block, so a key
reading "new line" would promise the one thing it does not do.

### Closing the document

**Close** in the toolbar lets go of the open document and returns to the first screen.

Closing **changes the document**, so it walks the same road as opening — reserve at
the moment of user action (§5), ask if there are unsaved edits, release attached
resources. Exempt closing alone and edits silently vanish right there while blobs
leak.

The screen you return to must **equal the first screen.** So "the no-document state"
is built in one place — keep two copies and every state added gets fixed in only
one of them, and closing leaves behind fragments of the previous document.

## 4.1 Inline formatting

Puts **bold · italic · underline · color · size** on selected text. It is inline
markup living inside a block, so the unit of editing remains the block
(core principle 4).

### Must be produced as CSS

`execCommand` by default produces legacy presentational tags. Measured:

```
styleWithCSS = false   foreColor → <font color="#ff0000">   fontSize → <font size="5">
styleWithCSS = true    foreColor → <span style="color:…">   fontSize → <span style="font-size:…">
```

`<font>` is not in the inline tag set. Leave it and **the next time that file is
opened, the paragraph is no longer a block and becomes uneditable** — the price of
coloring text is losing the ability to edit it later.

But leaving it always-on turns even bold into `<span style="font-weight:bold">`.
Behavior is identical, but human-read diffs get ugly, and the notation splits from
the `<b>` the document already uses.

**Set it per command.** Bold, italic, underline turn it off (`<b>` `<i>` `<u>`);
color and size turn it on (`<span style>`). Set it once globally and a flip
somewhere else quietly produces different markup — so it is set again at every
command.

For the same reason, legacy tags like `font`·`strike` are included in the inline tag
set. We never produce them, but documents made elsewhere have them — and their
presence would lock those paragraphs wholesale.

### Size is written as a multiple

`fontSize` produces absolute keywords like `x-large`. Body size differs per
artifact, so a hard absolute clashes with that document's size system. The value
the command produced is rewritten **on the spot as a multiple (`em`)** — how many
times the original size is what the user actually asked for.

Which spots to rewrite is determined by **the selected range**, not by value.
Filter by value ("spots already holding this value predate the command, leave
them") and when the selected range itself already carries that value — the original
used that keyword — the command creates nothing new and the size change is silently
swallowed. A value-spot fully inside the range is text the user asked to resize,
whether the command made it or the original did, so it is rewritten as a multiple;
outside the range it belongs to the original and stays. If the selection covers
**part** of a value-spot, the spot is split and only the selected part changes — in
no case does unselected text change size.

### Colors come from the document

The colors on offer are **the colors the document already uses on text.** From the
rendered screen, colors of text-bearing elements are collected and offered by
frequency. `<body>` itself counts — in a document whose text sits directly under
body with the color set on body, scanning descendants alone yields no colors at all.

Hand out colors we chose and they defeat the document's own palette. An artifact has
its own color system; introducing a red it never had is not fixing — it is
**changing the design.** The usable colors are already in the document.

At most 10 color slots. More, and choosing becomes a task of its own.

**Colors that look identical are merged.** Real documents use several grays only a
few units apart — body, muted body, footnotes. Keep computed-value-distinct colors
separate and the 12px swatches line up indistinguishable — **an option you cannot
tell apart is not an option.**

The comparison is not per-channel subtraction but a distance weighted by human eye
sensitivity — most sensitive to green, least to blue, so naive subtraction splits
two colors differing only in blue. Opacity is ignored: translucent text blends with
whatever sits behind it, so its on-screen color is unknowable there, and formatting
inserts opaque values anyway.

### Controls

- `Ctrl+B` · `Ctrl+I` · `Ctrl+U` — bold · italic · underline
- Select text and a small bar appears above it. Color and size need a value picked,
  so they live there
- The bar's **clear** removes formatting from the selection (`removeFormat`)

The bar's labels are **handed over by the host.** The agent is a self-contained
function that cannot import the language pack (ADR-007) — but hard-coding Korean
would freeze that language in. Switching languages re-sends the labels, so even a
bar already on screen follows — screen copy has exactly one source, the language
pack (§1).

If the selection collapses while pressing the bar, the command applies nowhere. The
bar suppresses `mousedown`'s default, holds the selected range aside, and restores
it just before the command.

The bar is the preview's own furniture, so it lives **outside any block** (directly
under `<html>`). In a document like `<html><body>Hello</body></html>` where `<body>`
itself is the block, attaching to `body` makes the bar a child of the block being
edited — commit reads `innerHTML` and the editor's buttons ride into the saved
output (INV-9). If the bar somehow ends up inside a block, it is pulled out before
commit.

The held range lives **only while the bar is being pressed.** Move the caret or type
away from the selection and it is dropped — kept, the next Ctrl+B lands on the old
text instead of what is now selected.
If the selection reaches beyond the block being edited into a neighbor, formatting
is not applied. `execCommand` would change the neighbor too, but commit exports only
the block being edited, so the neighbor's change would go untracked
(core principle 2).

The bar's labels are sent only **after** the agent's `ready` signal from a freshly
drawn preview. Send them the moment the document switches and the new document's
agent has not yet attached its listener — the labels vanish and the bar comes up
with empty titles.

### Colliding with artifact events

Artifacts carry their own global handlers. The measured artifact flips slides on
`document` clicks.

```js
document.addEventListener('click', function(e){
  if(e.target.closest('table,ul.list,.tl,.defs,.code')) return;
  show(e.clientX < window.innerWidth*0.18 ? i-1 : i+1);
});
```

That is, click a `<p>` or `<h2>` to edit it and **the edit opens and the slide flips
at the same time.**

The preview agent intercepts `click` / `keydown` / `touchend` in the **bubble
phase**, using `stopImmediatePropagation()` so they never reach artifact handlers,
and for clicks and `Enter` consumed by editing, `preventDefault()` suppresses the
default action as well. Moving to the capture phase loses caret placement. The
premise is that the agent, injected at the top of the document, registers before the
artifact — the limits are recorded in ADR-007.

### Korean IME
Between `compositionstart` and `compositionend`, values are not read.
Reflect mid-composition state into a patch and the jamo shatter. Patches update
only after the commit event.

---

### Download a copy

In Chromium, opened via **Open**, saving means overwriting — there is no route to
the result **as a separate file**. Download a copy fills that hole. The name stays
the same as the original — `diff original.html downloaded.html` is how this tool's
work is verified, and the downloaded file must be able to replace the original. If
the name already exists, the browser numbers it.

### Notices float at the top right

As a banner, every notice shoves the body downward. A notice must not move the line
you were reading. It floats over the document and never touches the flow.

| Notice | Where | When it goes away |
|---|---|---|
| Saved · downloaded · opened N documents … | Toast | On its own |
| Can't edit this · {reason} | Toast | On its own |
| Couldn't open · not UTF-8 · couldn't save · folder open unsupported | Toast | **When a person closes it** |
| Missing files this document expects: N `[Link a folder]` | **Banner** | Until resources attach |

- **Errors never fade on their own.** A save failure that vanishes in seconds reads
  as success to whoever missed it (core principle 3)
- **Errors are never pushed out either.** When stacked notices overflow, non-errors
  are evicted first — if a save failure disappears because a few info toasts rolled
  over it, that is no different from fading on its own
- **A notice that carries an action never goes to a toast.** When the notice fades,
  its button fades with it
- Identical notices arriving back to back replace instead of stacking. Clicking a
  locked block repeatedly would otherwise wallpaper the screen with one sentence
- The locked-block notice is raised **from the store.** Watch `blockedId` change on
  the screen side and clicking the same block again changes nothing — so nothing
  happens
- Toasts also carry **message keys**, not sentences. Switch languages and the
  notices on screen switch too

### Protecting unsaved edits

Until saved, edits exist only in memory. There are five roads to losing them; all
are blocked.

- **Closing the tab / reloading** — `beforeunload` makes the browser ask.
  The criterion is not the patch count but **"does it differ from the file"** —
  patches survive a save (INV-1)
- **Opening another file** (open button · drop)
- **The OS opening a file with this app** (PWA `file_handlers`) — a different door,
  same "opening another file"
- **Switching to another document in the bundle** (§5.1)
- **Linking a folder** — attaching resources requires redrawing the preview (§5.1)

Nothing is discarded silently without confirmation, because there is no way back.

**Before asking, any edit open in the preview is committed first.** Press
close/open/switch while mid-edit in a block, and the preview's commit (focusout) is
merely **in flight** as a `postMessage` — the prompt's `unsaved` decision can run
before it lands. Left alone, no question is asked, the document swaps, and the late
commit dies quietly as the preview goes down (core principle 3). So before deciding,
the host asks the preview to "commit any open edit and report back", and waits for
the answer. Commits and the answer travel the same channel in order, so if the
answer arrived, the commit already reached the store.

The answer (flushed) does not mean "no edit is open" — it means **"everything there
was to send has been sent."** So in a state that cannot answer truthfully yet, the
answer itself is deferred — during Hangul composition the commit itself is deferred
(Korean IME), and answering first would let the host believe it is current and swap,
losing the character mid-composition. The preview answers after the deferred commit
actually goes out (composition end), or after that edit is abandoned (Escape —
nothing left to send). Composition is the only state that defers commits.

**But it never waits forever** — the preview may be dead, or an artifact script may
be holding the event loop. With no answer inside one second, it proceeds on what it
knows. A preview that cannot answer cannot send commits (focusout) either, so
waiting longer delivers no new edits to protect — the wait would only hold the
user's click hostage. The waiting spot is cleaned up **in one place** whichever
comes first — answer, timeout, or preview teardown; a timeout-ended wait left on
the list would pile up a new wait on every ask in front of an unresponsive preview.
This wait is a slow step like any other — after it, the replacement reservation is
checked for freshness again (§5 · replacement reservations).

The latter four offer **three choices** — `Save and continue` · `Discard and
continue` · `Cancel`. The browser's `confirm` has only two buttons, so it can only
ask "discard?" — while what the user usually wants is to save and continue. Without
that choice they walk three steps: cancel, save, retry.

- The save button's label depends on whether that document can be overwritten.
  Dropped and zip documents have no place to write back — a copy is downloaded, and
  labeling that just "save" would be a lie
- The "{count}" in the prompt is not the patch total but **the number of blocks
  differing from the file.** Patches survive a save (INV-1), and reverting a saved
  edit differs from the file with zero patches — counting patches either counts
  already-saved spots or says "0" when there is something to lose. The number is
  the per-block difference between current patches and the patches at the last
  save (the same criterion as §5). When one side lacks an entry, the comparison
  uses that block's **original content** in the gap — counting mere
  presence/absence would count a slot saved as its original content (edited, then
  reverted to original, then saved) as one more spot even though the reverted
  state equals the file
- If save was chosen and **saving fails, it does not continue.** Continuing would
  lose edits the user believed saved
- If save was chosen and **the content already equals the file, it counts as saved
  and continues.** State moves even while the prompt is up — a shortcut-invoked
  save may have finished meanwhile, or the last edit may have been reverted to
  match the file. Reading the save's "nothing to write" retreat as failure would
  cancel the user's action even though the requested save is already satisfied
- Asking while a prompt is already up closes the earlier prompt as cancel. Nothing
  is left waiting for an answer forever
- **`Ctrl+S` while the prompt is up equals "Save and continue."** If the shortcut
  only saved and left the prompt standing, `unsaved` would clear under a standing
  prompt — pressing its save button then finds nothing to save, reads as failure,
  and **cancels the pending action (open · switch)**

### No edits are accepted while replacing

Even after the prompt is answered, the new document takes time to stand up — file
reads, unzipping, parser chunk load. Meanwhile the screen still shows **the old
document.** An edit accepted here has nowhere to go the moment the new state
installs — a place where it would silently vanish.

So while replacing, edits are **not accepted** (core principle 3 · nothing quiet).

- The title field and the preview lock during replacement — no new edit can begin
- Commits that arrive anyway (blur of an already-open block, etc.) are **rejected
  with a notice** — accepting and then discarding equals discarding quietly
- Revert, revert all, and `Ctrl+Z` in the change list lock for the same reason —
  they edit the old document, and the result dies at install. The buttons are
  disabled; shortcuts that arrive anyway are rejected with a notice, like commits
- The locked span runs from the moment the prompt is answered until install (or
  failure) — including the wait if a dropped folder's scan is still running. Every
  gap in between is a place edits would vanish
- Everything the screen locks (preview · title field · change list · toolbar)
  derives from the **single** replacement reservation state (§5 · replacement
  reservations)

**Saving is different.** Edits made while the file is being written survive — when
the save finishes they are re-compared against the output and remain as unsaved
edits (§5). So saving locks nothing.

## 5. Save behavior

1. Sort the patch list by `innerStart` **descending** (splice front-first and every later offset shifts)
2. Splice into the original string in that order
3. Write the result to the file handle; on failure, fall back to download

Unedited blocks are absent from the patch list, so their original bytes remain untouched.

Whether there is anything to save is judged not by patch count but by **"does it
differ from the file"** (`unsaved`). "Differs from the file" compares **the output
that would be built now** (original + patches) against **what the file holds** (what
was read at open, or last written). Patch count is unreliable in both directions.

- Revert an already-saved edit and patches hit zero while the file still holds the
  old edit — saving then writes the original back, making the file match the
  screen. Gate on patch count and "Save and continue" halts with nothing to write,
  leaving cancel and discard as the only exits from the dialog
- Conversely, revert a never-saved edit until the output equals the file, and
  nothing is at stake despite the patches — nothing to save, nothing to ask

The save button, `Ctrl+S`'s early return, the tab-close check (`beforeunload`), and
the save dialog all read this one criterion. Split criteria create the gap where
"the button presses but nothing happens."

While a save is **writing** the file, the criterion is the output being written —
because that is what the file will hold when the write ends. Compare against the
old content and reverting an edit mid-write reads as "nothing to lose": close the
tab in that window and it closes without warning, leaving screen and disk split.
If the write fails, the file still holds the old content, so the criterion returns
to the old content.

"What the file holds" is updated to the output at every save. With a handle, the
disk holds that content, so whenever the preview must be redrawn it is re-read from
disk. **For a document saved by download without a handle (drop · zip), the copy is
what the file holds** — the in-memory document content must also be swapped to the
output, so that paths which re-read the document (like linking a folder) do not
fall back to pre-save content.

A save may also still be writing when the document is switched. A late-finishing
save's result belongs to **the previous document** — write it into the new
document's state and the old output impersonates the new document's saved copy. So
late-finishing async work takes the current document's token at start and, if the
token changed by the end, **discards** its result — the file was already written,
and that belongs to that file; nothing is lost. Discarded means only the state
update, the notice, and lowering the saving indicator. The judgment ("is this
result the current document's?") is gathered in one place — not just saves: any
async that can finish after a switch checks its own document by the same token.

**Messages from the preview share this problem.** The iframe is reused, and
swapping `srcDoc` leaves `contentWindow`'s identity intact — a `ready` or `edit`
launched by the old document's agent that lands after the new document stands
passes the origin check. Block ids restart at 0 per document, so old content or
locks would strike the new document's same-numbered blocks. So each preview
document **carries a distinct token to its agent**, the agent stamps every message
with it, and the host drops messages that lack the current document's token. The
token is minted at document load; it only needs to differ per document within a
session.

**A save request while a save is writing does not start a second save.** The save
button locks on the saving indicator (`saving`), but `Ctrl+S` presses any time —
edit mid-write and `unsaved` stands again, so the early return cannot stop it
either. Overlap, and two saves hold different snapshots writing side by side; by
finishing order **the older output can win on disk**, splitting state (`savedText`)
from disk. So a save checks `saving` at start and does not begin while one is
running. Nothing is lost — when the running save ends, edits made meanwhile remain
unsaved (above), and saving again suffices.

### Replacement reservations

Replacements can also overlap each other — drop folders in quick succession and the
next read starts before the last finishes. When they overlap, **the later one
wins**: it is the user's most recent choice. The document token cannot arbitrate —
the token changes when the new state **installs**, so of two overlapped flows the
one that finishes first would win. So every flow that changes the document follows
one rule — the **replacement reservation** (ADR-010).

- Reserve at **the moment of user action** — before the slow work begins (scanning,
  reading, dialogs, prompts, saving). Files handed over by the OS included —
  reserve after the read finishes, and a flow that started earlier but got ready
  later takes a newer reservation and buries the user's most recent choice
- Every step after reserving (dialog → scan → waiting for preview commits → prompt
  → save → read → install) checks **whether its reservation is still the newest**,
  in one place, as each step completes. The flow that answered the prompt with
  save and returned, the flow that waited out a folder scan, the flow whose dialog
  closed late — all pass the same check. Above all, check **before asking** —
  while awaiting the preview's commit answer (§4), a newer flow can still reserve;
  ask while superseded and that prompt cancels the newest flow's prompt, and
  answering save makes the superseded flow save, erasing the user's most recent
  choice
- A superseded flow **cleans up only what it created, then steps aside** — no
  installing, no notices, no unlocking. The right to release resources the screen
  is using (blob URLs) belongs to the flow that installed (or will install) that
  document, and unlocking belongs to the newest reservation
- A flow that answered the prompt with save does not reuse state captured before it
  paused — the save may have just swapped the bundle (§5.1) to the output. It
  re-reads current state before continuing. **Dropped files** are the exception
  with no way to re-read — the old drop API grants no handle, so the bytes at drop
  time are all that bundle will ever hold. Drop the current document's folder and
  answer save, and what was just written may be absent from the drop snapshot (the
  same limitation that routes drop saves to copy download, §5.1)
- What the screen locks derives from the reservation state **alone** — from prompt
  answered to install, the preview, title field, change list, and toolbar (open ·
  document picker · link folder · save) lock (§4 · no edits while replacing)
- The saving indicator belongs to the save. An earlier save finishing mid-
  replacement lowers only its own indicator and leaves the replacement's lock alone
- A reservation ending in cancel (prompt cancel, dialog dismissed) replaces
  nothing — a flow that started earlier and is still reading was already
  superseded, so it does not install either. Cancel always means "stay on the
  document you were looking at"

---

## 5.1 External resources

Documents that are not self-contained open too. A document that keeps `deck.css` or
`logo.png` alongside gets those resources attached **in the preview only**, showing
it as intended.

### Why it does not render by itself

The preview is `srcdoc`, so it has no address of its own. Relative paths resolve
against the parent document — **this app's address.**

```
document URL : about:srcdoc
base URL     : https://code0xff.github.io/nighteditor/
deck.css → https://code0xff.github.io/nighteditor/deck.css   404
```

`<base href>` cannot fix it either. The originals live at `file:///…/deck.css` on
the user's disk, and an `https://` page cannot read `file://`. Opening one file
grants permission for **that one file** — no standing to see its siblings. It is a
permissions problem, not an iframe problem.

### How resources are attached

There are three roads to the resources.

| How you open | Resources | Saving |
|---|---|---|
| **Open a folder** | Read from that folder | Overwrites the original |
| Open a file + **Link a folder** | Read from the folder | Overwrites the original (handle kept) |
| Drop a folder | Read from the dropped folder | Downloads a copy |
| Open or drop a zip | Unpacked and read | Downloads a copy |

The split into **Open a file** and **Open a folder** buttons is a platform
constraint, not taste. The web has no dialog that picks files and folders
together — `showOpenFilePicker` gives files only, `showDirectoryPicker` folders
only. Which window to show must be decided **before the click.** A menu would
merge the buttons but add a click. Drag and drop can decide by looking at what was
dropped, so it takes one target — a file opens as a file, a folder as a folder.

**Open a folder** requests edit permission (`readwrite`) as well. Keeping the rule
"what you opened via Open, you overwrite" for folders requires a writable handle,
and that handle only comes from the dialog. Drop uses the old API, which grants no
permission — the same folder still goes the copy route.

**Link a folder** requests `read`. It exists only to attach resources, so it does
not ask for permissions it does not need. If the linked folder contains the current
document's location, a write handle is kept at that path so overwriting still
works — but **only when it is proven to be the same file** (`isSameEntry`). A
matching path does not mean the same file — hang this handle on a same-named
stranger's path and, on return, the wrong document opens at that spot and saving
overwrites someone else's content.

A document that fails the proof does not merely lose the handle — it is **not a
member of the bundle either.** Adopt the colliding path as this document's bundle
path and saving would swap the bundle's content at that path for this document's
output, switching out the folder's **other** document, while opening that document
from the list gets blocked as "already open". The recovered location is used only
as the base for finding resources; the bundle path stays empty — the folder's own
document stays in the list, openable on its own at any time.

When a folder is too large, reading stops at the limits (file count, size, depth,
scanned entries) and says so. If the limit was hit and no document was found, it
does not just say "no documents" — the document may have been beyond the limit.
**It also states that the scan did not finish** (core principle 3).
The limits bound not just what is kept but **the scanning itself** — however many
files will not fit, traversal must never run unbounded and freeze the tab. Skipped
entries (hidden files and the like) count as scanned — skipping costs a step too,
and uncounted, a folder full of hidden entries slips past the limit.

Depth counts **the picked or dropped folder as level 0**: descend as far as the
folder at level eight, and below that is recorded as cut off. A dropped folder's
paths carry the root name, but that name is not depth — the same folder must cut at
the same place whether picked from a dialog or dropped.

A dropped folder's scan keeps running even while the save prompt (§4) is up — drop
items vanish when the event ends, so the scan must start before asking. If that
scan fails, **the failure is reported even if the prompt was cancelled** — a
failure is received where it is created. Receive it after the answer and the
cancelled side's failure has no receiver, vanishing without notice
(core principle 3).

Zips follow the same limits, but the compressed size is checked **before** loading
the whole thing into memory. A zip over the limit will exceed it once unpacked
anyway, so it is refused before reading starts — copying hundreds of MB just to
read a table of contents, freezing the tab, makes the limit pointless.
The file-count limit is enforced **while reading the index** — count after reading
and a to-be-refused zip gets all its entries built and validated up to the index
maximum (65,534) before refusal. Entries duplicated under one name each count —
the limit bounds the reading itself, not the number kept.

Entry **contents are checked against the index's CRC-32.** Compare sizes alone and
same-sized corrupt bytes pass — a stored entry differs by one flipped bit at the
same size, and a corrupt deflate stream can inflate to the expected size. When the
actual bytes' CRC differs from the index, it stops with a reason instead of quietly
opening a broken file (core principle 3).

Zip entry names are read **as flagged.** With the UTF-8 flag (general-purpose bit
11) the name is UTF-8; without it, the legacy zip standard encoding is CP437 —
decode everything as UTF-8 and old zips' non-ASCII names (`café.png`) shatter into
U+FFFD, the bundle keys mismatch, and healthy zips lose document candidates and
relative resources. Info-ZIP tools may carry the real name in the Unicode Path
extra field (0x7075) as UTF-8 — trusted only when that field's CRC matches the
standard name (zips exist where the name changed and the field went stale). A name
with neither flag nor field is read as **UTF-8 if it decodes strictly, else
CP437** — macOS's `zip` does not set bit 11 even for Korean names, so trusting the
flag alone breaks modern zips instead. ASCII reads the same either way, and a
CP437-written non-ASCII name that happens to be valid UTF-8 is practically
nonexistent.

When a bundle holds several HTML files, one is chosen and opened, and **it says
which one out of how many.** The order: shallower → `index` → shorter name →
lexicographic. The document at the surface is the bundle's face; the deeply buried
ones are usually parts.

Telling without letting the user switch makes the other documents as good as
absent. With two or more candidates, the toolbar shows the list to switch between.
Already-unpacked files are reused, so the zip is not unpacked again. It redraws the
preview, so unsaved edits prompt first.

The base for relative references is the document's own location — unless the
document moved its base with `<base href>`, in which case **that base is followed**
(the first `<base>` with an href, same as the HTML spec). Judge by document
location alone and files actually sitting alongside get counted missing, and the
preview skips what it should attach.
If base points outside (an absolute URL, `//`), relative references are not local
files — nothing to attach, nothing to count missing; the document renders as-is.
`url()` inside the document's own `<style>` follows the same rule (the document is
its base), while `url()` inside an attached CSS **file** stays relative to that
file's location — base belongs to the document, not to stylesheets.

When collapsing paths, `.`·`..` count even when percent-encoded — the URL spec
collapses `%2e`/`%2e%2e` segments as dot segments too, so a document that writes
`%2e%2e/logo.png` makes the browser go up one level. We must **decode segments
first, then collapse** to find the file actually sitting there. Segments that
cannot be decoded (bad encoding) stay as written.
When base's last segment is `.`·`..`, as in `<base href="..">`, it is a position
marker, not a file name — resolve the base URL fully **first**, then strip the
directory. Strip the last segment first and `deck/sub`'s `..` lands at `deck/sub`
instead of `deck`.

`%2F` inside a segment is the one thing **left encoded, as written.** Disk file
names cannot contain slashes, so decoding turns part of a name into a path
separator — with a real file named `a%2Fb.png`, you would go looking for a
nonexistent `a/b.png`. Bundle keys are disk names, and on disk `%2F` is always
literal.

Read files become `blob:` URLs and **only the relative paths inside the preview
document** are swapped. The original string is untouched (core principle 1) — not
one blob URL enters the saved output. It happens in the same place as marker
injection, under the same rule (descending-order application).

A blob's format (MIME) is **decided by the extension when the extension is
known.** The `File`'s reported type from folders and drops cannot be trusted —
some environments report `.js` as `text/plain`, and a blob made with that type gets
the linked script refused for its type, so the file sits right there and still does
not run in the preview. The type a document expects of a file it references by
extension is the extension's. Only unknown extensions trust the reported type, and
failing that, `application/octet-stream`. Stylesheets are always `text/css` —
standards-mode browsers refuse other types for stylesheets.

Swaps happen **inside** editable blocks too — the `src` in
`<p>caption <img src="logo.png"></p>` is a blob URL in the preview. So this
boundary is **two-way** (ADR-011).

- **Outbound** — original fragments pushed into the preview (revert's
  `sourceInner`) go out with blob URLs applied, using the same swap list as the
  initial assembly. Otherwise only the reverted block's images break, and revert
  becomes an operation that damages the screen
- **Inbound** — edits returning from the preview (innerHTML) become patches only
  after blob URLs are turned back into **the exact source spelling.** Otherwise
  editing a block loads blob URLs into the patch, and an address that dies with
  the tab gets baked into the file (violating INV-9)

Both directions come from **one swap list** — compute the outbound spelling and the
restore spelling in different places and mismatched pairs are inevitable. A swap
followed by a restore equals the original **byte for byte** — a changed quote,
case, or entity spelling is itself a diff (core principles 1·2). The same rule
holds when the browser returns a respelled reference via innerHTML serialization
(`&#32;` → space, etc.) — the serialized pair's source side also comes from the
**original slice**, not a re-encode of the parser-decoded value. The serialized
context is always a double-quoted attribute, so only `"`, which would end the value
early, becomes `&quot;` — past the parser it is the same value.
References the swap never touched (resources that failed to attach) and documents
that already wrote `blob:` themselves are untouched in either direction.

Restoring is keyed by **position, not by lookup table.** `logo.png` and
`./logo.png` are the same file, so their preview spelling is identical — restore
through a one-spelling-one-source table and editing just the text of that block
flips an untouched reference's spelling to another position's spelling
(core principle 2). The host knows which block an edit came from, so the swaps
within that block's range are restored **each to its own spelling, in source
order** — the k-th occurrence of a spelling is that block's k-th slot of that
spelling. Spellings that cannot be tied to a slot (a blob URL pasted from another
block; counts thrown off by deletions or moves) restore to the first-seen source
spelling — any spelling names the same file, so the meaning holds, and that spot
is inside the range the user actually edited.

Of everything that trailed the path, only the **fragment (`#icon`)** is re-attached
to the blob URL. Lose it and which piece of the sprite to pull is gone. The query
(`?v=3`) is **dropped** — a blob URL with a query appended is a different name from
the created object and simply fails to load, and cache busting means nothing to a
blob. The same rule for HTML attributes and CSS `url()`.

The rewritten targets are the attributes that **point at resources**:
`link[href]`, `script[src]`, `img[src]`, `source[src]`, `video[src|poster]`,
`audio[src]`, `iframe[src]`, `embed[src]`, `object[data]`, `track[src]`,
`input[src]`, `use[href]`.
`<a href>` is not rewritten — it is a place to go, not a resource to attach.

`url(...)` inside CSS is rewritten too. Skip it and the stylesheet attaches but its
fonts break — blob URLs have no directories, so a stylesheet cannot find the files
beside it. Applied to both `<style>` blocks and attached CSS files.
CSS escapes in `url()` values (`\)`·`\ `·hex) are **decoded first**, then resolved
as paths — bundle keys are disk names, not the document's spelling. Cut the value
at an escaped parenthesis and perfectly valid CSS like `url(foo\)bar.png)` loses
its resource. Rewritten fragments re-escape only the characters that would break
the token (quotes, parentheses, whitespace).

A stylesheet may also pull **another stylesheet** via `@import url(…)`. Build the
importer's blob first and the imported one's URL does not exist yet — the reference
stays relative, and relative paths do not resolve in a blob document. So **the
imported side is built first.**
Mutual-import cycles cannot be joined with blobs anyway, so **only the sheets in
the cycle** are built carrying whatever URLs exist by then. Build the sheets that
import the cycle from outside in the same batch and they get built before the cycle
members' URLs exist, leaving those `@import`s relative — they are built **after**
the cycle, carrying the URLs it produced.
With several cycles, build **one clump at a time** — a strongly-connected clump of
interlinked sheets is the unit. Build a cycle that leans on another cycle in the
same batch and the leaning side's `@import`s get built before that cycle's URLs
exist, staying relative — build the clump that no remaining sheet depends on
first; the leaning side takes the just-minted URLs on the next round.

### Not done

- `srcset` — multiple URLs in one comma-separated value with its own parsing rules. Left as-is
- `@import` — only `url()` is rewritten
- CSS inside `style="background:url(…)"` attributes
- **Editing resources** — attach only. The one thing edited and saved is always a single HTML document

### When resources cannot be attached

Never left quietly broken (core principle 3). When references exist but resources
do not, it counts what failed to load, shows it, and offers the road to link a
folder alongside.
Editing and saving stay exact in that state — only the original string is ever
touched, so however the screen looks, the diff never exceeds what the user edited.

---

## 6. Acceptance criteria

Against the fixture (`src/__fixtures__/artifact.html`). All verified by automated tests.

- [x] All **27** editable blocks are recognized (including `<title>` and locked empty elements)
- [x] The 4 empty `.pg` elements and `#cnt` do not become blocks
- [x] After DOM restructuring (`wrapSheets`-style), every block's marker is still valid
- [x] Editing 1 block → `diff` shows **only those lines**
- [x] A document starting with a BOM is read BOM and all — single file, zip, and folder alike (core principle 1)
- [x] Non-UTF-8 documents are refused with a reason (core principle 3)
- [x] Save with no edits → **byte-identical** to the original
- [x] A block containing inline `<b>` keeps the `<b>` after editing
- [x] Editing `<title>` via the dedicated field → diff shows only that line
- [x] Traversal survives an implicit `<tbody>`
- [x] A block containing `&amp;` is not false-positive-locked as `SCRIPT_GENERATED`
- [x] Double entities like `&amp;amp;` match the live text
- [x] Locks inherit to descendants even with nested elements inside `.code`
- [x] Clicks and arrow keys during editing do not leak to artifact handlers
- [x] Artifact navigation works normally when not editing
- [x] Hangul editing survives focus loss mid-composition
- [x] Escape restores the pre-edit content
- [x] Leaving without changing creates no patch
- [x] Editable, locked, and editing states look distinct in the preview (injected styles)
- [x] The injected styles use no layout-changing properties
- [x] When the lock list updates, no stale lock markers remain
- [x] `Ctrl+S` commits the open edit, then saves (inside the preview too)
- [x] `Ctrl+S` during composition neither saves nor opens the browser dialog
- [x] `Ctrl+Shift+S` downloads a copy, not a save
- [x] `Ctrl+Z` reverts only the most recently committed change (re-edited blocks included)
- [x] `Ctrl+Z` inside an input field does not revert a block
- [x] Closing the tab with unsaved changes prompts

External resources (§5.1):

- [x] Relative paths in `link`·`script`·`img` are swapped to blob URLs in the preview only
- [x] `<a href>` is not swapped
- [x] Fragments (`#icon`) are re-attached to the blob URL; queries (`?v=3`) are dropped — attached, the blob would not load
- [x] `url()` inside `<style>` and CSS files is rewritten relative to that file's location
- [x] The saved output contains no `blob:`, and the changed lines are only the edited blocks
- [x] Editing and saving a block holding a resource reference admits no blob URL — it restores the source spelling
- [x] Reverting a block does not undo the preview's resource swaps
- [x] A swapped-then-restored original fragment is byte-identical
- [x] Without resources, the document still opens and edits
- [x] A document in a subfolder finds resources relative to its own location
- [x] When `<base href>` moves the base, resources are found from that base
- [x] Encoded dot segments (`%2e%2e`) collapse as dots when finding resources
- [x] `%2F` inside a segment is not decoded as a separator — the literal name `a%2Fb.png` is found
- [x] A base whose last segment is `.`·`..` is a position marker — not stripped as a file name
- [x] Zips are unpacked, a document is chosen, and `__MACOSX` and directory entries are filtered out
- [x] With several documents, every candidate is visible in order (not just the chosen one)
- [x] Clicking a change card scrolls to that block and briefly highlights it
- [x] Bold·italic·underline come out as tags; color·size as `style` (no `<font>` is produced)
- [x] Clicking the format bar does not close the edit
- [x] The format bar lives outside blocks and never enters the saved output, even when `<body>` itself is the block (INV-9)
- [x] Notices float at the top right, and errors do not fade on their own
- [x] Identical consecutive notices replace instead of stacking
- [x] A document opened from a folder carries a writable handle and saves by overwriting
- [x] After linking a folder, switching to another bundle document and back keeps the current document's overwrite handle alive
- [x] If the linked folder's same-named entry is a different file, no handle is hung on that path
- [x] Declining the edit permission does nothing at all
- [x] A folder with no HTML says why
- [x] If the scan was cut short and no document was found, the unfinished scan is reported too
- [x] Dropping folders in succession opens the last one dropped, and its blob URLs are alive
- [x] A superseded replacement releases only the blob URLs it created
- [x] If a folder scan fails while the prompt is up, the reason is reported even after cancel
- [x] A dropped folder reserves at the moment of the drop — even with a slow scan, the later drop wins
- [x] The screen stays locked while waiting out the scan after answering the prompt
- [x] A switch answered with save opens the post-save bundle
- [x] If a newer flow started while waiting on the save, the earlier flow steps aside
- [x] `Ctrl+S` while a save is writing does not start a second save
- [x] Revert, revert all, and `Ctrl+Z` are blocked while replacing
- [x] An earlier save finishing does not lift the replacement lock
- [x] Old preview messages arriving after a switch are dropped — screened by per-document tokens

Unsaved edits (§4):

- [x] With nothing edited, no prompt
- [x] With edits reverted until the output equals the file, no prompt
- [x] The prompt's "{count}" does not count saved patches, and does count reverted-after-save spots
- [x] Cancel stays right where you were
- [x] Choosing save saves first, then continues
- [x] If the save fails, it does not continue
- [x] Asking during a prompt closes the earlier prompt as cancel
- [x] Not a zip, truncated, or password-protected → stops with the reason
- [x] Input shorter than an EOCD also stops as "not a zip"
- [x] A zip64-lookalike record at the comment's end does not fool it — it opens by the real index
- [x] A fake "empty zip" EOCD that writes its own position into the index field does not fool it — it opens by the real index
- [x] If the size in the index differs from the actually-inflated size, it is treated as tampering and refused
- [x] If the index CRC differs from the actual bytes, it is treated as corrupt and refused
- [x] An index entry running past the EOCD stops with a broken-index reason, inventing no entries
- [x] Non-UTF-8 entry names are read as CP437, and the Unicode Path field is used only when its CRC matches

### What is not verified automatically

- **Real IME input** — the composition event flow is tested, but the result of
  typing with a real Hangul IME must be checked by a person
- **Linking a folder** — `showDirectoryPicker` is a dialog only a person can
  operate. Everything after the folder is read shares code with the zip path and is
  covered by tests, but the dialog itself is manual territory
- **Reopen after save** — whether a file overwritten via the File System Access API
  reopens with the artifact fully working is manual territory
