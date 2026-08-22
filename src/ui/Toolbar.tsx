import { Brand } from '@/components/Brand';
import { DocSelect } from '@/components/DocSelect';
import { LangSelect } from '@/components/LangSelect';
import { OpenButton } from '@/components/OpenButton';
import { RepoLink } from '@/components/RepoLink';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { canOverwrite } from '@/lib/fs';
import { IconCloseDoc, IconDownloadCopy, IconSave } from '@/lib/icons';
import { lockNotice } from '@/lib/messages';
import { titleBlock, useEditor, useEditorBusy } from '@/store/editor';
import { useReplacement } from '@/store/replacement';
import { useI18n } from '@/store/locale';

export function Toolbar() {
  const file = useEditor((s) => s.file);
  const blocks = useEditor((s) => s.blocks);
  const patches = useEditor((s) => s.patches);
  const scanned = useEditor((s) => s.scanned);
  const unsaved = useEditor((s) => s.unsaved);
  const busy = useEditorBusy();
  // All screen locking during replacement derives from the single reservation state (ADR-010).
  const replacing = useReplacement((s) => s.replacing);
  const onEdit = useEditor((s) => s.onEdit);
  const save = useEditor((s) => s.save);
  const downloadCopy = useEditor((s) => s.downloadCopy);
  const closeFile = useEditor((s) => s.closeFile);
  const { t } = useI18n();

  const title = titleBlock(blocks);
  const titleValue = (title && patches.get(title.id)) ?? title?.sourceText ?? '';

  return (
    // `min-w-0` on every shrinkable child, so nothing here can push the header
    // wider than the window. An overflowing header does not merely look cramped:
    // opening the language select scrolls the page sideways to bring the popup
    // into view, and the whole document jumps with it.
    <header className="sticky top-0 z-10 flex h-12 items-center gap-1.5 border-b border-border bg-background/80 px-2 backdrop-blur sm:gap-3 sm:px-3">
      <Brand />

      <OpenButton />

      {file && (
        <>
          {/* The name yields first when space runs out — the document is on screen anyway */}
          <span className="hidden min-w-0 truncate font-mono text-xs text-muted-foreground md:inline">
            {file.name}
          </span>
          <DocSelect />

          {/* Changes the document, so it locks like opening does — unpressable while saving or replacing */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void closeFile()}
            disabled={busy}
            aria-label={t('toolbar.close')}
            title={t('toolbar.close')}
          >
            <IconCloseDoc />
          </Button>

          {/* The title field absorbs whatever room is left. With one flexible element
              the header cannot overflow at any width, however narrow the window gets. */}
          {title && (
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <Label htmlFor="doc-title" className="hidden text-muted-foreground sm:inline">
                {t('toolbar.title')}
              </Label>
              <Input
                id="doc-title"
                placeholder={t('toolbar.title')}
                className="h-8 w-full min-w-0 sm:w-56 sm:flex-none"
                value={titleValue}
                // An edit made while replacing has nowhere to go once the new
                // document stands. Lock the field instead of pretending to
                // accept and discarding (spec §4). Never lock on saving —
                // edits made during a save survive, so keep accepting then.
                // Lock before verification too (!scanned) — if a script changes
                // the title, verification locks this block and erases the patch,
                // splitting the screen from the saved file (spec §4).
                disabled={replacing || !scanned || title.locked !== null}
                title={
                  title.locked
                    ? t('toolbar.notEditable', { reason: lockNotice(title.locked) })
                    : scanned
                      ? undefined
                      : t('app.editBeforeScan')
                }
                onChange={(e) => onEdit(title.id, e.target.value)}
              />
            </div>
          )}
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-2">
        {/* A whole sentence is the widest thing here. On a narrow screen the same
            fact is still told — by the save button's wording and by the notice
            after saving — so it goes first. */}
        {file && !file.handle && (
          <span className="hidden truncate text-xs text-muted-foreground lg:inline">
            {t(canOverwrite() ? 'toolbar.droppedNoOverwrite' : 'toolbar.noOverwriteSupport')}
          </span>
        )}
        {file && (
          <Button
            variant="outline"
            size="icon"
            onClick={downloadCopy}
            aria-label={t('toolbar.downloadCopy')}
            title={t('toolbar.downloadCopy')}
          >
            <IconDownloadCopy />
          </Button>
        )}
        {file && (
          // Never lock on patch count (spec §5) — saving clears unsaved while
          // patches remain (a button that presses but does nothing), and
          // reverting a saved edit leaves something to save at zero patches.
          // Watch the same criterion as save()'s early return.
          // Also lock while a save runs and while replacing (useEditorBusy) —
          // the former to avoid overlapping writes, the latter because it
          // would mean saving the previous document.
          <Button size="sm" onClick={() => void save()} disabled={busy || !unsaved}>
            <IconSave />
            <span className="hidden sm:inline">{t('toolbar.save')}</span>
            {patches.size > 0 && `(${patches.size})`}
          </Button>
        )}
        <LangSelect />
        <RepoLink />
        <ThemeToggle />
      </div>
    </header>
  );
}
