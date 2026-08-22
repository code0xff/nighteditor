/**
 * Picks which document to open when a bundle (folder, zip) holds several (spec §5.1).
 *
 * With only one there is nothing to pick, so it renders nothing — the toolbar
 * already shows the file name.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { IconDocument } from '@/lib/icons';
import { useEditor, useEditorBusy } from '@/store/editor';
import { useI18n } from '@/store/locale';

export function DocSelect() {
  const candidates = useEditor((s) => s.candidates);
  const docPath = useEditor((s) => s.docPath);
  // No new switch starts while a save is running or a replacement is underway (ADR-010).
  const busy = useEditorBusy();
  const openFromBundle = useEditor((s) => s.openFromBundle);
  const { t } = useI18n();

  if (candidates.length < 2) return null;
  const label = t('toolbar.document', { count: candidates.length });

  return (
    <Select
      value={docPath}
      disabled={busy}
      // Switching documents redraws the preview, so edits would be lost.
      // Never discarded silently — the store does the asking.
      onValueChange={(path) => void openFromBundle(path)}
    >
      {/* Until `lg` only the icon is left — the path would take the room the title
          field needs and push the header past the window. Which document is open
          still reads from the title field beside it, from this button's tooltip,
          and from the check mark in the list. (The `!` is needed: the trigger's own
          `[&>span]:line-clamp-1` sets a display that otherwise beats `hidden`.) */}
      <SelectTrigger
        className="h-8 w-auto max-w-64 shrink-0 gap-1.5 [&>span]:!hidden [&>svg:last-child]:hidden lg:[&>span]:!block lg:[&>svg:last-child]:block"
        aria-label={label}
        title={`${label} · ${docPath}`}
      >
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
