/** Single source for icons — no app code imports lucide directly except this file.
 *
 *  The UI uses **semantic names** (`IconSave`, `IconRevert`), never picture names
 *  (`Save`, `Undo2`). Swapping a picture means changing one mapping line below, and
 *  the same meaning can never end up with two different pictures.
 *
 *  Exception: `components/ui/*` is shadcn-generated and keeps its original imports
 *  for upstream updates. Those icons are internal parts of a component (a select's
 *  check and chevron), not part of the screen's vocabulary. */
import { createElement } from 'react';
import {
  Boxes,
  FilePen,
  Download,
  FileUp,
  FileX,
  FolderOpen,
  FolderSearch,
  FolderTree,
  FileCode2,
  Unplug,
  Info,
  X,
  Languages,
  LoaderCircle,
  Lock,
  Moon,
  PencilLine,
  RotateCcw,
  Save,
  Sun,
  Undo2,
  type LucideIcon,
} from 'lucide-react';

export type { LucideIcon };

/** Brand — the app icon file lives in public/ only, shared by index.html and the PWA
 *  manifest. The path is resolved with BASE_URL: GitHub Pages serves from a subpath
 *  (/nighteditor/), so a hard-coded absolute path 404s in the deployed build (Vite
 *  rewrites the links inside index.html, but this is a runtime string).
 *  IconBrand is the fallback picture when the image is not used. */
export const APP_ICON = import.meta.env.BASE_URL + 'apple-touch-icon.png';
export const IconBrand = FilePen;

/** Files */
export const IconOpen = FolderOpen;
/** Open a whole folder — a bundle, not a single file */
export const IconOpenFolder = FolderTree;
export const IconDrop = FileUp;
export const IconSave = Save;
export const IconDownloadCopy = Download;

/** Revert */
export const IconRevert = Undo2;
export const IconRevertAll = RotateCcw;

/** Status — locks (Principle 3) and notices use different pictures */
export const IconLocked = Lock;
export const IconNotice = Info;
/** Dismiss a notification */
export const IconClose = X;
/** Close the open document — different meaning from dismissing a toast (IconClose), so a different picture */
export const IconCloseDoc = FileX;
/** An asset could not be attached — the reference exists but the file does not */
export const IconUnlinked = Unplug;
export const IconLinkFolder = FolderSearch;
/** One document inside a bundle */
export const IconDocument = FileCode2;
export const IconScanning = LoaderCircle;

/** Block tallies */
export const IconBlocks = Boxes;
export const IconEditable = PencilLine;

/** Language */
export const IconLanguage = Languages;

/** Theme — shows the side you would switch to */
export const IconThemeLight = Sun;
export const IconThemeDark = Moon;

/**
 * The GitHub mark. lucide no longer ships brand icons, so it is drawn here directly
 * (octicons `mark-github`). Keeping it alongside the other icons leaves a single
 * place to swap it.
 */
export function IconGithub({ className }: { className?: string }) {
  return createElement(
    'svg',
    { viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': true, className },
    createElement('path', {
      d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z',
    })
  );
}
