import { Brand } from '@/components/Brand';
import { DocSelect } from '@/components/DocSelect';
import { LangSelect } from '@/components/LangSelect';
import { OpenButton } from '@/components/OpenButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { canOverwrite } from '@/lib/fs';
import { IconDownloadCopy, IconSave } from '@/lib/icons';
import { lockNotice } from '@/lib/messages';
import { titleBlock, useEditor } from '@/store/editor';
import { useI18n } from '@/store/locale';

export function Toolbar() {
  const file = useEditor((s) => s.file);
  const blocks = useEditor((s) => s.blocks);
  const patches = useEditor((s) => s.patches);
  const busy = useEditor((s) => s.busy);
  const onEdit = useEditor((s) => s.onEdit);
  const save = useEditor((s) => s.save);
  const downloadCopy = useEditor((s) => s.downloadCopy);
  const { t } = useI18n();

  const title = titleBlock(blocks);
  const titleValue = (title && patches.get(title.id)) ?? title?.sourceText ?? '';

  return (
    <header className="sticky top-0 z-10 flex h-12 items-center gap-3 border-b border-border bg-background/80 px-3 backdrop-blur">
      <Brand />

      <OpenButton />

      {file && (
        <>
          <span className="truncate font-mono text-xs text-muted-foreground">{file.name}</span>
          <DocSelect />

          {title && (
            <div className="flex items-center gap-1.5">
              <Label htmlFor="doc-title" className="text-muted-foreground">
                {t('toolbar.title')}
              </Label>
              <Input
                id="doc-title"
                className="h-8 w-56"
                value={titleValue}
                disabled={title.locked !== null}
                title={
                  title.locked
                    ? t('toolbar.notEditable', { reason: lockNotice(title.locked) })
                    : undefined
                }
                onChange={(e) => onEdit(title.id, e.target.value)}
              />
            </div>
          )}
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        {file && !file.handle && (
          <span className="truncate text-xs text-muted-foreground">
            {t(canOverwrite() ? 'toolbar.droppedNoOverwrite' : 'toolbar.noOverwriteSupport')}
          </span>
        )}
        {file && (
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
          <Button size="sm" onClick={() => void save()} disabled={busy || patches.size === 0}>
            <IconSave />
            {t('toolbar.save')} {patches.size > 0 && `(${patches.size})`}
          </Button>
        )}
        <LangSelect />
        <ThemeToggle />
      </div>
    </header>
  );
}
