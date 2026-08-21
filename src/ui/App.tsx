import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { onFileLaunch, readDroppedFolder } from '@/lib/fs';
import { IconDrop, IconLinkFolder, IconLocked, IconNotice, IconUnlinked } from '@/lib/icons';
import { onEditorShortcuts } from '@/lib/shortcuts';
import { onBeforeUnload } from '@/lib/unsaved';
import { lockNotice } from '@/lib/messages';
import { cn } from '@/lib/utils';
import { countAssets, useEditor } from '@/store/editor';
import { keepEdits } from '@/store/unsaved';
import { UnsavedDialog } from '@/components/UnsavedDialog';
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
  const loadFolder = useEditor((s) => s.loadFolder);
  const adopt = useEditor((s) => s.adopt);
  const save = useEditor((s) => s.save);
  const downloadCopy = useEditor((s) => s.downloadCopy);
  const undoLast = useEditor((s) => s.undoLast);
  const patches = useEditor((s) => s.patches);
  const busy = useEditor((s) => s.busy);
  const linkFolder = useEditor((s) => s.linkFolder);
  // 참조는 있는데 못 붙인 자원. 조용히 깨진 채로 두지 않는다 (대원칙 3 · spec §5.1).
  const missing = useEditor((s) => countAssets(s).missing);
  const { t, tn } = useI18n();
  // 저장 전 편집은 메모리에만 있다. 탭을 닫기 전에 브라우저가 되묻게 한다.
  useEffect(() => onBeforeUnload(() => patches.size > 0), [patches]);
  const [dragging, setDragging] = useState(false);

  // 설치된 PWA 를 OS 에서 "이 앱으로 열기" 했을 때 파일이 여기로 들어온다.
  useEffect(() => onFileLaunch((f) => void adopt(f)), [adopt]);

  // 프리뷰 밖(툴바·사이드바)에 포커스가 있을 때의 단축키. 프리뷰 안쪽은 에이전트가 넘긴다.
  useEffect(
    () => onEditorShortcuts({ save: () => void save(), downloadCopy, undo: undoLast }),
    [save, downloadCopy, undoLast]
  );

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
        const { items } = e.dataTransfer;
        if (!dropped && items.length === 0) return;
        // 폴더 항목은 이벤트가 끝나면 사라진다. 묻기 전에 먼저 꺼내 둔다.
        const folder = readDroppedFolder(items);
        // 새 파일을 열면 지금 편집은 사라진다. 조용히 버리지 않는다.
        void keepEdits({ key: 'confirm.whyOpen' }).then(async (go) => {
          if (!go) return;
          // 폴더를 놓았는지는 스토어가 가린다. 폴더가 아니었으면 파일로 연다.
          if (!(await loadFolder(await folder)) && dropped) void loadDropped(dropped);
        });
      }}
    >
      <Toolbar />
      <UnsavedDialog />

      {alert && (
        <div className="px-3 pt-2">
          <Alert>
            <NoticeIcon className="h-3.5 w-3.5" />
            <AlertDescription>{alert}</AlertDescription>
          </Alert>
        </div>
      )}

      {file && missing > 0 && (
        <div className="px-3 pt-2">
          <Alert>
            <IconUnlinked className="h-3.5 w-3.5" />
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>{t('assets.missing', { count: missing })}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  // 프리뷰를 다시 그리므로 고친 내용은 사라진다. 조용히 버리지 않는다.
                  void keepEdits({ key: 'confirm.whyAssets' }).then((go) => {
                    if (go) void linkFolder();
                  });
                }}
              >
                <IconLinkFolder />
                {busy ? t('assets.linking') : t('assets.link')}
              </Button>
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
