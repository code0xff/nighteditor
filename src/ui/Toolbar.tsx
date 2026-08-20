import { Brand } from '@/components/Brand';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { canOverwrite } from '@/lib/fs';
import { IconOpen, IconSave } from '@/lib/icons';
import { titleBlock, useEditor } from '@/store/editor';

export function Toolbar() {
  const file = useEditor((s) => s.file);
  const blocks = useEditor((s) => s.blocks);
  const patches = useEditor((s) => s.patches);
  const busy = useEditor((s) => s.busy);
  const openFile = useEditor((s) => s.openFile);
  const onEdit = useEditor((s) => s.onEdit);
  const save = useEditor((s) => s.save);

  const title = titleBlock(blocks);
  const titleValue = (title && patches.get(title.id)) ?? title?.sourceText ?? '';

  return (
    <header className="sticky top-0 z-10 flex h-12 items-center gap-3 border-b border-border bg-background/80 px-3 backdrop-blur">
      <Brand name="night" suffix="editor" />

      <Button variant="outline" size="sm" onClick={() => void openFile()} disabled={busy}>
        <IconOpen />
        열기
      </Button>

      {file && (
        <>
          <span className="truncate font-mono text-xs text-muted-foreground">{file.name}</span>

          {title && (
            <div className="flex items-center gap-1.5">
              <Label htmlFor="doc-title" className="text-muted-foreground">
                제목
              </Label>
              <Input
                id="doc-title"
                className="h-8 w-56"
                value={titleValue}
                disabled={title.locked !== null}
                title={title.locked ? `편집할 수 없다 — ${title.locked}` : undefined}
                onChange={(e) => onEdit(title.id, e.target.value)}
              />
            </div>
          )}
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        {file && !file.handle && (
          <span className="text-xs text-muted-foreground">
            {canOverwrite() ? '드롭한 파일은 덮어쓸 수 없다' : '이 브라우저는 덮어쓰기 미지원'}
          </span>
        )}
        {file && (
          <Button size="sm" onClick={() => void save()} disabled={busy || patches.size === 0}>
            <IconSave />
            저장 {patches.size > 0 && `(${patches.size})`}
          </Button>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
