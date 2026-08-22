# Architecture

## Tech stack

| Area | Choice | Why |
|---|---|---|
| Language | TypeScript (`strict`) | Offset and range math is the core; a type error here is data corruption |
| Build | Vite | Static output, with local `file://` execution in mind |
| UI | React | Matches the house style of the `design-ui` skill |
| Styling | Tailwind CSS + shadcn/ui | Use the `design-ui` skill for UI work (Pretendard / JetBrains Mono, dev-tool tone) |
| State | Zustand | It is just a patch list and selection state; anything more is overkill |
| HTML parser | **parse5** (`sourceCodeLocationInfo: true`) | A spec-compliant implementation that yields source offsets. The heart of this project |
| Editor | **Native `contenteditable`** | See ADR-004 — rich text frameworks are banned |
| File I/O | File System Access API + download fallback | Writes the original file in place (Chromium); other browsers download |
| Tests | Vitest | Golden tests for the patch engine come first |
| Packages | pnpm | |
| Backend | **None** | Core principle 5 |

## Module structure

```
public/                 ← favicon, app icons, site.webmanifest (copied to the dist root at build)
src/
  core/                 ← No browser APIs. Pure logic. 100% test coverage target
    parse.ts            source → block list + offset mapping
    blocks.ts           editable-block detection rules (spec.md §2)
    markers.ts          data-ne-id injection / removal
    edits.ts            applies an offset edit list in one descending pass
    assets.ts           finding external resource references · path resolution · the two-way boundary for preview URL swaps (ADR-011)
    zip.ts              zip central directory parsing (extraction lives in lib/zip.ts)
    bundle.ts           rules for choosing what to open inside a bundle (folder·zip)
    patch.ts            patch list → splices into the original string
    verify.ts           source-vs-live comparison check
  preview/              ← the agent script that runs inside the iframe
    protocol.ts         host↔preview message types (types only, no runtime code)
    agent.ts            one self-contained function. Clicks, keys, IME, postMessage
  lib/                  ← browser API wrappers and host-side helpers
    fs.ts               opening files, saving, reading folders (File System Access API + fallback)
    assets.ts           read files → blob URL set (with lifetime management)
    zip.ts              zip extraction (DecompressionStream)
    icons.ts            single source for icons — semantic name → lucide glyph, app icon paths
    messages.ts         language pack — ko/en dictionaries, key types, interpolation. The only source of screen copy
    preview.ts          preview document assembly (markers + resource swaps + agent injection)
    shortcuts.ts        host-side shortcuts (inside the preview, the agent intercepts)
    theme.ts            light/dark theme (localStorage + <html class>)
    media.ts            useMediaQuery — the breakpoints read from JavaScript, where the answer
                        changes behavior rather than appearance (reach, and which sentence is true)
    unsaved.ts          beforeunload — when the tab is closing over unsaved edits
    utils.ts            cn() — class name merging
  ui/                   ← screen skeleton: App · Toolbar · PreviewFrame · ChangeList
  components/           ← screen parts (TitleField · SideControls · Brand · OpenButton …).
                          `ui/*` are shadcn artifacts; keep their original shape
  store/                ← Zustand
    editor.ts           original, blocks, patches, bundle. Notices are stored as message keys, not sentences
    replacement.ts      document replacement reservations — the single place that decides who wins and what locks (ADR-010)
    locale.ts           UI language (localStorage + <html lang>), useI18n
    panel.ts            whether the change list is over the preview — only below `lg` (ADR-012)
    toasts.ts           the notice stack at the top right — message keys, never sentences
    unsaved.ts          where we ask before anything that would lose edits (save / discard / cancel)
```

`lib/unsaved.ts` and `store/unsaved.ts` share a name but not a job. The former makes
**the browser** ask (`beforeunload`); the latter is **us** asking. We cannot choose
the browser dialog's wording or buttons, so anything happening inside the app asks
through the latter.

`core/` knows neither the DOM nor React. It takes strings and returns strings.
If this boundary collapses, the patch engine becomes untestable.

## Data flow

```
original HTML string (immutable, kept to the end)
   │
   ├─ parse5 parse ──→ block list [{ id, tag, innerStart, innerEnd, sourceText }]
   │
   ├─ marker injection ──→ preview HTML (each block gets data-ne-id="N")
   │                  │
   │                  └─→ iframe render → artifact scripts run → DOM restructured
   │                        │
   │                        └─→ source-vs-live comparison → mismatched blocks auto-locked
   │                              │
   │                              └─→ user edits → postMessage
   │
   └─ patch list [{ id, newInnerHtml }]
         │
         └─→ splice in descending offset order ──→ saved output
```

Attaching external resources leaves the original untouched too (ADR-009). The swaps
ride the same edit list as the markers and reach only the preview.

```
folder · zip ──→ file bundle ──→ blob URL set
                                │
original HTML string ──→ resource references [{ path, valueStart, valueEnd }]
                                │
                    marker edits + resource edits ──→ one descending-order pass ──→ preview HTML
                                                                        (never passes through the save path)
```

**The original string is never modified during a session.** At save time, the result
is built fresh from the original plus the patches. Reverting is therefore just
removing an entry from the patch list, and the original is always recoverable.

---

## Design decisions

### ADR-001 · Offset patches instead of DOM re-serialization

**Decision** Collect edits as `{ blockId, newInnerHtml }` patches and, at save time, replace only those ranges in the original string.

**Why** When the browser re-serializes the DOM, normalization rewrites indentation, attribute order, and entities wholesale.
You fix one paragraph and the diff spans the entire file — and feeding the edited copy back to Claude wastes context.

**Validation** A 12-byte edit to an `<h1>` in the measured artifact (110KB) → `diff` shows **1 line**; every other byte identical.

**Alternative** Full re-serialization — easy to implement, but a head-on violation of core principles 1 and 2. Rejected.

---

### ADR-002 · The unit of editing is the block, not the text node

**Decision** Put `contenteditable` on blocks like `p` / `h2` / `li` / `td`, and patch that block's entire inner range.

**Why** Analysis of the measured artifact — 1,674 raw text nodes, **median length 10 characters**.
A `<b>` splits one sentence into 3 nodes. At text-node granularity the user can only edit part of a sentence,
and inline tag boundaries become editing barriers. Grouped by block there were 867 (including `<title>`),
and inline markup stays in the DOM, preserved naturally.

**Trade-off** Since the block's innerHTML is used verbatim, inline structure the user breaks mid-edit is saved broken.
Mitigated by paste sanitization and the `plaintext-only` option.

---

### ADR-003 · Marker injection instead of structural paths

**Decision** **Before** rendering, insert `data-ne-id="N"` into each block's opening tag in the source string.

**Why** Artifact scripts restructure the DOM. The measured artifact's `wrapSheets()` moves every child of each `.slide`
into a new `<div class="sheet">`. That is, **live DOM ≠ source DOM**, and a path taken from the live tree,
like `section:nth-child(3) > h2`, does not resolve in the source tree.
`appendChild` *moves* nodes, so attributes travel with them — markers survive however the DOM gets churned.

**Caution** Markers are preview-only. The save path starts from the original string, so a marker can never leak into the output.

---

### ADR-004 · No rich text frameworks

**Decision** No ProseMirror / Tiptap / Lexical / Slate. Drive native `contenteditable` directly.

**Why** All of them **normalize into their own document model**. Tags, attributes, and classes outside the schema are silently dropped.
That fundamentally conflicts with this project, which must preserve an artifact's arbitrary inline markup
(`<span class="h">`, inline `style`) verbatim. It trades away core principle 1 for convenience.

**Cost** Undo stack, paste sanitization, and IME handling must be built by hand. Accepted.

---

### ADR-005 · Editability decided by source-vs-live comparison

**Decision** Right after the iframe renders, compare each marked block's live `textContent` against its source text.
On mismatch, **auto-lock** that block.

**Why** Statically figuring out which text a script generates or mutates has no general solution.
But "does the result differ from the source" is answered definitively by a single render.
The measured artifact's `#cnt` and 40 `.pg` elements were filtered out automatically by this rule.

**Effect** Safe even on artifacts never seen before. No script comprehension needed to avoid a wrong edit (core principle 3).

---

### ADR-007 · The agent is injected at the top of the document and intercepts in the bubble phase

**Decision** Inject the preview agent as an inline script at the very start of `<head>`,
and stop events in the **bubble phase** with `stopImmediatePropagation()`.

**Why** The capture phase looks intuitive but is wrong. Cut propagation during capture and the event
**never reaches** the target element, so `contenteditable` caret placement does not happen.
You click, and no cursor appears.

In the bubble phase the event reaches the target first, the caret is placed normally, and only then does it
rise to the document. Listeners on the same phase and target run in **registration order**, so as long as
we register before the artifact does, our handler runs first and `stopImmediatePropagation()` blocks
the artifact's handler.

Injection position is therefore a correctness condition — artifact scripts sit at the end of `<body>`,
while the agent is parsed at the top of `<head>` and registers its listeners immediately.

**Known limitation** Our listeners sit on `document`, so `stopImmediatePropagation()` only outruns
handlers registered on `document` and `window`. If the artifact hangs a handler on an intermediate
ancestor (a slide container, a card wrapper), that ancestor comes earlier on the bubble path and runs
before us. In such artifacts, clicking text opens the edit and triggers the artifact behavior together.

Moving to the capture phase would block it, but loses caret placement. Global handlers are the common
case — the measured artifact included — so the current choice stands.

**Consequence** The agent must be a **self-contained function**: no imports, no references to outer
scope. The host injects it by stringifying with `previewAgent.toString()`.
This constraint structurally enforces "preview shares no code with ui" (rules §4).

---

### ADR-006 · No backend, File System Access API

**Decision** No server. Saving writes **directly to the original file** via the File System Access API,
with a download fallback for unsupported browsers.

**Why** This is a tool for fixing your own artifacts. The moment a server exists, we are hosting untrusted HTML,
and stored XSS, origin isolation, and authentication all follow. Removing it is cheaper and safer.

**Deployment** Hosted on GitHub Pages (static). HTTPS satisfies the secure-context requirement,
so overwrite saving just works. Installed as a PWA, the whole app is precached and runs offline,
and the manifest's `file_handlers` lets the OS open HTML with it directly. In that path `launchQueue`
delivers a `FileSystemFileHandle`, so overwriting works without any dialog.

**Folders** Opening a folder requests edit permission (`readwrite`) up front. That is what produces a
writable handle for the documents inside, so "what you opened via Open, you can overwrite" holds for
folders too. The path that only attaches resources (Link a folder) stays at `read` — do not ask for
permissions you do not need. A dropped folder comes through the old API, which grants no permission,
so even the same folder goes the copy route.

**Constraint** Overwriting the original works only in Chromium-based browsers. Firefox and Safari get
the download fallback, so "save straight back to the file you opened" is unavailable there.
We go **Chromium-first**. A zip can be overwritten in no browser — once unpacked it is bytes in
memory, with no place to write back to.

**Consequence** The preview iframe gets `allow-scripts allow-same-origin`.
As a sandbox that combination is toothless, but the target is the user's own local file and there is
no server, so we accept it. This premise is tied to core principle 5 — if a server ever appears,
this decision is the first to revisit.

---

### ADR-009 · External resources are swapped to blob URLs in the preview only

**Decision** For documents that reference neighboring files, take the resources in via folder or zip,
make `blob:` URLs, and rewrite **only the relative paths inside the preview document**.
The original string and the patch path stay untouched.

**Why** The `srcdoc` preview's base URL is this app, so relative paths 404 against the app's folder.
`<base href>` cannot fix it — the originals are `file://` and an `https://` page cannot read them.
Opening one file grants permission for that one file only, so seeing siblings requires the user to
open a folder or hand over a whole zip. In other words this is a **permissions** problem, not an
iframe problem, and the fix lives on the permissions side.

**Constraint** The swap happens **in the same place** as marker injection. Both are keyed to original
offsets, so applying them separately would let earlier insertions shift later offsets and cut the
wrong places. Hence all edits are gathered into one list and applied in a single descending pass
(`core/edits.ts`, the same rule as INV-4).

Blob URLs have no directories. Attach a stylesheet as-is and the `url(font)` references inside it
lose their base and break, so `url()` inside CSS text is re-resolved relative to that file's location.

**Consequence** Not one character of `blob:` enters the saved output. Even with resources unattached,
editing and saving stay exact — how broken the screen looks and how precise the diff is are unrelated.

### ADR-008 · The parser ships outside the initial bundle

**Decision** parse5 (plus its entity table) and the preview assembler are loaded dynamically by
`store/editor.ts` **when a file is opened**. Vendor chunks are split into react / radix / app code.

**Why** The first screen is a drop zone and a toolbar. Until a file is opened, not one line of the
HTML parser runs — but bundled into one chunk, initial load waits on the parser. Measured, the
initial chunk dropped **502kB → 336kB (gzip 158 → 109kB)**, and the parser's 163kB downloads the
moment a file is opened.

Chunk boundaries follow **rate of change**. Ship a fix to app code and the react/radix chunk hashes
stay put, so users re-download only 60kB.

**Constraint** Dynamic import can fail. Every `load()` call sits inside a `try`, with `busy` lowered
in `finally` — outside it, a failed chunk fetch leaves the screen locked solid.
`core/patch.ts` is 0.9kB — no reason to split, so it stays static. Splitting `core/verify.ts` was
measured at 0.16kB and reverted.

**Consequence** `parseBlocks` remains a synchronous pure function. The only thing that went async is
the store's `load()`, and `core/` knows nothing about code splitting (INV-6).

---

### ADR-010 · Document replacement happens only through reservations

**Decision** Every flow that changes the document (open file, drop, open folder, switch within a
bundle, link a folder, OS open) first takes a **reservation** from `store/replacement.ts`, and at
every later step checks that its reservation is still the newest. The screen lock (`replacing`) and
the install generation (`installed`, the claim baseline for late-finishing async work) are changed by
this module alone.

**Why** Race prevention used to be scattered across four flags — `busy` · `replacing` · `doc` (claim)
· `replaceGen` — combined ad hoc by seven entry points. Every place that combined flags leaked:
while a dropped folder was being scanned, after answering the prompt with save, while waiting for a
save to finish, at the instant an earlier save lifted the lock. Adding one more flag plugs one hole
and opens the same hole in the next combination. So "changing the document" was made a single
concept, and the winner rule and the lock rule were attached to that concept (spec §5 · replacement
reservations).

**Rules**

- Reserve at the moment of user action — **before** anything slow (scanning, dialogs, prompts, saves)
- Slow steps pass through the reservation's `guarded` — after waiting, if superseded, it throws
  `Superseded`, which the entry point's try/finally receives as a quiet retreat. Writing the check by
  hand at each step got the same spot wrong nine times (a missed check after an await) — the check is
  enforced by the pipeline, not by memory
- When reservations overlap, the last one wins. A superseded flow cleans up only what it created and
  steps aside — no installing, no notices, no unlocking
- The lock runs from the moment the prompt is answered (`engage`) until install or failure, and the
  whole screen (preview, title field, change list, toolbar) derives from the single `replacing` flag
- The install generation (`installed`) replaces the old `doc` — a save that finishes late checks its
  claim against the same generation
- The saving indicator (`saving`) belongs to the save — it and the reservation never touch each other

**Consequence** `busy` is gone from the state; the screen derives `saving ∨ replacing`.
"What locks while the document is changing, and who wins" reads from the single file `replacement.ts`.

---

### ADR-011 · Preview resource swaps are guarded by one two-way boundary

**Decision** The swap pair list for resource substitution (ADR-009) — `AssetSwap[]`, source spelling
↔ preview spelling — is built in **one place**, `assetSwaps()` in `core/assets.ts`, and everything
crosses a boundary derived from that list (`assetBoundary`): preview document assembly, original
fragments going out for revert, and edits coming back from the preview.

- **Outbound** `toPreview(text, offset)` — picks only the pairs whose fragment range contains the
  original offset and swaps source spelling to preview spelling (the `sourceInner` used by revert)
- **Inbound** `fromPreview(html)` — turns preview spellings back into source spellings. It also
  carries the pairs for spellings the browser rewrote during innerHTML serialization (`&`→`&amp;` and
  other minimal encodings), so whichever spelling comes back is caught. Even the serialized pair's
  source side comes from the original slice — re-encoding a decoded value would collapse
  non-canonical source entities (`&#32;` and the like) into minimal spellings, creating diffs in
  attributes never touched. Only `"`, which would end the value early in the serialized context
  (double-quoted attributes), is turned into `&quot;`

**Why** Markers never land inside a block — blocks do not overlap — but resource swaps do happen
**inside** blocks (`<img src>` within a `<p>`). A transform that exists only outbound cannot stop a
blob URL from riding an inbound edit (commit) into a patch, and a transform that exists only inbound
cannot stop a revert from undoing the preview's swaps. If the two directions compute their spellings
in different places, mismatched pairs are inevitable — so the list is built once and both sides use
only it.

**Constraint** Swapping and then unswapping must reproduce the original **byte for byte** — the value
to restore is **the original string's slice at that position**, not a decode/re-encode of it. When
one preview spelling maps to several source spellings (`logo.png` and `./logo.png`), restore to the
first-seen spelling — either way it names the same file. Blob URLs are random names minted per tab,
so they cannot collide with text the document already had, and references originally written as
`blob:` are external references that never enter the swap list — untouched in either direction.

**Consequence** `core/` remains strings in, strings out (INV-6). The store calls the boundary in
exactly two places: where edits arrive (`onEdit`) and where reverts go out.

---

### ADR-012 · Below `lg` the change list comes over the preview, not beside it

**Decision** From `lg` (1024px) up, the change list stands beside the preview as it always has. Below
that, it becomes a panel that slides over the preview from the right, opened by a header button and
closed by pressing beside it or by jumping to an edit. `store/panel.ts` holds the single open flag.

**Why** The list is 288px wide and does not usefully shrink — it carries lock reasons and the edited
text of each block. In a 500px window that leaves 212px for the document, which is not enough to
read, let alone click a paragraph in. Two things that each need most of the width cannot share it, so
one of them has to be temporary. The preview is the thing being worked on and stays; the list, which
is consulted between edits, comes when asked.

**Reach, not just looks** The layout is CSS, but "off-screen" also has to mean "not tabbable" —
otherwise the panel keeps focusable controls outside the window, which is how the header overflow bug
scrolled the whole document sideways. `useListBeside()` reads the same breakpoint through
`matchMedia` so the closed panel can be marked `inert`, and beside the preview it never is.

**Consequence** The toolbar gains one button that exists only below `lg`. Pressing a change card
closes the panel — the jump it triggers is in the preview underneath, and a jump to somewhere hidden
shows nothing.

### ADR-013 · Control sizes follow the pointer, not the window

**Decision** One Tailwind variant, `touch:` — `@media (pointer: coarse) and (min-width: 360px)` —
carries a second size for everything that is pressed. With a mouse the app stays dense: the header
row is 30px, buttons inside the change list 26px, menu items 24px. Where the pointer is a fingertip
those become 37.5px in the header, in dialogs and in menus, and 33.75px in the list. The sizes live
in the primitives (`components/ui/button.tsx`, `select.tsx`, `input.tsx`), not at the call sites; the
header row has its own button size, `chrome`, so that one name means one height.

**Why the pointer and not the width** A narrow window on a desktop is still driven by a mouse, and a
tablet held in two hands is not, however wide it is. Sizing by window width would fatten a dragged-in
browser window and leave an iPad with 30px targets.

**Why 360px comes into it anyway** Measured with a five-document bundle open — every control the
header can hold — the grown controls put the row 24px past the edge of a 320px window. An
overflowing header is not a cosmetic problem: it scrolls the whole document sideways the moment a
popup inside it opens (spec §4 · ADR-012). Below 360px the dense sizes are what fits, so that is what
those screens get.

**Why in CSS** `lib/media.ts` draws the line: the layout belongs in CSS, and `matchMedia` in
JavaScript is for the cases where the answer changes behaviour — what is reachable by tab, which
sentence is true on this device. A size is looks, so it stays a variant and never becomes state.

**Consequence** A control that opts out of the scale opts out visibly. The save button had been one
step smaller than its neighbours and sat 4px low in the row; with `chrome` there is no size to pass
that could do that again without saying so.
