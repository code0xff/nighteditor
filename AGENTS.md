# nighteditor

A local editing tool for single-file HTML documents generated as Claude artifacts:
click the text in the browser, edit it in place, and get the original back as a
**minimal diff**.

---

## Core principles

Five principles that define this project's identity. They do not change unless the
project's direction does.

### 1. The original is a string

The edited output is **the original string with patches applied**, not a re-serialized DOM.
Code that rewrites the whole document via `outerHTML` / `serialize()` does not get in,
for any reason. Indentation, attribute order, quote style, entity notation, comments,
and the DOCTYPE are preserved byte for byte unless the user touches them.

### 2. Only what you edit changes

Fix one block, and the diff shows only that block.
If `diff original.html edited.html` extends beyond what the user actually edited, that is a bug.

### 3. What we cannot do, we do not do quietly

Text that cannot be traced back to the source, text that scripts generate or mutate,
and regions where the structure could break are **locked against editing, and the user
is shown that fact.**
Saying we cannot fix something always beats fixing it by guesswork.

### 4. The unit of editing is the block

The smallest unit of editing is the block (`p`, `h2`, `li`, `td` …), not the text node.
Inline markup (`<b>`, `<span>`) is not a barrier to editing — it is content preserved
inside the block.

### 5. User files never leave this machine

There is no backend. No uploads, no telemetry, no outbound transfer of any kind.
The moment this principle breaks, the entire security model must be redesigned.

---

## Documents

| Document | Contents |
|---|---|
| [README.md](README.md) | What this tool is and how to use it (for users) |
| [docs/guide.md](docs/guide.md) | User guide — opening files, editing, saving and output, lock reasons, troubleshooting |
| [docs/architecture.md](docs/architecture.md) | Tech stack, module structure, data flow, design decisions (ADRs) and their rationale |
| [docs/spec.md](docs/spec.md) | Product spec, block detection and lock rules, user flows, out of scope, acceptance criteria |
| [docs/rules.md](docs/rules.md) | Development process (plan → implement → review), invariants, commit and separation rules, verification/CI, prohibitions |

Read the relevant document before working. When the docs and the code disagree,
**fix the docs first**, then the code.

Work stacks directly on the default branch `dev` (the only branch we manage).
Every task follows **plan → implement → review**, commits are split by feature,
and `pnpm verify` must pass before push. Details in [docs/rules.md](docs/rules.md) §2·§3·§5.

## Fixtures

`src/__fixtures__/artifact.html` — the synthetic artifact that regression tests target.
It collects, in one file, the structures that caused trouble in real Claude artifacts
(implicit `<tbody>`, empty elements filled by scripts, nested `.code`, entities,
both branches of inline promotion, a global click handler, DOM restructuring).

`src/__fixtures__/bundle.zip` — a document spread across multiple files. Its styles,
images, and script sit alongside and are referenced by relative paths, and the
stylesheet in turn pulls a font from the parent folder.
It is a real zip made by the `zip` command — a hand-assembled header copies its
author's misunderstandings right along with it, so it cannot tell a correct parser
from a broken one.

The measured figures cited in the docs (867 blocks, 40 `.foot` elements, and so on)
come from analyzing **one real artifact** (1,411 lines / 110KB); they are the design's
evidence. That file's contents are not for publication, so it is not in the repository.
When you create a new rule, first add the situation that motivated it to the fixture.
