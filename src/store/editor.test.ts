// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureSource } from '../__fixtures__/load.js';
import type { FolderRead, OpenedFile } from '@/lib/fs';
import { countAssets, unsavedCount, useEditor } from './editor.js';
import { useReplacement } from './replacement.js';
import { useToasts } from './toasts.js';
import { useUnsaved } from './unsaved.js';

const dropped = () => new File([fixtureSource()], 'artifact.html', { type: 'text/html' });

beforeEach(() => {
  // notice is cleared too. Left over, a previous test's notice leaks into the
  // next assertion. unsaved as well — left over, the next test's adopt stops to
  // ask about edits that do not exist.
  useEditor.setState({
    file: null,
    source: '',
    blocks: [],
    previewDoc: '',
    patches: new Map(),
    editOrder: [],
    revertQueue: [],
    notice: null,
    unsaved: false,
    savedText: '',
    saving: false,
    pendingText: null,
  });
  // The lock lives in the reservation store — a lock left up by a previous test would get edits refused.
  useReplacement.setState({ replacing: false });
  useUnsaved.setState({ why: null, answer: null });
  useToasts.getState().clear();
});

describe('editor · opening a file (the dynamic-import path)', () => {
  it('parses the dropped file and fills blocks and the preview document', async () => {
    await useEditor.getState().loadDropped(dropped());

    const { source, blocks, previewDoc, notice } = useEditor.getState();
    // The parser loads dynamically, so without awaiting load all of this stays empty (ADR-008).
    expect(notice).toBeNull();
    expect(blocks.length).toBeGreaterThan(0);
    expect(source).toBe(fixtureSource());
    expect(previewDoc).toContain('data-ne-id');
  });

  it('unlocks when the load finishes — no freezing while waiting on the chunk', async () => {
    await useEditor.getState().loadDropped(dropped());
    expect(useReplacement.getState().replacing).toBe(false);
  });
});

describe('editor · reverting the last change (Ctrl+Z)', () => {
  /** Picks two editable blocks and edits each */
  async function twoEdits() {
    await useEditor.getState().loadDropped(dropped());
    const [a, b] = useEditor.getState().blocks.filter((x) => x.locked === null);
    if (!a || !b) throw new Error('편집 가능한 블록이 둘 필요하다');
    useEditor.getState().onEdit(a.id, 'A 수정');
    useEditor.getState().onEdit(b.id, 'B 수정');
    return { a, b };
  }

  it('reverts only the most recently edited block', async () => {
    const { a, b } = await twoEdits();

    useEditor.getState().undoLast();

    const { patches } = useEditor.getState();
    expect(patches.has(b.id)).toBe(false);
    expect(patches.get(a.id)).toBe('A 수정');
  });

  it('a re-edited block becomes the most recent — Map order cannot tell', async () => {
    const { a, b } = await twoEdits();
    useEditor.getState().onEdit(a.id, 'A 다시 수정');

    useEditor.getState().undoLast();

    const { patches } = useEditor.getState();
    expect(patches.has(a.id)).toBe(false);
    expect(patches.get(b.id)).toBe('B 수정');
  });

  it('a reverted block drops out of the order — pressing twice does not revive it', async () => {
    const { a, b } = await twoEdits();

    useEditor.getState().undoLast();
    useEditor.getState().undoLast();
    useEditor.getState().undoLast();

    expect(useEditor.getState().patches.size).toBe(0);
    expect(useEditor.getState().editOrder).toEqual([]);
    expect(useEditor.getState().revertQueue.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it('does nothing when nothing was edited', async () => {
    await useEditor.getState().loadDropped(dropped());

    useEditor.getState().undoLast();

    expect(useEditor.getState().revertQueue).toEqual([]);
  });
});

describe('editor · downloading a copy', () => {
  it('downloads the pristine original even with no patches — for a backup before editing', () => {
    const url = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', { ...URL, createObjectURL: url, revokeObjectURL: vi.fn() });

    useEditor.setState({
      file: { name: 'artifact.html', text: fixtureSource(), handle: null },
      source: fixtureSource(),
      blocks: [],
      patches: new Map(),
    });
    useEditor.getState().downloadCopy();

    expect(url).toHaveBeenCalledOnce();
    expect(useEditor.getState().notice).toEqual({
      key: 'notice.copyDownloaded',
      params: { name: 'artifact.html', count: 0 },
    });
    vi.unstubAllGlobals();
  });

  it('does nothing without a file', () => {
    useEditor.getState().downloadCopy();
    expect(useEditor.getState().notice).toBeNull();
  });
});

describe('editor · saving', () => {
  it('does not save with nothing edited — so Ctrl+S never rewrites identical content', async () => {
    await useEditor.getState().loadDropped(dropped());

    await useEditor.getState().save();

    // Nothing happened, so there is nothing to announce.
    expect(useEditor.getState().notice).toBeNull();
  });
});

describe('editor · opening a folder', () => {
  /** Mimics the handles showDirectoryPicker returns — file handles have getFile, folders have entries */
  function fakeDir(files: Record<string, string>) {
    const entries = Object.entries(files).map(([name, body]) => [
      name,
      {
        name,
        getFile: () => Promise.resolve(new File([body], name, { type: 'text/html' })),
        createWritable: () =>
          Promise.resolve({ write: () => Promise.resolve(), close: () => Promise.resolve() }),
      },
    ]);
    return {
      name: 'deck',
      entries: () => ({
        [Symbol.asyncIterator]: () => {
          let at = 0;
          return {
            next: () =>
              Promise.resolve(
                at < entries.length
                  ? { value: entries[at++], done: false }
                  : { value: undefined, done: true }
              ),
          };
        },
      }),
    };
  }

  function withPicker(dir: unknown) {
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = () =>
      Promise.resolve(dir);
  }

  it('opens the document in the folder and brings its writable handle along', async () => {
    // What was opened via the dialog gets overwritten — folders must be no different.
    withPicker(fakeDir({ 'index.html': '<p>본문</p>', 'style.css': 'p{color:red}' }));

    await useEditor.getState().openFolder();

    const { file, blocks, docPath } = useEditor.getState();
    expect(file?.name).toBe('index.html');
    expect(docPath).toBe('index.html');
    expect(file?.handle).not.toBeNull();
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('nothing happens when edit permission is refused', async () => {
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = () =>
      Promise.reject(new DOMException('사용자가 취소', 'AbortError'));

    await useEditor.getState().openFolder();

    expect(useEditor.getState().file).toBeNull();
    expect(useEditor.getState().notice).toBeNull();
    expect(useReplacement.getState().replacing).toBe(false);
  });

  it('a folder without HTML says why', async () => {
    withPicker(fakeDir({ 'style.css': 'p{color:red}' }));

    await useEditor.getState().openFolder();

    expect(useEditor.getState().notice).toEqual({ key: 'notice.bundleNoDocument' });
  });
});

describe('editor · knowing whether it was saved', () => {
  it('saving reaches a state that will not re-ask', async () => {
    // patches survive a save (INV-1). Judged by them, it would keep asking even after saving.
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    expect(useEditor.getState().unsaved).toBe(true);

    await useEditor.getState().save();

    expect(useEditor.getState().unsaved).toBe(false);
    expect(useEditor.getState().patches.size).toBe(1);
  });

  it('editing again after a save produces something to save again', async () => {
    await useEditor.getState().loadDropped(dropped());
    const [a, b] = useEditor.getState().blocks.filter((x) => x.locked === null);
    useEditor.getState().onEdit(a?.id ?? -1, '고친 값');
    await useEditor.getState().save();

    useEditor.getState().onEdit(b?.id ?? -1, '또 고친 값');

    expect(useEditor.getState().unsaved).toBe(true);
  });

  it('a revert also diverges from the file', async () => {
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((x) => x.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    await useEditor.getState().save();

    useEditor.getState().revert(target?.id ?? -1);

    expect(useEditor.getState().unsaved).toBe(true);
  });

  it('reverting a never-saved edit comes out clean again', async () => {
    // With unsaved only ever rising, it would re-ask even though output and file match (spec §5).
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((x) => x.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    expect(useEditor.getState().unsaved).toBe(true);

    useEditor.getState().revert(target?.id ?? -1);

    expect(useEditor.getState().unsaved).toBe(false);
  });

  it('revert-all also comes out clean once it matches the file', async () => {
    await useEditor.getState().loadDropped(dropped());
    const [a, b] = useEditor.getState().blocks.filter((x) => x.locked === null);
    useEditor.getState().onEdit(a?.id ?? -1, 'A 수정');
    useEditor.getState().onEdit(b?.id ?? -1, 'B 수정');

    useEditor.getState().revertAll();

    expect(useEditor.getState().unsaved).toBe(false);
  });

  it('editing the title and typing it back comes out clean', async () => {
    // An edit undone by hand also has nothing to lose once output matches file.
    await useEditor.getState().loadDropped(dropped());
    const title = useEditor.getState().blocks.find((x) => x.rcdata);
    useEditor.getState().onEdit(title?.id ?? -1, '새 제목');
    expect(useEditor.getState().unsaved).toBe(true);

    useEditor.getState().onEdit(title?.id ?? -1, title?.sourceText ?? '');

    expect(useEditor.getState().unsaved).toBe(false);
  });

  it('does not save with nothing to save', async () => {
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((x) => x.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    await useEditor.getState().save();

    // Blocks the wasted rewrite of identical content.
    expect(await useEditor.getState().save()).toBe(false);
  });
});

describe('editor · zip errors are notified through the language pack', () => {
  it('opening a non-zip as a zip carries the reason as a message key, not a sentence (spec §1)', async () => {
    // Attaching ZipError's raw text would leak an internal Korean sentence into the English UI.
    await useEditor.getState().loadDropped(new File(['이건 zip 이 아니다'], 'bad.zip'));

    expect(useEditor.getState().notice).toEqual({
      key: 'notice.openFailedDetail',
      params: { detail: { key: 'zip.notZip', params: {} } },
    });
  });
});

describe('editor · re-reads the disk when attaching assets', () => {
  it('the saved content survives linking a folder after a save', async () => {
    // source stays as opened (INV-1). Redrawn from it, saved edits vanish from
    // the screen, and a later save overwrites the disk with the old content.
    const saved = '<html><body><p>저장된 뒤의 내용</p></body></html>';
    const handle = {
      name: 'deck.html',
      getFile: () => Promise.resolve(new File([saved], 'deck.html', { type: 'text/html' })),
      createWritable: () =>
        Promise.resolve({ write: () => Promise.resolve(), close: () => Promise.resolve() }),
    };
    await useEditor.getState().adopt({
      name: 'deck.html',
      text: '<html><body><p>열었을 때의 내용</p></body></html>',
      handle,
    });
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = () =>
      Promise.resolve({
        name: 'deck',
        entries: () => ({
          [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true }) }),
        }),
      });

    await useEditor.getState().linkFolder();

    expect(useEditor.getState().source).toBe(saved);
  });
});

describe('editor · finds assets from the base <base href> moved (spec §5.1)', () => {
  it('finds files to attach relative to the base directory', async () => {
    // Looking only at the document's place counts style.css missing even with assets/style.css right there.
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });
    await useEditor.getState().loadFolder({
      files: new Map([
        [
          'index.html',
          new File(
            [
              '<html><head><base href="assets/"><link rel="stylesheet" href="style.css"></head>' +
                '<body><p>본문</p></body></html>',
            ],
            'index.html'
          ),
        ],
        ['assets/style.css', new File(['p{color:red}'], 'style.css')],
      ]),
      handles: new Map(),
      truncated: false,
    });

    expect(useEditor.getState().assetPaths).toContain('assets/style.css');
    expect(countAssets(useEditor.getState())).toEqual({ linked: 1, missing: 0 });
    vi.unstubAllGlobals();
  });

  it('with base pointing outside, relative references are not counted as missing files', async () => {
    await useEditor.getState().loadFolder({
      files: new Map([
        [
          'index.html',
          new File(
            [
              '<html><head><base href="https://cdn.example/"><link rel="stylesheet" href="style.css"></head>' +
                '<body><p>본문</p></body></html>',
            ],
            'index.html'
          ),
        ],
      ]),
      handles: new Map(),
      truncated: false,
    });

    expect(useEditor.getState().assetPaths).toEqual([]);
    // Nothing to swap, so no blob: enters the preview.
    expect(useEditor.getState().previewDoc).not.toContain('blob:');
  });
});

describe('editor · for a handleless document the saved file is the downloaded copy (spec §5)', () => {
  it('the saved content survives linking a folder after a download save', async () => {
    // Without a handle, reread returns file.text as-is. Unless saving swaps that
    // text for the output, folder linking rolls the preview back to the pre-save
    // content.
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });
    await useEditor.getState().adopt({
      name: 'deck.html',
      text: '<html><body><p>열었을 때의 내용</p></body></html>',
      handle: null,
    });
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 내용');

    expect(await useEditor.getState().save()).toBe(true);
    const output = useEditor.getState().savedText;
    expect(output).toContain('고친 내용');

    pickerReturns(fakeTree('assets', {}));
    await useEditor.getState().linkFolder();

    expect(useEditor.getState().source).toBe(output);
    expect(useEditor.getState().unsaved).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('editor · spots a review pointed out', () => {
  it('not busy while asking — the dialog save button must be pressable', async () => {
    // Busy, "save and continue" is disabled and the remaining choices are only discard and cancel.
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = () =>
      Promise.resolve({
        name: 'deck',
        entries: () => ({
          [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true }) }),
        }),
      });

    const asking = useEditor.getState().linkFolder();
    for (let tries = 0; useUnsaved.getState().why === null && tries < 1000; tries++) {
      await Promise.resolve();
    }
    const savingWhileAsking = useEditor.getState().saving;
    const replacingWhileAsking = useReplacement.getState().replacing;
    useUnsaved.getState().reply('cancel');
    await asking;

    expect(savingWhileAsking).toBe(false);
    expect(replacingWhileAsking).toBe(false);
  });

  it('edits during a replacement are refused with a notice', async () => {
    // Edits made after the answer, while the new document is being read, disappear
    // the moment the new state installs. Accepted and then dropped, they vanish
    // silently (Principle 3) — so they are refused with a notice instead.
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useReplacement.setState({ replacing: true });

    useEditor.getState().onEdit(target?.id ?? -1, '사라질 편집');

    expect(useEditor.getState().patches.size).toBe(0);
    expect(useEditor.getState().unsaved).toBe(false);
    expect(useToasts.getState().toasts.some((t) => t.notice.key === 'app.editWhileReplacing')).toBe(
      true
    );
  });

  it('reverts during a replacement are refused with a notice', async () => {
    // What the list shows is still the previous document — the reverted patches
    // and the revert bound for the preview alike have nowhere to go at install.
    // The buttons lock, but Ctrl+Z can fire any time (spec §4).
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    useReplacement.setState({ replacing: true });

    useEditor.getState().revert(target?.id ?? -1);
    useEditor.getState().undoLast();
    useEditor.getState().revertAll();

    expect(useEditor.getState().patches.get(target?.id ?? -1)).toBe('고친 값');
    expect(useEditor.getState().revertQueue).toEqual([]);
    expect(useToasts.getState().toasts.some((t) => t.notice.key === 'app.editWhileReplacing')).toBe(
      true
    );
  });

  it('replacing stands while opening and clears when done', async () => {
    // The screen (title field, preview) locks on this value. Never raised, there
    // is nothing to lock on; never cleared, the new document can never be edited.
    const seen: boolean[] = [];
    const unsub = useReplacement.subscribe((s) => seen.push(s.replacing));
    await useEditor.getState().loadDropped(dropped());
    unsub();

    expect(seen).toContain(true);
    expect(useReplacement.getState().replacing).toBe(false);
  });

  it('replacing clears even when opening fails — the current document must stay editable', async () => {
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);

    await useEditor.getState().loadDropped(new File(['x'], 'bad.zip', { type: 'application/zip' }));

    expect(useReplacement.getState().replacing).toBe(false);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    expect(useEditor.getState().patches.size).toBe(1);
  });

  it('clicking in and just leaving is not an edit', async () => {
    // Counted as something to save, it would re-ask with nothing edited at all.
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);

    useEditor.getState().onEdit(target?.id ?? -1, target?.sourceInner ?? '', true);

    expect(useEditor.getState().patches.size).toBe(0);
    expect(useEditor.getState().unsaved).toBe(false);
  });
});

/** Waits for the dialog and answers in the user's stead — where a person would press a button */
async function answerWith(choice: 'save' | 'discard' | 'cancel'): Promise<void> {
  for (let tries = 0; useUnsaved.getState().why === null; tries++) {
    if (tries > 1000) throw new Error('대화상자가 뜨지 않았다');
    await Promise.resolve();
  }
  useUnsaved.getState().reply(choice);
}

/** Mimics a showDirectoryPicker folder: a string is a file, an object a subfolder */
type Tree = { [name: string]: string | Tree };
function fakeTree(name: string, tree: Tree): unknown {
  const entries = Object.entries(tree).map(([entryName, value]) => [
    entryName,
    typeof value === 'string'
      ? {
          name: entryName,
          getFile: () => Promise.resolve(new File([value], entryName, { type: 'text/html' })),
        }
      : fakeTree(entryName, value),
  ]);
  return {
    name,
    entries: () => ({
      [Symbol.asyncIterator]: () => {
        let at = 0;
        return {
          next: () =>
            Promise.resolve(
              at < entries.length
                ? { value: entries[at++], done: false }
                : { value: undefined, done: true }
            ),
        };
      },
    }),
  };
}

function pickerReturns(dir: unknown): void {
  (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = () =>
    Promise.resolve(dir);
}

/**
 * Mimics a writable file handle. What was written is visible from outside.
 * `sameEntry` defaults to false — being the same file is something a test must
 * declare explicitly.
 */
function fakeHandle(
  name: string,
  text: () => string,
  writes: string[] = [],
  sameEntry: () => boolean = () => false
) {
  return {
    name,
    isSameEntry: () => Promise.resolve(sameEntry()),
    getFile: () => Promise.resolve(new File([text()], name, { type: 'text/html' })),
    createWritable: () =>
      Promise.resolve({
        write: (data: string) => {
          writes.push(data);
          return Promise.resolve();
        },
        close: () => Promise.resolve(),
      }),
  };
}

describe('editor · stops when the disk cannot be re-read', () => {
  it('a failed re-read of a folder document says why instead of opening blank', async () => {
    // The old code swallowed the failure and continued with the empty placeholder, opening the chosen document as a blank screen.
    let reads = 0;
    const handle = {
      name: 'index.html',
      getFile: () => {
        reads++;
        return reads === 1
          ? Promise.resolve(new File(['<p>본문</p>'], 'index.html', { type: 'text/html' }))
          : Promise.reject(new Error('디스크에서 사라졌다'));
      },
    };
    pickerReturns({
      name: 'deck',
      entries: () => ({
        [Symbol.asyncIterator]: () => {
          let given = false;
          return {
            next: () => {
              if (given) return Promise.resolve({ value: undefined, done: true });
              given = true;
              return Promise.resolve({ value: ['index.html', handle], done: false });
            },
          };
        },
      }),
    });

    await useEditor.getState().openFolder();

    expect(useEditor.getState().file).toBeNull();
    expect(useEditor.getState().notice).toEqual({
      key: 'notice.openFailedDetail',
      params: { detail: '디스크에서 사라졌다' },
    });
    expect(useReplacement.getState().replacing).toBe(false);
  });

  it('a failed re-read during folder linking does not redraw from the old bytes', async () => {
    // Drawn from the old bytes, saved edits vanish from the screen, and a later
    // save overwrites the disk's new content with the old.
    const handle = {
      name: 'deck.html',
      getFile: () => Promise.reject(new Error('디스크에서 사라졌다')),
      createWritable: () =>
        Promise.resolve({ write: () => Promise.resolve(), close: () => Promise.resolve() }),
    };
    await useEditor.getState().adopt({
      name: 'deck.html',
      text: '<html><body><p>열었을 때의 내용</p></body></html>',
      handle,
    });
    pickerReturns(fakeTree('assets', {}));

    await useEditor.getState().linkFolder();

    expect(useEditor.getState().notice).toEqual({
      key: 'notice.openFailedDetail',
      params: { detail: '디스크에서 사라졌다' },
    });
    // The screen being viewed must stay alive as it was.
    expect(useEditor.getState().source).toContain('열었을 때의 내용');
    expect(useReplacement.getState().replacing).toBe(false);
  });
});

describe('editor · finding no document in a truncated scan tells that circumstance too (spec §5.1)', () => {
  it('a truncated dropped folder does not just say "no document"', async () => {
    // The document may have been beyond the limit — declaring it absent would be a lie (Principle 3).
    await useEditor.getState().loadFolder({
      files: new Map([['notes.txt', new File(['메모'], 'notes.txt')]]),
      handles: new Map(),
      truncated: true,
    });

    expect(useEditor.getState().notice).toEqual({
      key: 'notice.bundleNoDocumentTruncated',
      params: { count: 1 },
    });
  });

  it('same for a folder picked through the dialog — a document beyond the depth limit is not "not found"', async () => {
    let tree: Tree = { 'index.html': '<p>깊다</p>' };
    for (let i = 0; i < 9; i++) tree = { [`d${i}`]: tree };
    pickerReturns(fakeTree('deck', tree));

    await useEditor.getState().openFolder();

    expect(useEditor.getState().notice).toEqual({
      key: 'notice.bundleNoDocumentTruncated',
      params: { count: 0 },
    });
  });
});

describe('editor · a file the OS opened also asks about edits', () => {
  it('with edits in progress it shows the dialog, and cancelling stays on the current document', async () => {
    // Even via launchQueue this is opening another file. A silent switch loses the edits (spec §4).
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    const adopting = useEditor
      .getState()
      .adopt({ name: 'another.html', text: '<p>다른 파일</p>', handle: null });
    await answerWith('cancel');
    await adopting;

    expect(useEditor.getState().file?.name).toBe('artifact.html');
    expect(useEditor.getState().patches.size).toBe(1);
  });

  it('choosing discard switches to the new file', async () => {
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    const adopting = useEditor.getState().adopt({
      name: 'another.html',
      text: '<html><body><p>다른 파일</p></body></html>',
      handle: null,
    });
    await answerWith('discard');
    await adopting;

    expect(useEditor.getState().file?.name).toBe('another.html');
    expect(useEditor.getState().patches.size).toBe(0);
  });
});

describe('editor · folder linking leaves no handles in the bundle', () => {
  it('switching to another document in the linked folder opens without a handle', async () => {
    // Linking is read-only (read). With its handle left in the bundle, the
    // switched-to document's save would claim "overwrite" and only then fail for
    // lack of write permission.
    const handle = fakeHandle('deck.html', () => '<html><body><p>본문</p></body></html>');
    await useEditor.getState().adopt({
      name: 'deck.html',
      text: '<html><body><p>본문</p></body></html>',
      handle,
    });
    pickerReturns(
      fakeTree('assets', { 'other.html': '<html><body><p>다른 문서</p></body></html>' })
    );

    await useEditor.getState().linkFolder();
    expect(useEditor.getState().bundleHandles.size).toBe(0);

    await useEditor.getState().openFromBundle('other.html');

    expect(useEditor.getState().file?.name).toBe('other.html');
    expect(useEditor.getState().file?.handle).toBeNull();
  });

  it('a document opened as a single file keeps its handle alive when its own folder is linked — the name is the path', async () => {
    // A document opened via the file dialog has no bundle path. Left as-is, keep
    // ends up empty, and after linking a folder and a round trip to another
    // document it opens without a handle — a save that claimed overwrite is
    // silently demoted to download-a-copy (spec §5.1 · keeping the handle).
    const text = '<html><body><p>본문</p></body></html>';
    const onDisk = '<html><body><p>저장한 뒤의 본문</p></body></html>';
    const handle = fakeHandle(
      'index.html',
      () => onDisk,
      [],
      () => true
    );
    // The same shape as adopt (file open, OS open) — no path.
    useEditor.setState({ file: { name: 'index.html', text, handle } });
    pickerReturns(
      fakeTree('deck', {
        'index.html': text,
        'other.html': '<html><body><p>다른 문서</p></body></html>',
      })
    );

    await useEditor.getState().linkFolder();
    expect(useEditor.getState().docPath).toBe('index.html');
    expect(useEditor.getState().bundleHandles.get('index.html')).toBe(handle);

    await useEditor.getState().openFromBundle('other.html');
    await useEditor.getState().openFromBundle('index.html');

    expect(useEditor.getState().file?.handle).toBe(handle);
    // It must come back to the disk's current content, not the bundle's old bytes.
    expect(useEditor.getState().source).toBe(onDisk);
  });

  it("only the current document's write handle is kept — overwrite survives a round trip (spec §5.1)", async () => {
    // With every handle dropped, the returning document opens from the old bytes
    // read at link time, and saving is silently demoted to download-a-copy.
    const text = '<html><body><p>본문</p></body></html>';
    const onDisk = '<html><body><p>저장한 뒤의 본문</p></body></html>';
    const handle = fakeHandle(
      'index.html',
      () => onDisk,
      [],
      () => true
    );
    useEditor.setState({ file: { name: 'index.html', text, handle, path: 'index.html' } });
    pickerReturns(
      fakeTree('deck', {
        'index.html': text,
        'other.html': '<html><body><p>다른 문서</p></body></html>',
      })
    );

    await useEditor.getState().linkFolder();
    expect(useEditor.getState().bundleHandles.get('index.html')).toBe(handle);

    await useEditor.getState().openFromBundle('other.html');
    await useEditor.getState().openFromBundle('index.html');

    expect(useEditor.getState().file?.handle).toBe(handle);
    // It must come back to the disk's current content, not the bundle's old bytes.
    expect(useEditor.getState().source).toBe(onDisk);
  });
});

describe('editor · handles are kept only where the same file is proven (spec §5.1)', () => {
  it("does not hang the write handle on someone else's index.html path that merely shares the name", async () => {
    // The path the basename fallback picked may be someone else's file. With the
    // handle kept, this file opens there instead on the round trip, and saves
    // overwrite someone else's spot.
    const mine = '<html><body><p>내 문서</p></body></html>';
    const theirs = '<html><body><p>남의 index</p></body></html>';
    const handle = fakeHandle('index.html', () => mine); // isSameEntry → false
    useEditor.setState({ file: { name: 'index.html', text: mine, handle } });
    pickerReturns(
      fakeTree('deck', {
        'index.html': theirs,
        'other.html': '<html><body><p>다른 문서</p></body></html>',
      })
    );

    await useEditor.getState().linkFolder();

    expect(useEditor.getState().bundleHandles.size).toBe(0);

    // The round trip must open the document actually in the folder — not my handle's content.
    await useEditor.getState().openFromBundle('other.html');
    await useEditor.getState().openFromBundle('index.html');
    expect(useEditor.getState().file?.handle).toBeNull();
    expect(useEditor.getState().source).toBe(theirs);
  });

  it('an unproven document is not a bundle member — saving does not swap out another document in the folder', async () => {
    // The old code withheld only the handle while adopting the overlapping path
    // as docPath. Saving then swapped that path's bundle content for this
    // document's output, and opening the folder's real index.html from the list
    // was silently blocked as "already open" (spec §5.1).
    const mine = '<html><body><p>내 문서</p></body></html>';
    const theirs = '<html><body><p>남의 index</p></body></html>';
    const writes: string[] = [];
    const handle = fakeHandle('index.html', () => mine, writes); // isSameEntry → false
    useEditor.setState({ file: { name: 'index.html', text: mine, handle } });
    pickerReturns(
      fakeTree('deck', {
        'index.html': theirs,
        'other.html': '<html><body><p>다른 문서</p></body></html>',
      })
    );

    await useEditor.getState().linkFolder();
    expect(useEditor.getState().docPath).toBe('');

    // Edit and save my document — the output goes to my file (the handle), and the bundle must stay untouched.
    const target = useEditor.getState().blocks.find((b) => b.locked === null && !b.rcdata);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    expect(await useEditor.getState().save()).toBe(true);
    expect(writes[0]).toContain('고친 값');

    // The document at the overlapping path is not the current one, so it can be opened from the list, and the folder's content must appear.
    await useEditor.getState().openFromBundle('index.html');
    expect(useEditor.getState().source).toBe(theirs);
  });
});

describe('editor · edits made during a save', () => {
  it('an edit committed while the file is being written remains unsaved', async () => {
    // Clearing unsaved unconditionally would read that edit as "already saved",
    // and it would vanish without a question when the next file opens.
    let releaseWrite: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (releaseWrite = resolve));
    const handle = {
      name: 'deck.html',
      getFile: () => Promise.resolve(new File(['<p>하나</p>'], 'deck.html', { type: 'text/html' })),
      createWritable: () => Promise.resolve({ write: () => gate, close: () => Promise.resolve() }),
    };
    await useEditor.getState().adopt({
      name: 'deck.html',
      text: '<html><body><p>하나</p><p>둘</p></body></html>',
      handle,
    });
    const [a, b] = useEditor.getState().blocks.filter((x) => x.locked === null);
    useEditor.getState().onEdit(a?.id ?? -1, 'A 수정');

    const saving = useEditor.getState().save();
    useEditor.getState().onEdit(b?.id ?? -1, 'B 수정');
    releaseWrite?.();
    await saving;

    expect(useEditor.getState().unsaved).toBe(true);
  });

  it('reverting mid-write does not clear the dirtiness — the disk is about to hold that output', async () => {
    // Compared to the old savedText, the moment of the revert reads as
    // nothing-to-lose; closing the tab in that window closes without warning, and
    // screen (original) and disk (output) disagree (spec §5).
    let releaseWrite: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (releaseWrite = resolve));
    const handle = {
      name: 'deck.html',
      getFile: () => Promise.resolve(new File(['<p>하나</p>'], 'deck.html', { type: 'text/html' })),
      createWritable: () => Promise.resolve({ write: () => gate, close: () => Promise.resolve() }),
    };
    await useEditor.getState().adopt({
      name: 'deck.html',
      text: '<html><body><p>하나</p></body></html>',
      handle,
    });
    const target = useEditor.getState().blocks.find((x) => x.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    const saving = useEditor.getState().save();
    useEditor.getState().revert(target?.id ?? -1);

    // During the write and after it, the screen differs from the disk.
    expect(useEditor.getState().unsaved).toBe(true);
    releaseWrite?.();
    await saving;
    expect(useEditor.getState().unsaved).toBe(true);
    expect(useEditor.getState().pendingText).toBeNull();
  });

  it('a failed write re-measures against the old content — the file is untouched', async () => {
    // Left measured against the failed output, a screen that came to match it
    // mid-write would pose as saved. A screen reverted back to matching the file
    // has nothing to lose.
    let failWrite: ((e: Error) => void) | undefined;
    const gate = new Promise<void>((_, reject) => (failWrite = reject));
    const handle = {
      name: 'deck.html',
      getFile: () => Promise.resolve(new File(['<p>하나</p>'], 'deck.html', { type: 'text/html' })),
      createWritable: () => Promise.resolve({ write: () => gate, close: () => Promise.resolve() }),
    };
    await useEditor.getState().adopt({
      name: 'deck.html',
      text: '<html><body><p>하나</p></body></html>',
      handle,
    });
    const target = useEditor.getState().blocks.find((x) => x.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    const saving = useEditor.getState().save();
    useEditor.getState().revert(target?.id ?? -1);
    failWrite?.(new Error('디스크가 가득 참'));

    await expect(saving).resolves.toBe(false);
    expect(useEditor.getState().unsaved).toBe(false);
    expect(useEditor.getState().pendingText).toBeNull();
  });

  it('comes out clean when nothing happened during the write', async () => {
    const handle = fakeHandle('deck.html', () => '<html><body><p>하나</p></body></html>');
    await useEditor.getState().adopt({
      name: 'deck.html',
      text: '<html><body><p>하나</p></body></html>',
      handle,
    });
    const target = useEditor.getState().blocks.find((x) => x.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    await useEditor.getState().save();

    expect(useEditor.getState().unsaved).toBe(false);
  });
});

describe('editor · a save result arriving after a switch is discarded (spec §5)', () => {
  it('opening another document mid-write keeps the late-finishing save out of the new state', async () => {
    // The old code's save-completion callback never checked the document, so the
    // old output landed in the new document's savedText and file.text, with a
    // "saved" notice on top.
    let releaseWrite: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (releaseWrite = resolve));
    const oldText = '<html><body><p>옛 문서</p></body></html>';
    const newText = '<html><body><p>새 문서</p></body></html>';
    const handle = {
      name: 'old.html',
      getFile: () => Promise.resolve(new File([oldText], 'old.html', { type: 'text/html' })),
      createWritable: () => Promise.resolve({ write: () => gate, close: () => Promise.resolve() }),
    };
    await useEditor.getState().adopt({ name: 'old.html', text: oldText, handle });
    const target = useEditor.getState().blocks.find((b) => b.locked === null && !b.rcdata);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    const saving = useEditor.getState().save();
    // Switch to another document while the file is being written — the edits in progress are answered with discard.
    const adopting = useEditor.getState().adopt({ name: 'new.html', text: newText, handle: null });
    await answerWith('discard');
    await adopting;
    releaseWrite?.();
    expect(await saving).toBe(false);

    const s = useEditor.getState();
    expect(s.file?.name).toBe('new.html');
    // The new document's saved text and content must stay exactly the new document's.
    expect(s.savedText).toBe(newText);
    expect(s.file?.text).toBe(newText);
    expect(s.unsaved).toBe(false);
    // The previous document's "saved" never appears over the new one.
    expect(s.notice).toBeNull();
    expect(s.saving).toBe(false);
  });

  it('a save failure arriving after a switch is not notified on the new document either', async () => {
    // A nameless failure notice reads as the current document's — sending the user hunting around a perfectly fine new document.
    let failWrite: ((e: Error) => void) | undefined;
    const gate = new Promise<void>((_, reject) => (failWrite = reject));
    const oldText = '<html><body><p>옛 문서</p></body></html>';
    const handle = {
      name: 'old.html',
      getFile: () => Promise.resolve(new File([oldText], 'old.html', { type: 'text/html' })),
      createWritable: () => Promise.resolve({ write: () => gate, close: () => Promise.resolve() }),
    };
    await useEditor.getState().adopt({ name: 'old.html', text: oldText, handle });
    const target = useEditor.getState().blocks.find((b) => b.locked === null && !b.rcdata);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    const saving = useEditor.getState().save();
    const adopting = useEditor.getState().adopt({
      name: 'new.html',
      text: '<html><body><p>새 문서</p></body></html>',
      handle: null,
    });
    await answerWith('discard');
    await adopting;
    failWrite?.(new Error('디스크가 가득 찼다'));
    expect(await saving).toBe(false);

    expect(useEditor.getState().notice).toBeNull();
    expect(useEditor.getState().saving).toBe(false);
  });
});

describe('editor · an earlier save finishing never lowers the replacement lock (spec §5)', () => {
  it('a save finishing mid-replacement lowers only its own indicator (saving)', async () => {
    // The old code's save finally lowered the shared busy, unlocking open and the
    // document picker while the new document was still being read. The lock
    // belongs to the reservation and saving may not touch it (ADR-010).
    let releaseWrite: (() => void) | undefined;
    const writeGate = new Promise<void>((resolve) => (releaseWrite = resolve));
    const handle = {
      name: 'deck.html',
      getFile: () => Promise.resolve(new File(['<p>본문</p>'], 'deck.html', { type: 'text/html' })),
      createWritable: () =>
        Promise.resolve({ write: () => writeGate, close: () => Promise.resolve() }),
    };
    await useEditor.getState().adopt({
      name: 'deck.html',
      text: '<html><body><p>본문</p></body></html>',
      handle,
    });
    const target = useEditor.getState().blocks.find((b) => b.locked === null && !b.rcdata);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    const saving = useEditor.getState().save();

    // A new replacement is confirmed while the save is still writing — the read is held.
    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => (releaseRead = r));
    const read = {
      files: new Map<string, unknown>([
        [
          'index.html',
          {
            // Documents are read from bytes (spec §1 · document encoding) — the gate sits on that road.
            arrayBuffer: async () => {
              await readGate;
              return new TextEncoder().encode('<html><body><p>새 폴더</p></body></html>').buffer;
            },
          },
        ],
      ]),
      handles: new Map(),
      truncated: false,
    } as unknown as FolderRead;
    const opening = useEditor.getState().loadFolder(read);
    expect(useReplacement.getState().replacing).toBe(true);

    releaseWrite?.();
    expect(await saving).toBe(true);

    // The save finished but the screen lock stands — saving lowered only its own indicator.
    expect(useEditor.getState().saving).toBe(false);
    expect(useReplacement.getState().replacing).toBe(true);

    releaseRead();
    await opening;
    expect(useReplacement.getState().replacing).toBe(false);
    expect(useEditor.getState().source).toContain('새 폴더');
  });
});

describe('editor · reverting a saved edit can also be saved', () => {
  it('even with zero patches, rewrites the pristine original to make the file match the screen', async () => {
    // Blocked by patch count, "save and continue" would end in false, leaving
    // cancel and discard as the only ways out of the dialog (spec §5).
    const source = '<html><body><p>본문</p></body></html>';
    const writes: string[] = [];
    const handle = fakeHandle('deck.html', () => source, writes);
    await useEditor.getState().adopt({ name: 'deck.html', text: source, handle });
    const target = useEditor.getState().blocks.find((x) => x.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    await useEditor.getState().save();

    useEditor.getState().revert(target?.id ?? -1);
    expect(useEditor.getState().unsaved).toBe(true);

    expect(await useEditor.getState().save()).toBe(true);
    expect(writes[1]).toBe(source);
    expect(useEditor.getState().unsaved).toBe(false);
  });
});

describe('editor · edits saved via download persist in the bundle too', () => {
  it('the saved output opens after a round trip to another document', async () => {
    // A bundle (zip, dropped folder) document has no handle, so saving goes to
    // download-a-copy. With the bundle holding the open-time bytes, a round trip
    // reopens those old bytes and the saved edits silently vanish from the
    // screen — handle documents realign by re-reading the disk, but for a
    // download save the bundle is the only source of truth.
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });
    const doc = (body: string) => new File([`<html><body><p>${body}</p></body></html>`], 'x');
    await useEditor.getState().loadFolder({
      files: new Map([
        ['index.html', doc('본문')],
        ['other.html', doc('다른 문서')],
      ]),
      handles: new Map(),
      truncated: false,
    });
    const target = useEditor.getState().blocks.find((x) => x.locked === null && !x.rcdata);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    expect(await useEditor.getState().save()).toBe(true);

    await useEditor.getState().openFromBundle('other.html');
    await useEditor.getState().openFromBundle('index.html');

    expect(useEditor.getState().source).toContain('고친 값');
    expect(useEditor.getState().unsaved).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('editor · a switch answered with save opens from the post-save bundle (spec §5)', () => {
  it('the round trip opens the output just saved', async () => {
    // The old code opened from the bundle captured before asking — even though
    // the question's save swapped the bundle for the output (for a download save
    // the bundle is the only source of truth), the install revived the pre-save
    // bytes and the saved content silently vanished on return.
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });
    const doc = (body: string) => new File([`<html><body><p>${body}</p></body></html>`], 'x');
    await useEditor.getState().loadFolder({
      files: new Map([
        ['index.html', doc('본문')],
        ['other.html', doc('다른 문서')],
      ]),
      handles: new Map(),
      truncated: false,
    });
    const target = useEditor.getState().blocks.find((b) => b.locked === null && !b.rcdata);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    const switching = useEditor.getState().openFromBundle('other.html');
    await answerWith('save');
    await switching;
    expect(useEditor.getState().source).toContain('다른 문서');

    await useEditor.getState().openFromBundle('index.html');

    expect(useEditor.getState().source).toContain('고친 값');
    expect(useEditor.getState().unsaved).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('editor · committed edits survive clicking in and just leaving', () => {
  it('leaving pristine from a block with a saved edit keeps the patch alive', async () => {
    // The preview's pristine means "same as the screen when editing opened". The
    // screen is showing the saved edit, so deleting the patch would have the next
    // save roll that block back to the original — a split where the saved content
    // stays on screen while only the file goes back in time.
    const source = '<html><body><p>본문</p></body></html>';
    const writes: string[] = [];
    const handle = fakeHandle('deck.html', () => source, writes);
    await useEditor.getState().adopt({ name: 'deck.html', text: source, handle });
    const target = useEditor.getState().blocks.find((x) => x.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    await useEditor.getState().save();

    // Click into the saved block and just leave — the agent sends the screen content and pristine.
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값', true);

    expect(useEditor.getState().patches.get(target?.id ?? -1)).toBe('고친 값');
    expect(useEditor.getState().unsaved).toBe(false);
    // The file already matches the screen — the next save must never rewrite the original.
    expect(await useEditor.getState().save()).toBe(false);
    expect(writes).toHaveLength(1);
  });

  it('a never-saved edit also survives clicking in and out', async () => {
    // The old code deleted the patch on pristine, reading as nothing-to-save
    // while the edit stayed on screen — closing lost the edit without a question.
    // The title (rcdata) is edited in the host field, not the preview, so it is
    // not on the pristine path.
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((x) => x.locked === null && !x.rcdata);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    useEditor.getState().onEdit(target?.id ?? -1, '고친 값', true);

    expect(useEditor.getState().patches.get(target?.id ?? -1)).toBe('고친 값');
    expect(useEditor.getState().unsaved).toBe(true);
  });

  it('leaving pristine does not change the edit order either', async () => {
    // Promoting an in-and-out to "the most recent change" would have Ctrl+Z revert the wrong block.
    await useEditor.getState().loadDropped(dropped());
    const [a, b] = useEditor.getState().blocks.filter((x) => x.locked === null && !x.rcdata);
    useEditor.getState().onEdit(a?.id ?? -1, 'A 수정');
    useEditor.getState().onEdit(b?.id ?? -1, 'B 수정');

    useEditor.getState().onEdit(a?.id ?? -1, 'A 수정', true);
    useEditor.getState().undoLast();

    const { patches } = useEditor.getState();
    expect(patches.has(b?.id ?? -1)).toBe(false);
    expect(patches.get(a?.id ?? -1)).toBe('A 수정');
  });
});

describe('editor · folder linking recovers the place of the document', () => {
  it('with the old path absent, rebases to a tail path actually in the new folder', async () => {
    // Keeping only the name, linking deck/slides/index.html to the deck folder
    // would drop slides/ and lose every asset next to the document (spec §5.1).
    const text =
      '<html><head><link rel="stylesheet" href="style.css"></head><body><p>본문</p></body></html>';
    useEditor.setState({
      file: { name: 'index.html', text, handle: null, path: 'deck/slides/index.html' },
    });
    pickerReturns(
      fakeTree('deck', { slides: { 'index.html': text, 'style.css': 'p{color:red}' } })
    );

    await useEditor.getState().linkFolder();

    // The recovered spot is used only as the asset-finding base (docDir). The
    // same file was not proven, so it is not adopted as the bundle path (docPath)
    // (spec §5.1).
    expect(useEditor.getState().docDir).toBe('slides');
    expect(useEditor.getState().docPath).toBe('');
    expect(useEditor.getState().notice).toEqual({
      key: 'notice.assetsLinked',
      params: { count: 1 },
    });
  });
});

describe('editor · of overlapping replacements, the one started later wins (spec §5)', () => {
  /** A folder whose read is held until release is called — puts the flows' finish order in hand */
  function gatedFolder(tag: string) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const html = `<html><body><p>${tag}</p><img src="pic.png"></body></html>`;
    const files = new Map<string, unknown>([
      [
        'index.html',
        {
          // Documents are read from bytes (spec §1 · document encoding) — the gate sits on that road.
          arrayBuffer: async () => {
            await gate;
            return new TextEncoder().encode(html).buffer;
          },
        },
      ],
      ['pic.png', new Blob(['png'], { type: 'image/png' })],
    ]);
    return {
      read: { files, handles: new Map(), truncated: false } as unknown as FolderRead,
      release,
    };
  }

  /** Records blob URL creation and revocation — who released what must be visible */
  function trackUrls() {
    let at = 0;
    const created: string[] = [];
    const revoked: string[] = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => {
        const url = `blob:${++at}`;
        created.push(url);
        return url;
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    });
    return { created, revoked };
  }

  it('an old flow finishing late neither overwrites the new document nor releases its blobs', async () => {
    // The token changes at install, so two overlapping flows start holding the
    // same one — screened by that, the old flow finishing late would release the
    // new document's blobs and overwrite with its own state.
    const { created, revoked } = trackUrls();
    try {
      const first = gatedFolder('첫 폴더');
      const second = gatedFolder('둘째 폴더');
      const opening1 = useEditor.getState().loadFolder(first.read);
      const opening2 = useEditor.getState().loadFolder(second.read);

      second.release();
      await opening2;
      const installed = useReplacement.getState().installed;
      // The first folder's read is still held — every URL made so far belongs to the second folder.
      const secondUrls = [...created];
      first.release();
      await opening1;

      expect(useEditor.getState().source).toContain('둘째 폴더');
      // The old flow does not install — the install generation stays put.
      expect(useReplacement.getState().installed).toBe(installed);
      // The old flow releases only what it made — the second folder's blobs, which the screen uses, stay alive.
      const firstUrls = created.filter((url) => !secondUrls.includes(url));
      expect(firstUrls.length).toBeGreaterThan(0);
      expect(firstUrls.every((url) => revoked.includes(url))).toBe(true);
      expect(secondUrls.some((url) => revoked.includes(url))).toBe(false);
      expect(useReplacement.getState().replacing).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the old flow does not install even when it finishes first — the folder dropped last opens', async () => {
    trackUrls();
    try {
      const first = gatedFolder('첫 폴더');
      const second = gatedFolder('둘째 폴더');
      const opening1 = useEditor.getState().loadFolder(first.read);
      const opening2 = useEditor.getState().loadFolder(second.read);

      first.release();
      await opening1;
      // The user's last choice is the second folder — finishing first is no license to put up the first.
      expect(useEditor.getState().source).not.toContain('첫 폴더');
      // If the retreating flow lowered the screen lock, edits would come in while the read is still running.
      expect(useReplacement.getState().replacing).toBe(true);

      second.release();
      await opening2;

      expect(useEditor.getState().source).toContain('둘째 폴더');
      expect(useReplacement.getState().replacing).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('editor · a drop reserves at the moment of the drop (spec §5 · replacement reservation)', () => {
  const page = (body: string): FolderRead => ({
    files: new Map([
      ['index.html', new File([`<html><body><p>${body}</p></body></html>`], 'index.html')],
    ]),
    handles: new Map(),
    truncated: false,
  });

  it('a folder dropped earlier whose scan finishes late does not overwrite the one dropped later', async () => {
    // Reserved after the scan, a folder dropped first but scanned late would take
    // a newer reservation and overwrite the user's last choice (the folder
    // dropped later).
    let releaseScan!: (read: FolderRead) => void;
    const slowScan = new Promise<FolderRead | null>((r) => (releaseScan = r));
    const first = useEditor.getState().openDropped(undefined, slowScan);

    await useEditor.getState().openDropped(undefined, Promise.resolve(page('둘째 폴더')));
    expect(useEditor.getState().source).toContain('둘째 폴더');
    const installed = useReplacement.getState().installed;

    releaseScan(page('첫 폴더'));
    await first;

    expect(useEditor.getState().source).toContain('둘째 폴더');
    expect(useReplacement.getState().installed).toBe(installed);
    expect(useReplacement.getState().replacing).toBe(false);
  });

  it('the screen is locked while waiting for the scan after answering the question', async () => {
    // Even after the answer, the previous document is on screen while the scan
    // runs — edits then have nowhere to go at install, so it locks and refuses
    // any commit that gets in (spec §4).
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null && !b.rcdata);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    let releaseScan!: (read: FolderRead) => void;
    const slowScan = new Promise<FolderRead | null>((r) => (releaseScan = r));
    const opening = useEditor.getState().openDropped(undefined, slowScan);
    await answerWith('discard');
    // Let microtasks drain until the answer passes keepEdits and the lock stands.
    for (let tries = 0; !useReplacement.getState().replacing && tries < 1000; tries++) {
      await Promise.resolve();
    }
    expect(useReplacement.getState().replacing).toBe(true);

    useEditor.getState().onEdit(target?.id ?? -1, '사라질 편집');
    expect(useEditor.getState().patches.get(target?.id ?? -1)).toBe('고친 값');
    expect(useToasts.getState().toasts.some((t) => t.notice.key === 'app.editWhileReplacing')).toBe(
      true
    );

    releaseScan(page('새 폴더'));
    await opening;
    expect(useEditor.getState().source).toContain('새 폴더');
    expect(useReplacement.getState().replacing).toBe(false);
  });
});

describe('editor · locked from the moment the question is answered with save (spec §4)', () => {
  it('edits made while the save writes the file are also refused with a notice', async () => {
    // This save is part of a replacement — the install that follows swaps the
    // whole state, so an edit accepted mid-write is a spot for a silent loss.
    // Different from a standalone save (where edits survive).
    let releaseWrite: (() => void) | undefined;
    const writeGate = new Promise<void>((resolve) => (releaseWrite = resolve));
    const handle = {
      name: 'old.html',
      getFile: () =>
        Promise.resolve(new File(['<p>옛 문서</p>'], 'old.html', { type: 'text/html' })),
      createWritable: () =>
        Promise.resolve({ write: () => writeGate, close: () => Promise.resolve() }),
    };
    await useEditor.getState().adopt({
      name: 'old.html',
      text: '<html><body><p>하나</p><p>둘</p></body></html>',
      handle,
    });
    const [a, b] = useEditor.getState().blocks.filter((x) => x.locked === null && !x.rcdata);
    useEditor.getState().onEdit(a?.id ?? -1, 'A 수정');

    const adopting = useEditor.getState().adopt({
      name: 'new.html',
      text: '<html><body><p>새 문서</p></body></html>',
      handle: null,
    });
    await answerWith('save');
    for (let tries = 0; !useReplacement.getState().replacing && tries < 1000; tries++) {
      await Promise.resolve();
    }
    // Locked from the moment of the answer — the write has not finished yet.
    expect(useReplacement.getState().replacing).toBe(true);

    useEditor.getState().onEdit(b?.id ?? -1, '사라질 편집');
    expect(useEditor.getState().patches.has(b?.id ?? -1)).toBe(false);
    expect(useToasts.getState().toasts.some((t) => t.notice.key === 'app.editWhileReplacing')).toBe(
      true
    );

    releaseWrite?.();
    await adopting;
    expect(useEditor.getState().file?.name).toBe('new.html');
    expect(useReplacement.getState().replacing).toBe(false);
  });
});

describe('editor · the scan failure of a displaced drop is not notified (spec §5)', () => {
  it('never shows "could not open" over a document someone else put up', async () => {
    // The failure notice for the cancelled case (Principle 3) is untouched —
    // cancelling creates no new reservation, so the only failure left unnotified
    // is a drop displaced by a newer flow.
    let failScan!: (e: Error) => void;
    const slowScan = new Promise<FolderRead | null>((_, reject) => (failScan = reject));
    const first = useEditor.getState().openDropped(undefined, slowScan);

    await useEditor
      .getState()
      .loadDropped(new File(['<html><body><p>둘째</p></body></html>'], 'b.html'));
    expect(useEditor.getState().source).toContain('둘째');

    failScan(new Error('접근 거부'));
    await first;

    expect(useEditor.getState().notice).toBeNull();
  });
});

describe('editor · a newer flow started while waiting on the save wins (spec §5)', () => {
  it('an open answered with save retreats when it returns from the save displaced', async () => {
    // The old code took the generation **after** keepEdits returned, so the open
    // that started first held the newer generation and overwrote the document of
    // the drop that started later. Reserve at the moment of the action, and check
    // for newest first upon returning from the question.
    let releaseWrite: (() => void) | undefined;
    const writeGate = new Promise<void>((resolve) => (releaseWrite = resolve));
    const handle = {
      name: 'old.html',
      getFile: () =>
        Promise.resolve(new File(['<p>옛 문서</p>'], 'old.html', { type: 'text/html' })),
      createWritable: () =>
        Promise.resolve({ write: () => writeGate, close: () => Promise.resolve() }),
    };
    await useEditor.getState().adopt({
      name: 'old.html',
      text: '<html><body><p>옛 문서</p></body></html>',
      handle,
    });
    const target = useEditor.getState().blocks.find((b) => b.locked === null && !b.rcdata);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    // A: the open — the question is answered with save. The write is still held.
    const adopting = useEditor.getState().adopt({
      name: 'a.html',
      text: '<html><body><p>A 문서</p></body></html>',
      handle: null,
    });
    await answerWith('save');

    // B: a newer drop while the save runs — its read is held.
    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => (releaseRead = r));
    const read = {
      files: new Map<string, unknown>([
        [
          'index.html',
          {
            // Documents are read from bytes (spec §1 · document encoding) — the gate sits on that road.
            arrayBuffer: async () => {
              await readGate;
              return new TextEncoder().encode('<html><body><p>B 문서</p></body></html>').buffer;
            },
          },
        ],
      ]),
      handles: new Map(),
      truncated: false,
    } as unknown as FolderRead;
    const opening = useEditor.getState().loadFolder(read);

    // A's save finishes before B's install — exactly the order the old code lost.
    releaseWrite?.();
    await adopting;

    // A is displaced — it neither installs nor lowers B's lock.
    expect(useEditor.getState().file?.name).toBe('old.html');
    expect(useReplacement.getState().replacing).toBe(true);

    releaseRead();
    await opening;
    expect(useEditor.getState().source).toContain('B 문서');
    expect(useReplacement.getState().replacing).toBe(false);
  });
});

describe('editor · the "{count} spots" in the question is the number of blocks differing from the file (spec §4)', () => {
  it('saved patches are not counted — patches survive a save (INV-1)', async () => {
    await useEditor.getState().loadDropped(dropped());
    const [a, b] = useEditor.getState().blocks.filter((x) => x.locked === null);
    useEditor.getState().onEdit(a?.id ?? -1, '고침 A');
    expect(await useEditor.getState().save()).toBe(true);

    useEditor.getState().onEdit(b?.id ?? -1, '고침 B');

    // Two patches, but only the one unsaved spot differs from the file.
    expect(useEditor.getState().patches.size).toBe(2);
    expect(unsavedCount(useEditor.getState())).toBe(1);
  });

  it('a reverted saved edit counts as one spot even without a patch', async () => {
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((x) => x.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');
    expect(await useEditor.getState().save()).toBe(true);

    useEditor.getState().revert(target?.id ?? -1);

    // Zero patches, but the file still holds the old edit — saying zero spots would be a lie.
    expect(useEditor.getState().patches.size).toBe(0);
    expect(useEditor.getState().unsaved).toBe(true);
    expect(unsavedCount(useEditor.getState())).toBe(1);
  });

  it('reverting a spot saved as the original is not counted — the file holds the original there too', async () => {
    // Edit and save → edit back to the original content and save → revert. An
    // entry stays in savedPatches but that spot in the file is the pristine
    // original — counting mere presence, the question would say two spots when
    // one other block is edited (spec §4).
    await useEditor.getState().loadDropped(dropped());
    const [a, b] = useEditor.getState().blocks.filter((x) => x.locked === null);
    if (!a || !b) throw new Error('편집 가능한 블록이 둘 필요하다');
    useEditor.getState().onEdit(a.id, '고침 A');
    expect(await useEditor.getState().save()).toBe(true);
    useEditor.getState().onEdit(a.id, a.sourceInner);
    expect(await useEditor.getState().save()).toBe(true);
    useEditor.getState().revert(a.id);

    useEditor.getState().onEdit(b.id, '고침 B');

    // Only b differs from the file — a's leftover savedPatches entry equals the original.
    expect(unsavedCount(useEditor.getState())).toBe(1);
  });
});

describe('editor · patches the cross-check deletes never vanish silently (spec §4)', () => {
  it('a patch on a late-locked block leaves a preview revert and a notice', async () => {
    // On the normal path editing does not open before the cross-check. If a patch
    // existed anyway, deleting alone would leave the edit on screen and split
    // screen from saved file (Principle 3).
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    if (!target) throw new Error('편집 가능한 블록이 필요하다');
    useEditor.getState().onEdit(target.id, '대조 전의 편집');

    // Mimics live text where a script swapped that block's characters.
    const live = useEditor.getState().blocks.map((b) => ({
      id: b.id,
      text: b.id === target.id ? '스크립트가 바꾼 글자' : b.sourceText,
    }));
    useEditor.getState().onReady(live);

    const s = useEditor.getState();
    expect(s.scanned).toBe(true);
    expect(s.patches.has(target.id)).toBe(false);
    // The preview goes back to the source content along with it.
    expect(s.revertQueue).toContainEqual({ id: target.id, html: target.sourceInner });
    // And the revert is announced.
    expect(useToasts.getState().toasts.some((t) => t.notice.key === 'app.editsReverted')).toBe(
      true
    );
    // A deleted patch is nothing to save either — screen, saved text and file all agree.
    expect(s.unsaved).toBe(false);
  });

  it('with no patches to delete, no notice and no revert', async () => {
    await useEditor.getState().loadDropped(dropped());

    useEditor
      .getState()
      .onReady(useEditor.getState().blocks.map((b) => ({ id: b.id, text: b.sourceText })));

    expect(useEditor.getState().revertQueue).toHaveLength(0);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it('a click before the cross-check says editing did not open', () => {
    useEditor.getState().onNotReady();

    expect(useToasts.getState().toasts.some((t) => t.notice.key === 'app.editBeforeScan')).toBe(
      true
    );
  });
});

describe('editor · an OS launch reserves before the read (spec §5 · replacement reservation)', () => {
  it('a file the user opens while the OS file is being read wins', async () => {
    // Reserved after the read, the OS flow would displace the newer flow the user
    // opened during it, silently discarding the user's last choice.
    let finishRead!: (file: OpenedFile) => void;
    const reading = new Promise<OpenedFile>((resolve) => (finishRead = resolve));
    const adopting = useEditor.getState().adopt(reading);

    // During the read the user drops another file — this is the last choice.
    await useEditor.getState().loadDropped(dropped());
    finishRead({
      name: 'slow.html',
      text: '<html><body><p>OS 파일</p></body></html>',
      handle: null,
    });
    await adopting;

    expect(useEditor.getState().file?.name).toBe('artifact.html');
    // The displaced flow does not touch the lock either — the newest flow's screen must not stay locked.
    expect(useReplacement.getState().replacing).toBe(false);
  });

  it('a failed read is notified — received as a promise, it still never freezes silently', async () => {
    await useEditor.getState().adopt(Promise.reject(new Error('디스크에서 사라졌다')));

    expect(useEditor.getState().notice).toEqual({
      key: 'notice.openFailedDetail',
      params: { detail: '디스크에서 사라졌다' },
    });
    expect(useReplacement.getState().replacing).toBe(false);
  });

  it('the read failure of a displaced OS flow is not notified', async () => {
    // "Could not open" would appear over a document the other (newest) flow put up perfectly well (spec §5).
    let failRead!: (e: Error) => void;
    const reading = new Promise<OpenedFile>((_, reject) => (failRead = reject));
    const adopting = useEditor.getState().adopt(reading);

    await useEditor.getState().loadDropped(dropped());
    failRead(new Error('사라진 파일'));
    await adopting;

    expect(useEditor.getState().file?.name).toBe('artifact.html');
    expect(useEditor.getState().notice).toBeNull();
  });
});

describe('editor · assets inside blocks and the two-way boundary (ADR-011)', () => {
  /** A bundle whose asset reference sits inside an editable block */
  async function openWithInlineAsset() {
    const files = new Map<string, File>([
      [
        'index.html',
        new File(['<p>설명 <span>사진 <img src="img/logo.png"></span></p>'], 'index.html', {
          type: 'text/html',
        }),
      ],
      ['img/logo.png', new File(['PNG'], 'logo.png', { type: 'image/png' })],
    ]);
    await useEditor.getState().loadFolder({ files, handles: new Map(), truncated: false });
    const blobUrl = useEditor.getState().assets.urls.get('img/logo.png');
    if (!blobUrl) throw new Error('blob URL 이 만들어졌어야 한다');
    const block = useEditor.getState().blocks.find((b) => b.locked === null && !b.rcdata);
    if (!block) throw new Error('편집 가능한 블록이 필요하다');
    return { blobUrl, block };
  }

  it('a blob URL returning from the preview becomes a patch only after restoring the original notation (INV-9)', async () => {
    const { blobUrl, block } = await openWithInlineAsset();

    // Exactly the innerHTML the preview sends — the src inside the block is in blob notation.
    useEditor.getState().onEdit(block.id, `고친 설명 <span>사진 <img src="${blobUrl}"></span>`);

    // No blob in the patch or the saved output — an address that dies when the tab closes.
    expect(useEditor.getState().patches.get(block.id)).toBe(
      '고친 설명 <span>사진 <img src="img/logo.png"></span>'
    );
  });

  it('the fragment a revert sends to the preview goes out wearing the blob swap', async () => {
    const { blobUrl, block } = await openWithInlineAsset();
    useEditor.getState().onEdit(block.id, '고친 설명');

    useEditor.getState().revert(block.id);

    // Sent as the raw original (sourceInner), the preview's swap comes undone and
    // the image 404s against the app origin — the way out must pass the boundary too.
    const sent = useEditor.getState().revertQueue.at(-1);
    expect(sent?.id).toBe(block.id);
    expect(sent?.html).toContain(`src="${blobUrl}"`);
    expect(sent?.html).not.toContain('img/logo.png');
  });
});

describe('editor · saving while a save is running (spec §5)', () => {
  it('never starts on top — so an old snapshot cannot win on disk', async () => {
    await useEditor.getState().loadDropped(dropped());
    const [a, b] = useEditor.getState().blocks.filter((x) => x.locked === null);
    if (!a || !b) throw new Error('편집 가능한 블록이 둘 필요하다');
    useEditor.getState().onEdit(a.id, '첫 편집');

    // A handle that holds the file write — creates the situation of the first save mid-write.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const writes: string[] = [];
    const handle = {
      createWritable: () =>
        Promise.resolve({
          write: async (text: string) => {
            writes.push(text);
            await gate;
          },
          close: () => Promise.resolve(),
        }),
    } as unknown as NonNullable<OpenedFile['handle']>;
    const file = useEditor.getState().file;
    if (!file) throw new Error('파일이 열려 있어야 한다');
    useEditor.setState({ file: { ...file, handle } });

    const first = useEditor.getState().save();
    // Edits during the write are allowed (spec §4) — unsaved rises again and
    // Ctrl+S gets past the early return to this point.
    useEditor.getState().onEdit(b.id, '쓰는 동안의 편집');

    // The overlapping save does not start — two different snapshots written side
    // by side let the old output win on disk depending on finish order.
    await expect(useEditor.getState().save()).resolves.toBe(false);

    release();
    await expect(first).resolves.toBe(true);
    expect(writes).toHaveLength(1);
    // The mid-write edit is not lost — it remains unsaved and can be saved again.
    expect(useEditor.getState().unsaved).toBe(true);
  });
});

describe('editor · a displaced dialog flow retreats on return without asking (spec §5)', () => {
  /** Only waits for the question to appear — the test picks the answer itself */
  async function promptShown(): Promise<void> {
    for (let tries = 0; useUnsaved.getState().why === null; tries++) {
      if (tries > 1000) throw new Error('물음이 뜨지 않았다');
      await Promise.resolve();
    }
  }

  /** Showing "it did not ask" requires draining unconditionally — waits through macrotasks too */
  async function settle(turns = 20): Promise<void> {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0));
  }

  it('an open dialog closed late does not cancel the question of the new drop', async () => {
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    // The dialog is held open — picking takes a person time.
    let finishPick!: (handles: unknown[]) => void;
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = () =>
      new Promise((resolve) => (finishPick = resolve));
    const opening = useEditor.getState().openFile();

    // Meanwhile another file is dropped — this is the last choice, and with edits present the question appears.
    const droppedFlow = useEditor.getState().openDropped(
      new File(['<html><body><p>마지막-선택-문서</p></body></html>'], 'b.html', {
        type: 'text/html',
      }),
      Promise.resolve(null)
    );
    await promptShown();

    // Only now does the dialog close. If the displaced flow entered keepEdits,
    // its question would cancel the drop's, and answered with save the displaced
    // flow would call save().
    finishPick([
      {
        name: 'old.html',
        getFile: () =>
          Promise.resolve(new File(['<p>옛 파일</p>'], 'old.html', { type: 'text/html' })),
      },
    ]);
    await settle();

    // The drop's question is still up, and answered with discard the dropped document stands.
    expect(useUnsaved.getState().why).not.toBeNull();
    useUnsaved.getState().reply('discard');
    await droppedFlow;
    await opening;
    expect(useEditor.getState().source).toContain('마지막-선택-문서');
    expect(useReplacement.getState().replacing).toBe(false);
  });

  it('a folder-open dialog closed late does not ask about the edits on the new document', async () => {
    let finishPick!: (dir: unknown) => void;
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = () =>
      new Promise((resolve) => (finishPick = resolve));
    const opening = useEditor.getState().openFolder();

    // While the dialog was open, another file is dropped and edited — this edit belongs to the newest flow.
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    finishPick(fakeTree('deck', { 'index.html': '<html><body><p>폴더 문서</p></body></html>' }));
    await settle();

    // The displaced flow does not ask — the question itself would hold the newest flow's edits hostage.
    expect(useUnsaved.getState().why).toBeNull();
    await opening;
    expect(useEditor.getState().source).toBe(fixtureSource());
    expect(useEditor.getState().patches.size).toBe(1);
  });

  it('same for a folder-link dialog closed late — displaced, it does not ask', async () => {
    await useEditor.getState().loadDropped(dropped());

    let finishPick!: (dir: unknown) => void;
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = () =>
      new Promise((resolve) => (finishPick = resolve));
    const linking = useEditor.getState().linkFolder();

    // Meanwhile another file is dropped and edited — the document being linked is already off screen.
    await useEditor
      .getState()
      .loadDropped(new File(['<html><body><p>마지막-선택-문서</p></body></html>'], 'b.html'));
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    finishPick(fakeTree('assets', { 'logo.png': 'PNG' }));
    await settle();

    expect(useUnsaved.getState().why).toBeNull();
    await linking;
    expect(useEditor.getState().source).toContain('마지막-선택-문서');
    expect(useEditor.getState().patches.size).toBe(1);
  });
});

describe('editor · closing the document', () => {
  it('returns to the initial screen — nothing of the previous document survives', async () => {
    await useEditor.getState().loadDropped(dropped());
    expect(useEditor.getState().blocks.length).toBeGreaterThan(0);

    await useEditor.getState().closeFile();

    const s = useEditor.getState();
    expect(s.file).toBeNull();
    expect(s.source).toBe('');
    expect(s.blocks).toEqual([]);
    expect(s.previewDoc).toBe('');
    expect(s.patches.size).toBe(0);
    expect(s.bundle).toBeNull();
    expect(s.assetPaths).toEqual([]);
    expect(s.unsaved).toBe(false);
  });

  it('releases the attached assets — unreleased, they stay until the tab closes', async () => {
    await useEditor.getState().loadDropped(dropped());
    const dispose = vi.fn();
    useEditor.setState({ assets: { urls: new Map(), missing: [], dispose } });

    await useEditor.getState().closeFile();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it('asks about unsaved edits — closing cannot be the one exception', async () => {
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    const closing = useEditor.getState().closeFile();
    for (let tries = 0; useUnsaved.getState().why === null; tries++) {
      if (tries > 1000) throw new Error('묻지 않았다');
      await Promise.resolve();
    }
    useUnsaved.getState().reply('cancel');
    await closing;

    // Cancelled, so the document stays.
    expect(useEditor.getState().file).not.toBeNull();
    expect(useEditor.getState().patches.size).toBe(1);
  });

  it('does nothing without an open document', async () => {
    await useEditor.getState().closeFile();

    expect(useEditor.getState().file).toBeNull();
  });

  it('a save answer after the document became clean mid-question still continues the close (spec §4)', async () => {
    // Closing walks the same question as the other entry points — if a shortcut
    // save finished meanwhile or the edit was reverted and it is already clean,
    // the save's "nothing to write" must not cancel the close.
    await useEditor.getState().loadDropped(dropped());
    const target = useEditor.getState().blocks.find((b) => b.locked === null);
    useEditor.getState().onEdit(target?.id ?? -1, '고친 값');

    const closing = useEditor.getState().closeFile();
    for (let tries = 0; useUnsaved.getState().why === null; tries++) {
      if (tries > 1000) throw new Error('묻지 않았다');
      await Promise.resolve();
    }
    // The document became clean while the question was up (a revert — a never-saved edit, nothing to lose).
    useEditor.getState().revert(target?.id ?? -1);
    expect(useEditor.getState().unsaved).toBe(false);
    useUnsaved.getState().reply('save');
    await closing;

    expect(useEditor.getState().file).toBeNull();
  });
});

describe('editor · BOM and encoding (spec §1 · document encoding)', () => {
  const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

  it('the BOM of a document opened as a single file stays in the source (Principle 1)', async () => {
    // Read via Blob.text(), the BOM is stripped and the first byte of an unedited
    // document vanishes from the saved file — saving rewrites source as-is
    // (INV-1), so if it stays in the source it stays in the saved file.
    const file = new File([BOM, fixtureSource()], 'bom.html', { type: 'text/html' });
    await useEditor.getState().loadDropped(file);

    const { source, savedText, notice } = useEditor.getState();
    expect(notice).toBeNull();
    expect(source.charCodeAt(0)).toBe(0xfeff);
    expect(savedText.charCodeAt(0)).toBe(0xfeff);
  });

  it('the BOM of a bundle (folder, zip) entry stays too', async () => {
    const read: FolderRead = {
      files: new Map([
        ['doc.html', new File([BOM, '<html><body><p>본문</p></body></html>'], 'doc.html')],
      ]),
      handles: new Map(),
      truncated: false,
    };
    await useEditor.getState().loadFolder(read);

    const { source, notice } = useEditor.getState();
    expect(notice).toBeNull();
    expect(source.charCodeAt(0)).toBe(0xfeff);
  });

  it('a non-UTF-8 document is rejected with the reason (Principle 3)', async () => {
    // A UTF-16LE document — decoded as UTF-8, mojibake would pose as the document
    // and saving would write that broken result back, quietly ruining the original.
    const utf16 = new Uint8Array([0xff, 0xfe, 0x3c, 0x00, 0x70, 0x00, 0x3e, 0x00]);
    await useEditor.getState().loadDropped(new File([utf16], 'utf16.html'));

    expect(useEditor.getState().notice).toEqual({ key: 'notice.notUtf8' });
    // The document was not opened — the screen being viewed (the empty screen) stays.
    expect(useEditor.getState().file).toBeNull();
  });
});

describe('editor · a preview token per document (spec §5)', () => {
  it('mints a new token each time a document stands and carries it in the preview document', async () => {
    await useEditor.getState().loadDropped(dropped());
    const first = useEditor.getState().previewToken;
    expect(first).not.toBe('');
    // It must ride in the agent call arguments for the preview to send messages with that token.
    expect(useEditor.getState().previewDoc).toContain(`("${first}")`);

    await useEditor.getState().loadDropped(dropped());
    const second = useEditor.getState().previewToken;
    // The same token cannot screen out old preview messages — it must differ on every switch.
    expect(second).not.toBe(first);
    expect(useEditor.getState().previewDoc).toContain(`("${second}")`);
  });
});
