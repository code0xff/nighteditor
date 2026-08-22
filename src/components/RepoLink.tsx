/**
 * A link to the source repository.
 *
 * A tool with no backend and no accounts — reading the source is the only way
 * to verify what this app does. Something that opens and edits other people's
 * documents ought to keep that path on screen (Principle 5).
 *
 * A link, not a button — it opens a new tab, so browser defaults like middle
 * click and copy must stay intact.
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
        // Never hand this window to the new tab.
        rel="noreferrer noopener"
        aria-label={label}
        title={label}
      >
        <IconGithub className="h-4 w-4" />
      </a>
    </Button>
  );
}
