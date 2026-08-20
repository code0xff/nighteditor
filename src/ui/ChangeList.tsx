import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { lockSummary, useEditor } from '@/store/editor';

const LOCK_LABEL: Record<string, string> = {
  RAW_TEXT: '코드 영역',
  SCRIPT_GENERATED: '스크립트가 생성',
  EMPTY_IN_SOURCE: '소스에서 비어 있음',
  CODE_BLOCK: '코드 블록',
  AMBIGUOUS: '범위 불확정',
};

/** 잠금 사유를 사람 말로 — 못 고치는 이유는 반드시 보인다 (대원칙 3) */
export function ChangeList() {
  const blocks = useEditor((s) => s.blocks);
  const patches = useEditor((s) => s.patches);
  const revert = useEditor((s) => s.revert);
  const revertAll = useEditor((s) => s.revertAll);
  const scanned = useEditor((s) => s.scanned);

  const byId = new Map(blocks.map((b) => [b.id, b]));
  const changed = [...patches.keys()].sort((a, b) => a - b);
  const editable = blocks.filter((b) => b.locked === null).length;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <section>
        <h2 className="mb-2 text-xs font-semibold">블록</h2>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">전체 {blocks.length}</Badge>
          <Badge variant="success">편집 가능 {editable}</Badge>
          {!scanned && blocks.length > 0 && <Badge variant="info">대조 중…</Badge>}
        </div>
      </section>

      {scanned && (
        <section>
          <h2 className="mb-2 text-xs font-semibold">잠긴 이유</h2>
          <ul className="space-y-1">
            {lockSummary(blocks).map(({ reason, count }) => (
              <li key={reason} className="flex justify-between text-xs text-muted-foreground">
                <span>{LOCK_LABEL[reason] ?? reason}</span>
                <span className="tabular-nums">{count}</span>
              </li>
            ))}
            {lockSummary(blocks).length === 0 && (
              <li className="text-xs text-muted-foreground">없음</li>
            )}
          </ul>
        </section>
      )}

      <Separator />

      <section className="min-h-0 flex-1">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold">변경 {changed.length}</h2>
          {changed.length > 0 && (
            <Button variant="ghost" size="sm" onClick={revertAll}>
              전체 되돌리기
            </Button>
          )}
        </div>

        {changed.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            아직 없다. 프리뷰에서 글자를 눌러 고칠 수 있다.
          </p>
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
                      되돌리기
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
