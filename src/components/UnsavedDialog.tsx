/**
 * 저장하지 않은 편집을 두고 다른 데로 가려 할 때 뜨는 물음 (spec §4).
 *
 * 선택지가 셋이라 브라우저의 `confirm` 으로는 만들 수 없다. 사용자가 정작 원하는
 * **저장하고 계속**이 그 둘 중에 없기 때문이다.
 *
 * 저장 버튼의 문구는 지금 문서가 덮어쓸 수 있는지에 따라 갈린다 — 드롭이나 zip 으로
 * 연 문서는 되쓸 자리가 없어 사본을 내려받는다. "저장" 이라고만 적으면 거짓말이 된다.
 */
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { IconDownloadCopy, IconSave } from '@/lib/icons';
import { unsavedCount, useEditor } from '@/store/editor';
import { useI18n } from '@/store/locale';
import { useUnsaved } from '@/store/unsaved';

export function UnsavedDialog() {
  const why = useUnsaved((s) => s.why);
  const reply = useUnsaved((s) => s.reply);
  // 패치 총수가 아니다 — 저장해도 패치는 남고(INV-1), 저장한 편집을 되돌리면 패치
  // 없이도 파일과 다르다. 여기 적는 수는 **파일과 다른 블록 수**다 (spec §4).
  const count = useEditor(unsavedCount);
  const busy = useEditor((s) => s.busy);
  const overwrites = useEditor((s) => Boolean(s.file?.handle));
  const { t } = useI18n();

  if (!why) return null;

  return (
    <Dialog
      open
      // 바깥을 누르거나 Escape 를 눌렀다면 아무것도 하지 말라는 뜻이다.
      onClose={() => reply('cancel')}
      title={t('confirm.title')}
      footer={
        <>
          <Button variant="ghost" onClick={() => reply('cancel')}>
            {t('confirm.cancel')}
          </Button>
          <Button variant="outline" onClick={() => reply('discard')}>
            {t('confirm.discard')}
          </Button>
          <Button disabled={busy} onClick={() => reply('save')}>
            {overwrites ? <IconSave /> : <IconDownloadCopy />}
            {t(overwrites ? 'confirm.save' : 'confirm.saveCopy')}
          </Button>
        </>
      }
    >
      <p className="text-sm">{t('confirm.body', { count, why })}</p>
    </Dialog>
  );
}
