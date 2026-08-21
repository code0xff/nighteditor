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
import { useReplacement } from '@/store/replacement';
import { useI18n } from '@/store/locale';

/** 편집 결과는 innerHTML 이다. 목록에는 태그를 걷어낸 글자만 보여준다 */
function plainText(html: string | undefined): string {
  return (html ?? '').replace(/<[^>]*>/g, '');
}

/** 잠금 사유를 사람 말로 — 못 고치는 이유는 반드시 보인다 (대원칙 3) */
export function ChangeList() {
  const blocks = useEditor((s) => s.blocks);
  const patches = useEditor((s) => s.patches);
  const revert = useEditor((s) => s.revert);
  const reveal = useEditor((s) => s.reveal);
  const revertAll = useEditor((s) => s.revertAll);
  const scanned = useEditor((s) => s.scanned);
  const selectedId = useEditor((s) => s.selectedId);
  // 갈아 끼우는 동안은 되돌리기도 잠근다 — 목록이 보여주는 것은 아직 이전 문서라,
  // 여기서 고친 것은 새 문서가 서는 순간 갈 곳이 없다 (spec §4 · ADR-010).
  const replacing = useReplacement((s) => s.replacing);
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
                  {/* 카드를 누르면 프리뷰의 그 자리로 데려간다. 문서가 길면 목록만 보고
                      어디를 고쳤는지 찾기 어렵다. 되돌리기는 안쪽 버튼이 따로 받는다. */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => reveal(id)}
                    onKeyDown={(e) => {
                      // 안쪽 되돌리기 버튼에서 올라온 키는 그 버튼의 것이다.
                      // 가로채면 키보드로는 되돌릴 수가 없다.
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        reveal(id);
                      }
                    }}
                    className={cn(
                      'w-full cursor-pointer rounded-md border border-border bg-card p-2 text-left',
                      'hover:border-muted-foreground focus:outline-none focus-visible:border-primary',
                      // 프리뷰에서 고르고 있는 블록을 목록에서도 짚어준다.
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
                        // 되돌리기는 카드를 누른 것이 아니다. 위로 새면 되돌리고 나서
                        // 없는 블록으로 데려가려 든다.
                        onClick={(e) => {
                          e.stopPropagation();
                          revert(id);
                        }}
                      >
                        <IconRevert />
                        {t('changes.revert')}
                      </Button>
                    </div>
                    {/* 무엇이 무엇으로 바뀌었는지 보여준다 — 새 값만 보면 확인이 안 된다 (spec §4) */}
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
