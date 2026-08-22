/**
 * The entry point for opening (spec §4).
 *
 * **Two buttons is a platform constraint, not taste.** The web has no dialog
 * that picks files and folders together — `showOpenFilePicker` gives only
 * files, `showDirectoryPicker` only folders. Which dialog to show must be
 * decided **before the press**, so there must be as many entry points.
 * (Drag and drop can decide by looking at what was dropped, so it takes one —
 * `ui/App.tsx`)
 *
 * They could be folded into a menu to look like one, but that costs an extra
 * press every time. Two buttons spend a little more space and get there in one.
 *
 * Asking about unsaved edits is **the store's** job. Dialogs must open inside a
 * user gesture; asking here first and waiting would expire the gesture.
 */
import { Button } from '@/components/ui/button';
import { canPickFolder } from '@/lib/fs';
import { IconOpen, IconOpenFolder } from '@/lib/icons';
import { useEditor, useEditorBusy } from '@/store/editor';
import { useI18n } from '@/store/locale';

export function OpenButton() {
  // No new open starts while a save is running or a replacement is underway (ADR-010).
  const busy = useEditorBusy();
  const openFile = useEditor((s) => s.openFile);
  const openFolder = useEditor((s) => s.openFolder);
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        title={t('toolbar.openFileHint')}
        onClick={() => void openFile()}
      >
        <IconOpen />
        {/* The label goes when space runs out; the icon and the tooltip carry it */}
        <span className="hidden lg:inline">{t('toolbar.openFile')}</span>
      </Button>

      {/* In a browser that cannot open folders, don't leave a button that cannot be pressed */}
      {canPickFolder() && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          title={t('toolbar.openFolderHint')}
          onClick={() => void openFolder()}
        >
          <IconOpenFolder />
          <span className="hidden lg:inline">{t('toolbar.openFolder')}</span>
        </Button>
      )}
    </div>
  );
}
