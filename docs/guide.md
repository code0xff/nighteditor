# User guide

The whole journey: open an artifact HTML, click its text to fix it, and get the
original back as a minimal diff.
Design background lives in [architecture.md](architecture.md); detection rules in [spec.md](spec.md).

---

## 1. Getting started

| Method | How | When |
| --- | --- | --- |
| Web | Open https://code0xff.github.io/nighteditor/ | One-off use |
| Install (PWA) | The install button in the address bar | Frequent use. Adds offline and OS integration |
| Local | `pnpm install && pnpm dev` | When working on the code |

Installing adds two things.

- **It works offline.** There is no backend, so the entire app is pre-cached
- **The OS opens files with it directly.** Right-click an HTML file and open it with
  nighteditor: editing starts without a file picker, and overwriting the original
  still works

Files never leave this machine. No uploads, no telemetry.

## 2. Two ways to open a file — this is where saving diverges

| How you open | File handle | Pressing Save |
| --- | --- | --- |
| **Open a file** in the toolbar (Chromium) | Yes | **Overwrites the original file in place** |
| **Open a folder** in the toolbar (Chromium) | Yes | **Overwrites the original file in place** |
| **Drag and drop** into the window | No | **Downloads** under the same name |
| **Open a file** (Firefox·Safari) | No | **Downloads** under the same name |
| Opening or dropping a **zip** | No | **Downloads** under the same name |
| Dropping a **folder** | No | **Downloads** under the same name |

There being two buttons — **Open a file** and **Open a folder** — is the browser's
doing. The file dialog and the folder dialog are separate, so which one to show must
be decided before the click. Drag and drop has no such split — drop a file and it
opens as a file, drop a folder and it opens as a folder.

**Open a folder** opens the whole folder and reads the neighboring files along with
it. The browser then asks once whether to let this site edit files in that folder —
you must allow it for saving to write the original in place.
Declining loses nothing — nothing happens, so just open it again.

Dropping a zip or a folder finds the HTML inside and opens it. If there are several
documents, the one nearest the surface wins (`index.html` first), and you are told
which of them was opened.
The **document list in the toolbar** switches to another document — the zip is not
unpacked again, so it opens instantly. If you have unsaved edits, you are asked first.

In every case, **Download a copy** (the ⤓ button · `Ctrl+Shift+S`) gets you the
result as a separate file. Use it when you do not want to overwrite, or when you
need a backup before editing.

Overwriting uses the File System Access API, so it works **in Chromium-based
browsers only.** Which path you are on shows on the right of the toolbar before
you press Save — if you see `Dropped files can't be overwritten` or
`This browser can't overwrite files`, you are on the download path.
To write to the original directly, do not drop it — reopen it via **Open a file**.

## 3. Editing

The artifact renders as-is. Its own scripts run normally, so behaviors like slide
navigation stay alive — to edit, **click the text itself.**

Hover to see the state.

| What you see | Meaning |
| --- | --- |
| Solid outline | Editable |
| Strong solid outline + faint background | Being edited right now |
| Dashed outline, not-allowed cursor | Locked — clicking shows the reason (§6) |

The outline color follows the document — white where the background is dark, black
where it is light. It can differ block by block within a single document, depending
on where each block sits.

| Action | Result |
| --- | --- |
| Click a block | That block alone enters editing |
| `Enter` | **Commits and closes the edit.** No line break is inserted |
| `Shift+Enter` | Line break **inside the block.** The edit stays open |
| `Ctrl+B` · `Ctrl+I` · `Ctrl+U` | **Bold · italic · underline** on the selected text |
| `Esc` | Cancel. Restores the content from before the edit opened |
| Click outside the block | Commits and closes |
| Paste | Formatting is stripped; plain text only |
| `Ctrl+S` (`⌘S`) | Commits any open edit and **saves.** Works inside the preview too |
| `Ctrl+Shift+S` (`⌘⇧S`) | **Download a copy.** Leaves the original alone; the result goes to a file |
| `Ctrl+Z` (`⌘Z`) | Browser undo while editing. Outside of editing, **reverts the last change** |

While editing, clicks and arrow keys do not pass through to the artifact. The click
that opens or closes an edit does not follow links either — that click's one and
only job is to open or close the edit.

`Ctrl+Z` depends on context — while editing a block, the browser's undo reverses your
typing; after the edit is closed, **the single most recently committed block** goes
back to how it was (same as **Revert** in the change list). If you edited the same
block several times, that block is the most recent. When an input field (such as the
title) has focus, that field's own undo wins, and there is no redo.

**Korean IME input** commits after composition ends. `Enter` during composition is
the key that completes the character, so it does not close the edit — and no line
break is left behind; press it once more after the character is complete to close.
Clicking elsewhere mid-composition does not lose your input.

**The document title** (`<title>`) is not rendered on screen, so no click can reach
it. Edit it in the **Title** field in the toolbar. It takes plain text only, and
`&` `<` `>` are encoded as entities on save.

## 3.1 When styles are missing from the view

A document that **references** a `deck.css` or `logo.png` sitting alongside renders
without those resources when you open just the one file. Opening a single file does
not give the browser permission to see its neighbors.

When that happens, a line like this appears at the top.

```
옆에 있어야 할 파일 3개를 못 찾았어요. 화면만 달라 보일 뿐,
고치고 저장하는 데는 문제없어요                       [폴더 연결하기]
```

Press **Link a folder** and pick the folder holding that document, and it renders as
intended. **Overwrite saving keeps working** — the folder is taken read-only.

You can also drop the folder or the zip whole from the start. In that case, though,
saving becomes a copy download.

> Even without the resources attached, **editing and saving are unaffected.** This
> tool edits the original string, not the screen, so the diff of the output is
> exactly as precise whether the styles are missing or not.
> Linking a folder redraws the preview, so if you have unsaved edits, you are asked first.

## 3.2 Formatting

Select some text and a small bar appears above it: **bold · italic · underline ·
color · size · clear**. Bold, italic, and underline also work via
`Ctrl+B` · `Ctrl+I` · `Ctrl+U`.

Size goes in as a **multiple of the original size**, not an absolute value. Every
document has its own body size; hard-coding an absolute value fights that document's
size system.

Colors are limited to a handful. Offer any color at all, and it is too easy to
overpower the color scheme the document already has.

> Formatting you add lands **inside that block**. Saving changes only that line, and
> reopening the file leaves that paragraph just as editable.

## 4. Reading the right panel

- **Blocks** — the document's total block count and how many are editable.
  `Checking…` means the rendered result is being matched against the source; when it
  finishes, the locks are final
- **Why you can't edit these** — counts per reason (§6)
- **{n} edited** — the list of edited blocks. **Click a card to be taken to that spot
  in the preview.** Each item shows **before (struck through)** and **after** side by side.
  **Revert** on each item, or **Revert all** at the top, restores the original content.
  The preview reflects it too. The block currently selected in the preview is
  outlined in the list

Reverting removes that block from the patch list, so saving changes not a single
byte relative to the original.

**On a small screen the panel is not beside the preview.** Under about 1024px the
document and the list cannot both have room, so the list moves over the preview and
the toolbar gains a button that opens it. Press beside the panel to close it —
pressing a change card also closes it, since the spot it takes you to is underneath.

Under about 768px the panel holds more than the list. The toolbar keeps only what
acts on the document — open, close, save — plus the language and theme buttons, so
the **title field** moves to the top of the panel and **Download a copy** and the
source link to the bottom of it.

**On a touch device the buttons are bigger.** This follows the pointer, not the
window: a narrow window on a desktop is still driven by a mouse and stays compact,
while a tablet gets the larger controls however wide it is. Under about 360px there
is no room for them, and those screens keep the compact sizes.

## 5. Saving and getting the result

With nothing edited, the save button is disabled and `Ctrl+S` does nothing.
The number on the button is the count of edited blocks.

Saving tells you, **in a sentence, how it was saved.**

| Notice | Where the result is |
| --- | --- |
| `Saved to artifact.html (3 edited)` | **The original file.** Same path, new content |
| `Downloaded artifact.html — …` | **Your downloads folder.** Name collisions become `artifact (1).html` |
| `Downloaded a copy of artifact.html (3 edited)` | **Your downloads folder** |
| `Didn't save: …` | Nothing was written. The reason follows |

When it overwrote, there is nothing to download — the original is the result.
If you need a copy, use **⤓ Download a copy** in the toolbar (`Ctrl+Shift+S`) —
unlike Save, it leaves the original alone, and it works even with nothing edited
(a backup of the original as-is). The name stays the same as the original so the
downloaded file can replace it; if the name already exists, the browser numbers it.

**Downloads never touch the original.** Browser downloads can only write to the
downloads folder, and on a name collision they number the file instead of
overwriting. If your browser is set to "ask where to save", you can pick the
original folder in the dialog and overwrite there — in Firefox and Safari this is
the only way to put an edited file back in its place.
To confirm it worked, compare against a copy made before saving.

```bash
cp artifact.html artifact.bak.html   # before editing
diff artifact.bak.html artifact.html # after editing
```

The diff must show **only the lines of the blocks you edited.** Anything beyond that
range is a bug.

### Unsaved edits are protected

If you try to open another file, switch to another document in the bundle, or link a
folder while you have unsaved edits, you are asked first.

```
저장하지 않은 변경이 있어요
3곳을 고쳤어요. deck/appendix.html 문서로 옮기면 고친 내용이 사라져요.

          [취소]  [버리고 계속하기]  [저장하고 계속하기]
```

**Save and continue** saves first, then moves on. For a document that cannot be
overwritten (dropped, or from a zip) the button reads **Save a copy and continue**
instead — there is no place to write the original back to.
If saving fails, you stay right where you are; nothing moves.

When you close the tab or reload, the browser asks on our behalf.

## 6. What cannot be edited

Blocks that cannot be traced back, or whose structure could break, are **locked.**
Clicking a locked block shows the reason at the top. We chose to say "can't edit
this" over fixing it by guesswork.

| Reason | Meaning |
| --- | --- |
| Code area | Inside `script`·`style`·`textarea` — code, not text |
| Written by a script | The rendered result differs from the source; there is nothing in the source to trace back to |
| Empty in the original | Empty in the source; a script fills in the content |
| Code block | Hand-highlighted code·JSON — editing would break the structure |
| Unclear range | A closing tag is omitted, so the edit range cannot be pinned down |

No style or layout editing, no adding, deleting, or moving elements, no image
replacement. Only blocks that hold text (`p`·`h2`·`li`·`td` …) are in scope.

## 7. Language and theme

Pick **한국어 / English** on the right of the toolbar. The choice sticks in the
browser, and switching redraws even the notices already on screen in the new
language. The first visit follows the browser language.
The button next to it switches the light/dark theme. The artifact being edited is
never translated or altered.

Notices appear briefly at the **top right** and fade away. Things that went wrong
(couldn't open, couldn't save) do not fade on their own — you must dismiss them.
If a failure disappears in seconds, whoever missed it assumes it worked.

The GitHub mark at the far right goes to this tool's source. A thing that opens and
edits other people's documents should leave a way, right on screen, to check what it
actually does.

## 8. When something goes wrong

**The save button won't press** — no blocks are edited. Same after reverting
everything. `Ctrl+S` also does nothing under the same condition.

**I wanted a download but it overwrote** — you are in Chromium and opened via
**Open a file** / **Open a folder**. Use **Download a copy** (`Ctrl+Shift+S`) to get
a file without touching the original.

**I edited but the original file is unchanged** — you were on the download path.
Check your downloads folder; to write to the original directly, reopen via
**Open a file** (§2).

**The text I want won't take a click** — it is a locked block. The notice at the top
shows the reason (§6).

**A `Didn't save` notice appeared** — the patches did not match the original, so
nothing was written. Reopen the document and edit again. This behavior exists so a
silently corrupted file is never left behind.

**Korean text breaks into jamo** — the edit was committed before composition ended.
If you can reproduce it, it is a bug.

**It won't open offline** — after installing (PWA), it must be opened online once to
fill the cache.

## 9. What this tool does not do

Collaboration, accounts, or cloud storage; multi-file or zip projects; creating HTML
from scratch; UI languages beyond Korean and English; translating artifact content.
