/**
 * The prompt shown when leaving with unsaved edits behind (spec §4).
 *
 * Three choices, so the browser's `confirm` cannot build it — the one the user
 * actually wants, **save and continue**, is not among its two.
 *
 * The save button's label splits on whether the current document can be
 * overwritten — a document opened by drop or from a zip has nowhere to write
 * back, so a copy is downloaded. Writing just "save" would be a lie.
 */
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { IconDownloadCopy, IconSave } from '@/lib/icons';
import { unsavedCount, useEditor } from '@/store/editor';
import { useI18n } from '@/store/locale';
import { useUnsaved } from '@/store/unsaved';

export function UnsavedDialog() {
  const why = useUnsaved((s) => s.why);
  const reply = useUnsaved((s) => s.reply);
  // Not the total patch count — patches survive a save (INV-1), and reverting
  // a saved edit differs from the file with no patch at all. The number shown
  // here is **the count of blocks that differ from the file** (spec §4).
  const count = useEditor(unsavedCount);
  // No overlapping answers while a save is running — same criterion as shortcutSave.
  const saving = useEditor((s) => s.saving);
  const overwrites = useEditor((s) => Boolean(s.file?.handle));
  const { t } = useI18n();

  if (!why) return null;

  return (
    <Dialog
      open
      // Clicking outside or pressing Escape means "do nothing".
      onClose={() => reply('cancel')}
      title={t('confirm.title')}
      footer={
        <>
          {/* The three labels differ wildly in length; left alone, widths spread
              up to threefold and look ragged. A floor under the shortest lines
              them up — long ones keep their own width.

              Cancel gets a border too. All three are the same height, but ghost
              has neither border nor background, so its box is invisible and it
              looks shorter and smaller than its neighbors. Weight is split by
              fill (save) versus border (cancel, discard). */}
          <Button variant="outline" className="min-w-24" onClick={() => reply('cancel')}>
            {t('confirm.cancel')}
          </Button>
          <Button variant="outline" className="min-w-24" onClick={() => reply('discard')}>
            {t('confirm.discard')}
          </Button>
          <Button className="min-w-24" disabled={saving} onClick={() => reply('save')}>
            {overwrites ? <IconSave /> : <IconDownloadCopy />}
            {t(overwrites ? 'confirm.save' : 'confirm.saveCopy')}
          </Button>
        </>
      }
    >
      <p className="text-sm">{t('confirm.body', { count, why })}</p>
    </Dialog>
  );
}
