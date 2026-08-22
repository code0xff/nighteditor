import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Toaster } from '@/components/Toaster';
import { Button } from '@/components/ui/button';
import { onFileLaunch, readDroppedFolder } from '@/lib/fs';
import { IconDrop, IconLinkFolder, IconUnlinked } from '@/lib/icons';
import { onEditorShortcuts } from '@/lib/shortcuts';
import { onBeforeUnload } from '@/lib/unsaved';
import { ERROR_NOTICES } from '@/lib/messages';
import { cn } from '@/lib/utils';
import { countAssets, useEditor, useEditorBusy } from '@/store/editor';
import { useListBeside, usePanel } from '@/store/panel';
import { useReplacement } from '@/store/replacement';
import { shortcutSave } from '@/store/unsaved';
import { useToasts } from '@/store/toasts';
import { UnsavedDialog } from '@/components/UnsavedDialog';
import { useI18n } from '@/store/locale';
import { ChangeList } from './ChangeList';
import { PreviewFrame } from './PreviewFrame';
import { Toolbar } from './Toolbar';

export function App() {
  const file = useEditor((s) => s.file);
  const notice = useEditor((s) => s.notice);
  const openDropped = useEditor((s) => s.openDropped);
  const adopt = useEditor((s) => s.adopt);
  const downloadCopy = useEditor((s) => s.downloadCopy);
  const undoLast = useEditor((s) => s.undoLast);
  const unsaved = useEditor((s) => s.unsaved);
  // No new folder link starts while a save is running or a replacement is underway (ADR-010).
  const busy = useEditorBusy();
  // Only the label is tied to replacement alone — "reading" is what happens while the reservation stands.
  const replacing = useReplacement((s) => s.replacing);
  const linkFolder = useEditor((s) => s.linkFolder);
  // Assets referenced but not attached. Never left silently broken (Principle 3 · spec §5.1).
  const missing = useEditor((s) => countAssets(s).missing);
  const failedToOpen = useEditor((s) => s.failedToOpen);
  const show = useToasts((s) => s.show);
  // Below `lg` the list cannot stand beside the preview — it comes over it (ADR-012).
  const panelOpen = usePanel((s) => s.open);
  const closePanel = usePanel((s) => s.close);
  const listBeside = useListBeside();
  const { t } = useI18n();
  // Unsaved edits live only in memory. Have the browser ask before the tab closes.
  // The criterion is not the patch count — patches survive a save (INV-1), so
  // asking on that would stop even someone who already saved, every time they
  // leave. Ask only on "differs from the file" (unsaved).
  useEffect(() => onBeforeUnload(() => unsaved), [unsaved]);
  const [dragging, setDragging] = useState(false);

  // Closing the document leaves the panel with nothing to show. Left open, it
  // would be up over the next document the moment it opens.
  useEffect(() => {
    if (!file) closePanel();
  }, [file, closePanel]);

  // Files arrive here when the OS "open with this app" targets the installed PWA.
  useEffect(() => onFileLaunch((f) => void adopt(f)), [adopt]);

  // Shortcuts for when focus is outside the preview (toolbar, sidebar). Inside
  // the preview the agent forwards them. Save goes through shortcutSave, not
  // save() directly — a Ctrl+S while the save prompt is up must act as that
  // prompt's "save and continue", or the pending action gets cancelled (spec §4).
  useEffect(
    () => onEditorShortcuts({ save: shortcutSave, downloadCopy, undo: undoLast }),
    [downloadCopy, undoLast]
  );

  // Notices float at the top right. As a banner, each one would push what the user was reading downward.
  useEffect(() => {
    if (notice) show(notice, ERROR_NOTICES.has(notice.key) ? 'error' : 'info');
  }, [notice, show]);

  return (
    <div
      // `dvh`, not `vh`: on a phone the browser's own bars are part of the
      // window height, so `100vh` puts the bottom of the app underneath them.
      className="flex h-dvh flex-col bg-background text-foreground"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const dropped = e.dataTransfer.files[0];
        const { items } = e.dataTransfer;
        if (!dropped && items.length === 0) return;
        // Folder entries vanish once the event ends — the walk starts now.
        // Reserving, asking, locking, and installing follow one rule in the
        // store (openDropped) (spec §5 · replacement reservation).
        // If the prompt or the open itself dies, it lands in catch. Unhandled,
        // dropping a file would look like nothing happened.
        void openDropped(dropped, readDroppedFolder(items)).catch(failedToOpen);
      }}
    >
      <Toolbar />
      <UnsavedDialog />

      <Toaster />

      {file && missing > 0 && (
        <div className="px-3 pt-2">
          <Alert>
            <IconUnlinked className="h-3.5 w-3.5" />
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>{t('assets.missing', { count: missing })}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                // linkFolder does the asking. Asking here first would ask twice,
                // and choosing save could expire the gesture in the meantime,
                // getting the folder dialog rejected.
                onClick={() => void linkFolder()}
              >
                <IconLinkFolder />
                {replacing ? t('assets.linking') : t('assets.link')}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      <main className="flex min-h-0 flex-1">
        <div
          className={cn(
            'min-w-0 flex-1',
            dragging && 'outline outline-2 -outline-offset-4 outline-primary'
          )}
        >
          {file ? (
            <PreviewFrame />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <IconDrop className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">{t('app.emptyTitle')}</p>
                <p className="mt-1.5 text-xs text-muted-foreground">{t('app.emptyHint')}</p>
              </div>
            </div>
          )}
        </div>

        {file && (
          <>
            {/* Only below `lg`, and only while the panel is up. Pressing beside
                the panel closes it — on a small screen the preview underneath
                is what the user came back for. */}
            {panelOpen && (
              <div
                className="fixed inset-0 top-12 z-20 bg-background/60 lg:hidden"
                onClick={closePanel}
                aria-hidden
              />
            )}
            <aside
              className={cn(
                'w-72 shrink-0 border-l border-border bg-background',
                // From `lg` up it simply stands beside the preview. Below that
                // 288px of list would leave the document unreadable, so it
                // slides over the preview instead of taking its width.
                'fixed inset-y-0 right-0 top-12 z-30 transition-transform lg:static lg:z-auto lg:translate-x-0',
                panelOpen ? 'translate-x-0 shadow-xl' : 'translate-x-full'
              )}
              // Off-screen means out of reach — not something to tab into.
              inert={listBeside || panelOpen ? undefined : true}
            >
              <ChangeList />
            </aside>
          </>
        )}
      </main>
    </div>
  );
}
