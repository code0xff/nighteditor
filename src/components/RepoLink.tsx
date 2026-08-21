/**
 * 소스 저장소로 가는 링크.
 *
 * 백엔드도 계정도 없는 도구라, 이 앱이 무엇을 하는지 확인할 방법은 소스를 읽는 것뿐이다.
 * 남의 문서를 열어 고치는 물건이니 그 길을 화면에 두는 편이 맞다 (대원칙 5).
 *
 * 버튼이 아니라 링크다 — 새 탭으로 나가는 동작이므로 가운데 클릭·복사 같은
 * 브라우저 기본 동작이 그대로 살아 있어야 한다.
 */
import { Button } from '@/components/ui/button';
import { IconGithub } from '@/lib/icons';
import { useI18n } from '@/store/locale';

const REPO_URL = 'https://github.com/code0xff/nighteditor';

export function RepoLink() {
  const { t } = useI18n();
  const label = t('toolbar.repo');

  return (
    <Button variant="ghost" size="icon" asChild>
      <a
        href={REPO_URL}
        target="_blank"
        // 새 탭에 이 창을 넘겨주지 않는다.
        rel="noreferrer noopener"
        aria-label={label}
        title={label}
      >
        <IconGithub className="h-4 w-4" />
      </a>
    </Button>
  );
}
