import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { onFileLaunch } from '@/lib/fs';
import { IconDrop, IconLocked, IconNotice } from '@/lib/icons';
import { lockNotice } from '@/lib/messages';
import { cn } from '@/lib/utils';
import { useEditor } from '@/store/editor';
import { useI18n } from '@/store/locale';
import { ChangeList } from './ChangeList';
import { PreviewFrame } from './PreviewFrame';
import { Toolbar } from './Toolbar';

export function App() {
  const file = useEditor((s) => s.file);
  const notice = useEditor((s) => s.notice);
  const blockedId = useEditor((s) => s.blockedId);
  const blocks = useEditor((s) => s.blocks);
  const loadDropped = useEditor((s) => s.loadDropped);
  const adopt = useEditor((s) => s.adopt);
  const { t, tn } = useI18n();
  const [dragging, setDragging] = useState(false);

  // 설치된 PWA 를 OS 에서 "이 앱으로 열기" 했을 때 파일이 여기로 들어온다.
  useEffect(() => onFileLaunch((f) => void adopt(f)), [adopt]);

  const blocked = blocks.find((b) => b.id === blockedId);
  const NoticeIcon = notice ? IconNotice : IconLocked;
  const alert = notice
    ? tn(notice)
    : blocked?.locked
      ? t('app.blocked', { reason: lockNotice(blocked.locked) })
      : null;

  return (
    <div
      className="flex h-screen flex-col bg-background text-foreground"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const dropped = e.dataTransfer.files[0];
        if (dropped) void loadDropped(dropped);
      }}
    >
      <Toolbar />

      {alert && (
        <div className="px-3 pt-2">
          <Alert>
            <NoticeIcon className="h-3.5 w-3.5" />
            <AlertDescription>{alert}</AlertDescription>
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
          <aside className="w-72 shrink-0 border-l border-border">
            <ChangeList />
          </aside>
        )}
      </main>
    </div>
  );
}
