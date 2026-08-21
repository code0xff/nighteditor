/**
 * 묶음(폴더·zip) 안에 문서가 여럿일 때 무엇을 열지 고른다 (spec §5.1).
 *
 * 하나뿐이면 고를 것이 없으므로 아무것도 그리지 않는다 — 파일 이름은 툴바가 이미 보여준다.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { IconDocument } from '@/lib/icons';
import { useEditor } from '@/store/editor';
import { useI18n } from '@/store/locale';

export function DocSelect() {
  const candidates = useEditor((s) => s.candidates);
  const docPath = useEditor((s) => s.docPath);
  const busy = useEditor((s) => s.busy);
  const openFromBundle = useEditor((s) => s.openFromBundle);
  const { t } = useI18n();

  if (candidates.length < 2) return null;
  const label = t('toolbar.document', { count: candidates.length });

  return (
    <Select
      value={docPath}
      disabled={busy}
      // 문서를 바꾸면 프리뷰를 다시 그리므로 고친 내용은 사라진다.
      // 조용히 버리지 않는다 — 묻는 것은 스토어가 한다.
      onValueChange={(path) => void openFromBundle(path)}
    >
      <SelectTrigger className="h-8 w-auto max-w-64 gap-1.5" aria-label={label} title={label}>
        <IconDocument className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {candidates.map((path) => (
          <SelectItem key={path} value={path} className="font-mono text-xs">
            {path}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
