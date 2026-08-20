import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { onFileLaunch } from '@/lib/fs';
import { IconDrop, IconLocked, IconNotice } from '@/lib/icons';
import { cn } from '@/lib/utils';
import { useEditor } from '@/store/editor';
import { ChangeList } from './ChangeList';
import { PreviewFrame } from './PreviewFrame';
import { Toolbar } from './Toolbar';

export function App() {
  const file = useEditor((s) => s.file);
  const message = useEditor((s) => s.message);
  const blockedId = useEditor((s) => s.blockedId);
  const blocks = useEditor((s) => s.blocks);
  const loadDropped = useEditor((s) => s.loadDropped);
  const adopt = useEditor((s) => s.adopt);
  const [dragging, setDragging] = useState(false);

  // 설치된 PWA 를 OS 에서 "이 앱으로 열기" 했을 때 파일이 여기로 들어온다.
  useEffect(() => onFileLaunch(adopt), [adopt]);

  const blocked = blocks.find((b) => b.id === blockedId);
  const NoticeIcon = message ? IconNotice : IconLocked;

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

      {(message ?? blocked) && (
        <div className="px-3 pt-2">
          <Alert>
            <NoticeIcon className="h-3.5 w-3.5" />
            <AlertDescription>
              {message ?? `이 블록은 편집할 수 없다 — ${blocked?.locked}`}
            </AlertDescription>
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
                <p className="text-sm font-medium">아티팩트 HTML 을 여기에 놓거나 열기를 누른다</p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  글자를 클릭해 고치고, 저장하면 원본에서 고친 부분만 바뀐다
                </p>
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
