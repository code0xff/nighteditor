import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  IconBlocks,
  IconEditable,
  IconLocked,
  IconRevert,
  IconRevertAll,
  IconScanning,
} from '@/lib/icons';
import { lockNotice } from '@/lib/messages';
import { cn } from '@/lib/utils';
import { lockSummary, useEditor } from '@/store/editor';
import { usePanel } from '@/store/panel';
import { useReplacement } from '@/store/replacement';
import { useI18n } from '@/store/locale';

/** Edit results are innerHTML. The list shows only the text with tags stripped */
function plainText(html: string | undefined): string {
  return (html ?? '').replace(/<[^>]*>/g, '');
}

/** Lock reasons in human words — why something cannot be edited is always visible (Principle 3) */
export function ChangeList() {
  const blocks = useEditor((s) => s.blocks);
  const patches = useEditor((s) => s.patches);
  const revert = useEditor((s) => s.revert);
  const reveal = useEditor((s) => s.reveal);
  const revertAll = useEditor((s) => s.revertAll);
  const scanned = useEditor((s) => s.scanned);
  const selectedId = useEditor((s) => s.selectedId);
  // Reverting is locked during replacement too — what the list shows is still
  // the previous document, and a change made here has nowhere to go the moment
  // the new document stands (spec §4 · ADR-010).
  const replacing = useReplacement((s) => s.replacing);
  const closePanel = usePanel((s) => s.close);
  const { t, tn } = useI18n();

  // On a narrow screen this list is a panel over the preview. Jumping to a spot
  // hidden behind the panel shows nothing, so the panel gets out of the way.
  // Beside the preview it is not a panel at all and this does nothing.
  const jump = (id: number) => {
    reveal(id);
    closePanel();
  };

  const byId = new Map(blocks.map((b) => [b.id, b]));
  const changed = [...patches.keys()].sort((a, b) => a - b);
  const editable = blocks.filter((b) => b.locked === null).length;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <section>
        <h2 className="mb-2 text-xs font-semibold">{t('changes.blocks')}</h2>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">
            <IconBlocks />
            {t('changes.total', { count: blocks.length })}
          </Badge>
          <Badge variant="success">
            <IconEditable />
            {t('changes.editable', { count: editable })}
          </Badge>
          {!scanned && blocks.length > 0 && (
            <Badge variant="info">
              <IconScanning className="animate-spin" />
              {t('changes.scanning')}
            </Badge>
          )}
        </div>
      </section>

      {scanned && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
            <IconLocked className="h-3 w-3 text-muted-foreground" />
            {t('changes.lockedReasons')}
          </h2>
          <ul className="space-y-1">
            {lockSummary(blocks).map(({ reason, count }) => (
              <li key={reason} className="flex justify-between text-xs text-muted-foreground">
                <span>{tn(lockNotice(reason))}</span>
                <span className="tabular-nums">{count}</span>
              </li>
            ))}
            {lockSummary(blocks).length === 0 && (
              <li className="text-xs text-muted-foreground">{t('changes.none')}</li>
            )}
          </ul>
        </section>
      )}

      <Separator />

      <section className="min-h-0 flex-1">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold">
            {t('changes.changed', { count: changed.length })}
          </h2>
          {changed.length > 0 && (
            <Button variant="ghost" size="sm" disabled={replacing} onClick={revertAll}>
              <IconRevertAll />
              {t('changes.revertAll')}
            </Button>
          )}
        </div>

        {changed.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('changes.empty')}</p>
        ) : (
          <ul className="space-y-1.5">
            {changed.map((id) => {
              const block = byId.get(id);
              return (
                <li key={id}>
                  {/* Pressing the card jumps to that spot in the preview. In a
                      long document the list alone makes edits hard to locate.
                      Revert is handled separately by the inner button. */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => jump(id)}
                    onKeyDown={(e) => {
                      // A key bubbling up from the inner revert button belongs
                      // to that button. Intercepting it makes reverting
                      // impossible by keyboard.
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        jump(id);
                      }
                    }}
                    className={cn(
                      'w-full cursor-pointer rounded-md border border-border bg-card p-2 text-left',
                      'hover:border-muted-foreground focus:outline-none focus-visible:border-primary',
                      // Highlight in the list the block being edited in the preview.
                      id === selectedId && 'border-primary'
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <code className="font-mono text-[10px] text-muted-foreground">
                        #{id} &lt;{block?.tag}&gt;
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={replacing}
                        // Revert is not a card press. If it leaks upward, the
                        // card tries to jump to a block that no longer exists
                        // right after reverting.
                        onClick={(e) => {
                          e.stopPropagation();
                          revert(id);
                        }}
                      >
                        <IconRevert />
                        {t('changes.revert')}
                      </Button>
                    </div>
                    {/* Show what changed into what — the new value alone cannot be verified (spec §4) */}
                    <p className="line-clamp-2 text-xs text-muted-foreground line-through">
                      {block?.sourceText}
                    </p>
                    <p className="line-clamp-2 text-xs">{plainText(patches.get(id))}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
