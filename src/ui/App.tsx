import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Toaster } from '@/components/Toaster';
import { Button } from '@/components/ui/button';
import { onFileLaunch, readDroppedFolder } from '@/lib/fs';
import { IconDrop, IconLinkFolder, IconUnlinked } from '@/lib/icons';
import { onEditorShortcuts } from '@/lib/shortcuts';
import { onBeforeUnload } from '@/lib/unsaved';
import { ERROR_NOTICES } from '@/lib/messages';
import { cn } from '@/lib/utils';
import { countAssets, useEditor } from '@/store/editor';
import { useReplacement } from '@/store/replacement';
import { shortcutSave } from '@/store/unsaved';
import { useToasts } from '@/store/toasts';
import { UnsavedDialog } from '@/components/UnsavedDialog';
import { useI18n } from '@/store/locale';
import { ChangeList } from './ChangeList';
import { PreviewFrame } from './PreviewFrame';
import { Toolbar } from './Toolbar';

export function App() {
  const file = useEditor((s) => s.file);
  const notice = useEditor((s) => s.notice);
  const openDropped = useEditor((s) => s.openDropped);
  const adopt = useEditor((s) => s.adopt);
  const downloadCopy = useEditor((s) => s.downloadCopy);
  const undoLast = useEditor((s) => s.undoLast);
  const unsaved = useEditor((s) => s.unsaved);
  // 저장이 도는 동안도, 갈아 끼우는 동안도 폴더 연결을 새로 시작하지 않는다 (ADR-010).
  const saving = useEditor((s) => s.saving);
  const replacing = useReplacement((s) => s.replacing);
  const linkFolder = useEditor((s) => s.linkFolder);
  // 참조는 있는데 못 붙인 자원. 조용히 깨진 채로 두지 않는다 (대원칙 3 · spec §5.1).
  const missing = useEditor((s) => countAssets(s).missing);
  const failedToOpen = useEditor((s) => s.failedToOpen);
  const show = useToasts((s) => s.show);
  const { t } = useI18n();
  // 저장 전 편집은 메모리에만 있다. 탭을 닫기 전에 브라우저가 되묻게 한다.
  // 기준은 패치 개수가 아니다 — 저장해도 패치는 남아서(INV-1), 그걸로 물으면
  // 이미 저장한 사람까지 나갈 때마다 붙잡는다. 파일과 다른가(unsaved)로만 묻는다.
  useEffect(() => onBeforeUnload(() => unsaved), [unsaved]);
  const [dragging, setDragging] = useState(false);

  // 설치된 PWA 를 OS 에서 "이 앱으로 열기" 했을 때 파일이 여기로 들어온다.
  useEffect(() => onFileLaunch((f) => void adopt(f)), [adopt]);

  // 프리뷰 밖(툴바·사이드바)에 포커스가 있을 때의 단축키. 프리뷰 안쪽은 에이전트가 넘긴다.
  // 저장은 곧장 save() 가 아니라 shortcutSave 다 — 저장 물음이 떠 있는 동안의 Ctrl+S 는
  // 그 물음의 "저장하고 계속" 이어야 하려던 일이 취소되지 않는다 (spec §4).
  useEffect(
    () => onEditorShortcuts({ save: shortcutSave, downloadCopy, undo: undoLast }),
    [downloadCopy, undoLast]
  );

  // 알림은 오른쪽 위로 띄운다. 배너로 두면 뜰 때마다 읽던 자리가 아래로 밀린다.
  useEffect(() => {
    if (notice) show(notice, ERROR_NOTICES.has(notice.key) ? 'error' : 'info');
  }, [notice, show]);

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
        // 폴더 항목은 이벤트가 끝나면 사라진다 — 훑기는 지금 시작한다. 예약·묻기·
        // 잠금·설치는 스토어(openDropped)가 한 규칙으로 한다 (spec §5 · 갈아 끼우기 예약).
        // 물음이나 열기 자체가 죽으면 catch 로 온다. 잡지 않으면 놓아도 아무 일이
        // 없는 것처럼 보인다.
        void openDropped(dropped, readDroppedFolder(items)).catch(failedToOpen);
      }}
    >
      <Toolbar />
      <UnsavedDialog />

      <Toaster />

      {file && missing > 0 && (
        <div className="px-3 pt-2">
          <Alert>
            <IconUnlinked className="h-3.5 w-3.5" />
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>{t('assets.missing', { count: missing })}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={saving || replacing}
                // 묻는 것은 linkFolder 가 한다. 여기서 먼저 물으면 두 번 묻게 되고,
                // 저장을 고르면 그 사이 제스처가 만료돼 폴더 대화상자가 거절될 수 있다.
                onClick={() => void linkFolder()}
              >
                <IconLinkFolder />
                {replacing ? t('assets.linking') : t('assets.link')}
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
