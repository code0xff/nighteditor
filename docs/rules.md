# Rules

## 1. Invariants

Things the code must uphold. A violation is an unconditional rejection in review.

### INV-1 · The original string is immutable
For the whole session, **no code modifies** the original string that was loaded.
Saving is always the result of a pure function: `applyPatches(original, patches)`.

### INV-2 · No full re-serialization
None of these calls may appear against the whole document.
```
document.documentElement.outerHTML
parse5.serialize(document)
new XMLSerializer().serializeToString(document)
```
Reading a single block's `element.innerHTML` is allowed — that result is applied
only to that block's range.

### INV-3 · Offsets are always in original-string terms
Every offset is an index into **the loaded original string.** Offsets based on the
marker-injected copy or the live DOM never flow into the save path. If an offset
into the marker-injected copy is needed, give it a distinct type.

### INV-4 · Patches apply in descending order
Splice in ascending `innerStart` order and every patch after the first lands on
shifted offsets. The sort is enforced inside the applying function, immediately
before application — callers' ordering is not trusted.

### INV-5 · A locked block can never enter the patch list
Patches for blocks with `locked !== null` are rejected at creation. Blocking in the
UI alone is not enough.

### INV-6 · `core/` knows no browser APIs
No references to `document`, `window`, or `HTMLElement` under `core/`.
Web Encoding globals like `TextDecoder`·`TextEncoder` are banned too — assume they
exist in every runtime and the parser becomes environment-dependent. If bytes must
become characters, decode them inside `core/` by hand, or accept what the caller
(`lib/`) decoded.
Strings in, strings out. This boundary is the entirety of testability.

### INV-7 · `sourceCodeLocation` is always null-guarded
parse5, per spec, **inserts nodes that do not exist in the source.**
The fixture's tables get an auto-inserted `<tbody>`, and that node's location info
is `null`. Code that touches `node.sourceCodeLocation.startTag` without a guard is
rejected.

A node without location info **cannot become a block.** It is passed through,
recursing into its children — nothing more.

### INV-8 · Compare after decoding, save after encoding
Because of HTML entities, the source string and the live text look different even
when the content is the same.

- **Comparison check (ADR-005)** — decode both sides, then compare.
  Compare raw slices and every block containing an entity locks as a false positive
- **Saving** — `&`, `<`, `>` typed by the user must be written encoded as entities.
  Skip it and the document's structure breaks the moment a user types `&`

Decoding/encoding is gathered in one place and never hand-rolled.

### INV-9 · Preview-only artifacts never reach the saved output
The preview document contains things the original does not — `data-ne-id` markers,
injected styles and the agent, `blob:` URLs swapped in when resources attach.
These exist **in the preview only.**

This holds because the save path always starts from the original string
(INV-1·INV-3) — except that patch content alone comes from the preview
(innerHTML). Markers and injected material live outside blocks and cannot enter by
that road, but **resource swaps happen inside blocks too.** So the boundary between
preview and save is two-way (ADR-011): original fragments going out to the preview
are swapped, and edits returning from the preview become patches only after their
blob URLs are restored to the source spelling.
`pipeline.test.ts` checks every run that the saved output holds no `blob:` and no
markers — including documents with resources inside blocks.

---

## 2. Development process

Every task follows **plan → implement → review**, in that order. No skipping.

### 2.1 Plan

Before writing code, settle and agree on:

- What changes (scope and out-of-scope)
- Which files are touched
- Which invariants (§1) it touches
- How it is verified (list of tests)
- How the commits will be split (§3.2)

Non-trivial work uses plan mode or the `Plan` agent.
**Implementation started without a plan is grounds for rejection in review.**

If the docs (`spec.md` / `architecture.md`) are affected, **fix the docs first.**
Code does not get ahead of the docs.

### 2.2 Implement

- Touch only what the plan agreed on. Improvements beyond it go to a separate
  commit, a separate task
- `core/` changes write the tests first, or at minimum land them in the same commit
- `pnpm verify` passes immediately before each commit (§5)

### 2.3 Review

Mandatory before committing.

| Target | Method |
|---|---|
| Correctness · bugs | `/code-review` |
| Duplication · simplification · overengineering | `/simplify` |
| Invariant violations | Manual pass over the §1 checklist |
| Acceptance criteria | The relevant items in `docs/spec.md` §6 |

Findings from review are **fixed, or the reason for not fixing is recorded.**
Nothing is passed over silently.

---

## 3. Commits

### 3.1 Format

```
type: message
```

Use `type(scope): message` only when the scope adds meaning.

| type | Use |
|---|---|
| `feat` | A feature users can feel |
| `fix` | Bug fix |
| `refactor` | Structural change with no behavior change |
| `test` | Adding or fixing tests |
| `docs` | Docs-only change |
| `chore` | Build, dependencies, config |
| `ci` | CI workflow change |
| `perf` | Performance improvement |

- Message in imperative present tense, lowercase start, no period
- One-line summary within 72 characters. If background is needed, the body says **why**
- Identifiers, commit messages, and docs are in English

```
feat(core): add offset-based patch applier
fix(preview): keep markers alive after script DOM rewrite
test(core): assert byte-identical output on zero patches
```

### 3.2 Branches

**`dev` is the default branch, and the only branch we manage.**
Work stacks directly on `dev`. No feature branches, no release branches.

In place of branching, **every commit must be an independently revertible unit**
(§3.3). `dev` is kept in a state where `pnpm verify` always passes.

### 3.3 Split by feature

**One commit = one revertible change.** Split as finely as possible.

Every commit must satisfy all of the following:

- `pnpm verify` passes on that commit alone (no broken intermediate commits)
- It lands directly on `dev`, so reverting must take exactly one revert of that commit
- It is describable in one sentence. An `and` is a signal to split
- Reverting it does not take another feature down with it

Forbidden patterns:

- Refactoring and a feature in one commit — the diff becomes unreadable in review
- Several modules at once — `core/` and `ui/` go separately
- The "everything I did today" lump commit
- Formatting changes mixed into logic changes — formatting goes in its own `chore` commit

---

## 4. Code separation

Different feature, different file. The module boundaries in
`docs/architecture.md` are mirrored by the code as-is.

- **One file has one reason to change.** Parsing and rendering, patches and UI
  state, never share a file
- **Dependencies point one way** — `ui/` → `store/` → `core/`. No reverse imports.
  `core/` imports nothing (parse5 excepted)
- **`preview/` is a separate bundle that runs inside the iframe.** It shares no
  code with `ui/` and communicates only via `postMessage`
- When a file passes 200 lines or starts mixing concerns, split it. Line count is a
  signal; the criterion is concerns
- Export only what is needed. Module-internal helpers stay unexposed

---

## 5. Verification and push

### 5.1 A single entry point

Local and CI run **the exact same command.** Let the two diverge and a local pass
means nothing.

```jsonc
// package.json
"scripts": {
  "guard":     "node scripts/check-lockfiles.mjs",
  "typecheck": "tsc --noEmit",
  "lint":      "eslint .",
  "format":    "prettier --check .",
  "test":      "vitest run",
  "verify":    "pnpm guard && pnpm typecheck && pnpm lint && pnpm format && pnpm test && pnpm build"
}
```

`guard` catches **lockfiles from package managers other than pnpm.**
Pinning pnpm via `packageManager` does not stop `npm install` from just running —
and then a **different dependency tree** than CI's
(`pnpm install --frozen-lockfile`) exists only locally. That difference comes back
as bugs that reproduce only locally, so instead of staying quiet, verify cuts it off.

Lockfiles are not hidden via `.gitignore`. That would block the commit but hide the
file, erasing the chance to notice it in `git status` (core principle 3).

### 5.2 CI calls only `verify`

No verification logic is written into `.github/workflows/ci.yml` directly. It calls
the single line `pnpm verify`. The moment a check exists only in CI, local
pre-checking is disarmed.

```yaml
name: CI
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm verify
```

### 5.3 It must pass before push

**CI is never where a failure is discovered first.** Finish locally before pushing.

```bash
pnpm verify        # required
act -j verify      # optional — run the workflow itself locally (nektos/act)
```

Enforced with a pre-push hook. It uses nothing but git's built-in machinery.

```bash
# .githooks/pre-push
#!/bin/sh
pnpm verify || {
  echo "verify 실패 — push 중단. 고치고 다시 시도할 것."
  exit 1
}
```

```bash
git config core.hooksPath .githooks   # once after cloning
```

The hook is never bypassed with `--no-verify`. If a situation calls for bypassing
it, that situation is the thing to fix.

---

## 6. Tests

### Required: golden tests for the patch engine
Coverage of `core/` is not up for negotiation. At minimum:

- **No-edit identity** — parse, save with 0 patches → byte-identical to the
  original. Verified against the whole fixture. If this breaks, every other test is
  meaningless
- **Single-block minimal diff** — edit 1 block → diff line count within the
  expected range
- **Multi-block ordering** — no offset drift when several blocks change at once
  (INV-4 regression)
- **Inline preservation** — a block containing `<b>` keeps the `<b>` after editing
- **Block detection regression** — block count and per-tag distribution match on
  the fixture
- **Entity round-trip** — edit and save a block containing `&amp;` → entities
  preserved, no false-positive lock (INV-8)
- **Synthetic nodes** — traversal survives an implicit `<tbody>` (INV-7)
- **Preview artifact isolation** — save a document with resources attached → no
  `blob:` and no markers in the output (INV-9)

Fixtures live in `src/__fixtures__/`. When creating a new rule, first add the
structure that motivated it to the fixture, then write the test.

- `artifact.html` — the single-file synthetic artifact
- `bundle.zip` — a document spread across files. A **real zip** made by the `zip`
  command — a hand-assembled header copies its author's misunderstandings right
  along with it, so it cannot tell a correct parser from a broken one. How to
  regenerate it is written in `__fixtures__/load.ts`

### UI tests
`ui/` is not forced into snapshot tests. Areas where manual checking is faster —
IME, contenteditable — are covered by the acceptance checklist (`spec.md` §6)
instead.

---

## 7. Conventions

- TypeScript `strict`. No `any`; where unavoidable, `unknown` + narrowing
- Values that carry offsets keep the unit in the name — `innerStart`, `srcOffset`
  (yes) / `pos`, `idx` (no)
- Exceptions are not swallowed. Parse failures are shown to the user
- Comments say **why.** What the code does, the code says

---

## 8. Prohibitions

| Prohibited | Why |
|---|---|
| Starting implementation without a plan | §2.1 |
| Committing without review | §2.3 |
| `git push --no-verify` | §5.3 — the hook does not exist to be bypassed |
| Broken intermediate commits | §3.3 — bisect becomes meaningless |
| Operating branches other than dev | §3.2 — we do not manage them |
| Checks that exist only in CI | §5.2 — disarms local pre-checking |
| Introducing a rich text framework | ADR-004 — arbitrary markup lost to normalization |
| Adding a backend / API server | Core principle 5 — the security model's premise collapses |
| Auto-saving the original file | Overwriting is always an explicit user action |
| A force-unlock option for locked blocks | Core principle 3 — no freedom to edit wrongly |
| Outbound transfer (telemetry included) | Core principle 5 |
| Replacing offset math with regex | Only the parser knows the exact positions |
