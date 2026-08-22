/**
 * Edits the document's `<title>` (spec §2.1).
 *
 * It lives in the toolbar from `md` up. Below that the toolbar has room for
 * actions and nothing else — the field ends up around 20px wide, which is a
 * field in name only — so it moves to the top of the change list instead. One
 * instance either way, never two: the label points at an id, and two of those
 * point at whichever came first.
 */
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { lockNotice } from '@/lib/messages';
import { titleBlock, useEditor } from '@/store/editor';
import { useReplacement } from '@/store/replacement';
import { useI18n } from '@/store/locale';

export function TitleField({ stacked = false }: { stacked?: boolean }) {
  const blocks = useEditor((s) => s.blocks);
  const patches = useEditor((s) => s.patches);
  const scanned = useEditor((s) => s.scanned);
  const onEdit = useEditor((s) => s.onEdit);
  // All screen locking during replacement derives from the single reservation state (ADR-010).
  const replacing = useReplacement((s) => s.replacing);
  const { t } = useI18n();

  const title = titleBlock(blocks);
  if (!title) return null;
  const value = patches.get(title.id) ?? title.sourceText;

  return (
    <div className={stacked ? 'flex flex-col gap-1.5' : 'flex min-w-0 flex-1 items-center gap-1.5'}>
      <Label
        htmlFor="doc-title"
        className={stacked ? 'text-xs font-semibold' : 'hidden text-muted-foreground lg:inline'}
      >
        {t('toolbar.title')}
      </Label>
      <Input
        id="doc-title"
        placeholder={t('toolbar.title')}
        className={stacked ? 'w-full' : 'w-full min-w-0 md:w-56 md:flex-none'}
        value={value}
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
  );
}
