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
import { lockSummary, useEditor } from '@/store/editor';
import { useI18n } from '@/store/locale';

/** 잠금 사유를 사람 말로 — 못 고치는 이유는 반드시 보인다 (대원칙 3) */
export function ChangeList() {
  const blocks = useEditor((s) => s.blocks);
  const patches = useEditor((s) => s.patches);
  const revert = useEditor((s) => s.revert);
  const revertAll = useEditor((s) => s.revertAll);
  const scanned = useEditor((s) => s.scanned);
  const { t, tn } = useI18n();

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
            <Button variant="ghost" size="sm" onClick={revertAll}>
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
                <li key={id} className="rounded-md border border-border bg-card p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <code className="font-mono text-[10px] text-muted-foreground">
                      #{id} &lt;{block?.tag}&gt;
                    </code>
                    <Button variant="ghost" size="sm" onClick={() => revert(id)}>
                      <IconRevert />
                      {t('changes.revert')}
                    </Button>
                  </div>
                  <p className="line-clamp-2 text-xs">{patches.get(id)?.replace(/<[^>]*>/g, '')}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
