# nighteditor

A local editing tool: open an HTML document like a Claude artifact in the browser,
click the text to fix it, and get the original back as a **minimal diff**.

The document can be a single file, or a folder or zip that keeps its styles and
images alongside.

Fix one paragraph and the `diff` shows just that one line. Indentation, attribute
order, and entity notation are preserved byte for byte wherever you did not touch.

**https://code0xff.github.io/nighteditor/**

## How to use

Open the address above in a browser and start right away. To run it locally:

```bash
pnpm install
pnpm dev
```

1. Drag an HTML file or a zip into the window, or press **Open a file** (**Open a folder** to open a whole folder)
2. Click text to edit it — `Enter` commits and closes, `Shift+Enter` breaks a line, `Esc` cancels
3. **Save** (`Ctrl+S` / `⌘S` — works inside the preview too)

To get the result as a file without touching the original, use **Download a copy** (`Ctrl+Shift+S`).
`Ctrl+Z` is the browser's undo while editing; outside of editing, it reverts the last change.

Only documents opened via **Open a file** / **Open a folder** can be overwritten. Dropped files
carry no handle, so they are saved as downloads. Overwriting uses the File System Access API,
so it works in **Chromium-based browsers** only.

**Where is the edited result?** — saving tells you which way it went, in a sentence.
`Saved to …` means the original file changed in place — there is nothing to download separately.
`Downloaded …` means a file with the same name landed in your downloads folder.
Before you press anything, the hint on the right of the toolbar
(`Dropped files can't be overwritten`) tells you which path you are on.

Pick the UI language — **한국어 / English** — in the toolbar.

### Install it (PWA)

The install button in the address bar installs it like an app. Once installed:

- **It works offline.** There is no backend, so the entire app is pre-cached
- **The OS can open HTML with it directly.** Right-click a file and open it with
  nighteditor: editing starts without a file picker, and overwriting the original
  still works

For detailed usage and troubleshooting, see [docs/guide.md](docs/guide.md).

## Documents with files alongside

A document that references a separate `deck.css` or `logo.png` renders without those
resources when you open just the one file. Opening a single file does not give the
browser permission to see its neighbors.

Open it with **Open a folder**, or press **Link a folder** when the banner appears,
and it renders as intended. You can also drop a whole zip — the browser unpacks it,
and the files never leave this machine.

Even without the resources attached, **editing and saving are unaffected.** However
the screen looks, the diff of the output is exactly as precise — this tool edits the
original string, not the screen.

## What you can edit

**Blocks that hold text** — paragraphs, headings, table cells, list items.
The document title (`<title>`) is not visible on screen, so it is edited in a
separate field at the top.

The following are **locked.** The right panel shows why.

| Reason | Meaning |
|---|---|
| Code area | Inside `script`·`style`·`textarea` — code, not text |
| Written by a script | The rendered result differs from the source; there is nothing to trace back to |
| Empty in the original | Empty in the source; a script fills in the content |
| Code block | Hand-highlighted code/JSON — editing would break the structure |
| Unclear range | A closing tag is omitted, so the edit range cannot be pinned down |

We chose to say "can't edit this" over fixing it by guesswork.

## Why it is built this way

The edited result is **the original string with patches applied**, not a re-serialized
DOM. When the browser turns the DOM back into a string, normalization rewrites the
whole document — you fix one paragraph and the diff spans the entire file. It also
wastes context when you feed the edited copy back to Claude.

For the design background and rationale, see the ADRs in [docs/architecture.md](docs/architecture.md).

## Development

```bash
pnpm verify   # typecheck + lint + format + test + build
```

Regression tests run against `src/__fixtures__/artifact.html`. When you create a new
rule, first add the structure that motivated it to the fixture, then write the test.

`dev` is the only branch. The working rules start at [AGENTS.md](AGENTS.md).

```bash
git config core.hooksPath .githooks   # once after cloning — forces verify before push
```

## License

[Apache License 2.0](LICENSE) · Copyright 2026 code0xff

It carries a patent clause and allows commercial use as long as changes are stated.
We do not put a header on every source file — this repository is an app that runs as
a whole, not a library whose files scatter into other projects.
