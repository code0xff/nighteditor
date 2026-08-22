/**
 * The controls the toolbar has no room for below `md` — language, theme, the
 * link to the source, and downloading a copy.
 *
 * None of them acts on the document's text, and on a phone the toolbar has to
 * spend its width on the ones that do. They sit at the foot of the change list
 * instead, which is where everything that is not an edit already lives — the
 * title field sits at its head for the same reason.
 */
import { Button } from '@/components/ui/button';
import { LangSelect } from '@/components/LangSelect';
import { RepoLink } from '@/components/RepoLink';
import { Separator } from '@/components/ui/separator';
import { ThemeToggle } from '@/components/ThemeToggle';
import { IconDownloadCopy } from '@/lib/icons';
import { useEditor } from '@/store/editor';
import { useI18n } from '@/store/locale';

export function SideControls() {
  const file = useEditor((s) => s.file);
  const downloadCopy = useEditor((s) => s.downloadCopy);
  const { t } = useI18n();

  return (
    <div className="mt-auto flex flex-col gap-2">
      <Separator />
      {file && (
        <Button variant="outline" size="sm" className="justify-start" onClick={downloadCopy}>
          <IconDownloadCopy />
          {t('toolbar.downloadCopy')}
        </Button>
      )}
      <div className="flex items-center gap-1">
        <LangSelect />
        <RepoLink />
        <ThemeToggle />
      </div>
    </div>
  );
}
