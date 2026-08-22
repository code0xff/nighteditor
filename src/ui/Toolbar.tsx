import { Brand } from '@/components/Brand';
import { DocSelect } from '@/components/DocSelect';
import { LangSelect } from '@/components/LangSelect';
import { OpenButton } from '@/components/OpenButton';
import { RepoLink } from '@/components/RepoLink';
import { ThemeToggle } from '@/components/ThemeToggle';
import { TitleField } from '@/components/TitleField';
import { Button } from '@/components/ui/button';
import { canOverwrite } from '@/lib/fs';
import { useMediaQuery, MD } from '@/lib/media';
import { IconChangeList, IconCloseDoc, IconDownloadCopy, IconSave } from '@/lib/icons';
import { useEditor, useEditorBusy } from '@/store/editor';
import { usePanel } from '@/store/panel';
import { useI18n } from '@/store/locale';

export function Toolbar() {
  const file = useEditor((s) => s.file);
  const patches = useEditor((s) => s.patches);
  const unsaved = useEditor((s) => s.unsaved);
  const busy = useEditorBusy();
  const save = useEditor((s) => s.save);
  const downloadCopy = useEditor((s) => s.downloadCopy);
  const closeFile = useEditor((s) => s.closeFile);
  // Below `lg` the change list is a panel over the preview, and this opens it.
  const togglePanel = usePanel((s) => s.toggle);
  // Below `md` the toolbar holds actions on the document and nothing else.
  const roomy = useMediaQuery(MD);
  const { t } = useI18n();

  return (
    // `min-w-0` on every shrinkable child, so nothing here can push the header
    // wider than the window. An overflowing header does not merely look cramped:
    // opening the language select scrolls the page sideways to bring the popup
    // into view, and the whole document jumps with it.
    //
    // Everything but the title field is `shrink-0`. Without it the row never
    // reports an overflow — the controls just squash, and a 28px app mark ends
    // up 19px wide and out of shape. Squashed icons are the harder thing to
    // notice, so the flexible element is the one that gives.
    <header className="sticky top-0 z-10 flex h-12 items-center gap-1.5 border-b border-border bg-background/80 px-2 backdrop-blur sm:gap-3 sm:px-3">
      <Brand />

      <OpenButton />

      {file && (
        <>
          {/* The name yields first when space runs out — the document is on screen anyway */}
          <span className="hidden min-w-0 truncate font-mono text-xs text-muted-foreground xl:inline">
            {file.name}
          </span>
          <DocSelect />

          {/* Changes the document, so it locks like opening does — unpressable while saving or replacing */}
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => void closeFile()}
            disabled={busy}
            aria-label={t('toolbar.close')}
            title={t('toolbar.close')}
          >
            <IconCloseDoc />
          </Button>

          {/* The title field absorbs whatever room is left. With one flexible element
              the header cannot overflow at any width, however narrow the window gets.
              Below `sm` there is no room left to absorb, and it moves to the change
              list instead (TitleField). */}
          {roomy ? <TitleField /> : <div className="flex-1" />}
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-2">
        {/* A whole sentence is the widest thing here. On a narrow screen the same
            fact is still told — by the save button's wording and by the notice
            after saving — so it goes first. */}
        {file && !file.handle && (
          <span className="hidden truncate text-xs text-muted-foreground xl:inline">
            {t(canOverwrite() ? 'toolbar.droppedNoOverwrite' : 'toolbar.noOverwriteSupport')}
          </span>
        )}
        {file && roomy && (
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
            <span className="hidden lg:inline">{t('toolbar.save')}</span>
            {patches.size > 0 && `(${patches.size})`}
          </Button>
        )}
        {/* From `lg` up the list is already beside the preview, so this is gone */}
        {file && (
          <Button
            variant="outline"
            size="icon"
            className="lg:hidden"
            onClick={togglePanel}
            aria-label={t('changes.panel')}
            title={t('changes.panel')}
          >
            <IconChangeList />
          </Button>
        )}
        {/* Below `md` these leave the header for the foot of the change list
            (SideControls). Kept here they take about 140px, and everything on
            the left — the wordmark, the open buttons — squashes to make room:
            a flex child shrinks below its width before the row overflows, so
            the 28px app mark ends up 19px wide and out of shape. The header
            is what you do to the document; the rest lives one press away. */}
        {roomy && (
          <>
            <LangSelect />
            <RepoLink />
            <ThemeToggle />
          </>
        )}
      </div>
    </header>
  );
}
