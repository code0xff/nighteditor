/**
 * The controls the toolbar has no room for below `md` — the link to the source,
 * and downloading a copy.
 *
 * Neither acts on the document's text, and on a phone the toolbar has to spend
 * its width on the ones that do. They sit at the foot of the change list
 * instead, which is where everything that is not an edit already lives — the
 * title field sits at its head for the same reason.
 *
 * Language and theme are **not** here. They are looked for in the corner of the
 * screen, and everything in this panel needs a document open to reach — which
 * is exactly not the moment someone picks the language they read in.
 */
import { Button } from '@/components/ui/button';
import { RepoLink } from '@/components/RepoLink';
import { Separator } from '@/components/ui/separator';
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
        // Taller than the header's 32px on purpose: this panel is only ever
        // shown below `md`, where the press is a fingertip, and a full-width
        // button 28px tall reads as flat as it is hard to hit.
        <Button variant="outline" size="sm" className="h-10 justify-start" onClick={downloadCopy}>
          <IconDownloadCopy />
          {t('toolbar.downloadCopy')}
        </Button>
      )}
      <div className="flex items-center gap-1">
        <RepoLink />
      </div>
    </div>
  );
}
