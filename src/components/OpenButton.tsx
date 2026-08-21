/**
 * 여는 입구 (spec §4).
 *
 * **버튼이 둘인 것은 취향이 아니라 플랫폼 제약이다.** 웹에는 파일과 폴더를 함께 고르는
 * 대화상자가 없다 — `showOpenFilePicker` 는 파일만, `showDirectoryPicker` 는 폴더만 준다.
 * 어느 쪽 창을 띄울지 **누르기 전에** 정해야 하므로, 입구도 그만큼 있어야 한다.
 * (끌어다 놓기는 놓인 것을 보고 정할 수 있어서 하나로 받는다 — `ui/App.tsx`)
 *
 * 메뉴로 묶어 하나처럼 보이게 할 수도 있지만, 그러면 매번 한 번 더 누르게 된다.
 * 버튼 둘은 자리를 조금 더 쓰는 대신 한 번에 간다.
 *
 * 저장하지 않은 편집을 묻는 일은 **스토어가** 한다. 대화상자는 사용자 제스처 안에서
 * 열려야 하므로, 여기서 먼저 묻고 기다렸다가 열면 그 사이 제스처가 만료된다.
 */
import { Button } from '@/components/ui/button';
import { canPickFolder } from '@/lib/fs';
import { IconOpen, IconOpenFolder } from '@/lib/icons';
import { useEditor } from '@/store/editor';
import { useI18n } from '@/store/locale';

export function OpenButton() {
  const busy = useEditor((s) => s.busy);
  const openFile = useEditor((s) => s.openFile);
  const openFolder = useEditor((s) => s.openFolder);
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        title={t('toolbar.openFileHint')}
        onClick={() => void openFile()}
      >
        <IconOpen />
        {t('toolbar.openFile')}
      </Button>

      {/* 폴더를 못 여는 브라우저에서는 누를 수 없는 버튼을 두지 않는다 */}
      {canPickFolder() && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          title={t('toolbar.openFolderHint')}
          onClick={() => void openFolder()}
        >
          <IconOpenFolder />
          {t('toolbar.openFolder')}
        </Button>
      )}
    </div>
  );
}
