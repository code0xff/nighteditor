/** 아이콘 단일 출처 — lucide 를 직접 import 하는 앱 코드는 이 파일뿐이다.
 *
 *  UI 는 그림 이름(`Save`, `Undo2`)이 아니라 **의미 이름**(`IconSave`, `IconRevert`)만 쓴다.
 *  그림을 갈아끼울 땐 아래 매핑 한 줄만 고치면 되고, 같은 뜻에 다른 그림이 섞이는 일도 없다.
 *
 *  예외: `components/ui/*` 는 shadcn 생성물이라 업스트림 갱신을 위해 원본 import 를 유지한다.
 *  그쪽 아이콘은 컴포넌트의 내부 부품(셀렉트의 체크·화살표)이고 화면의 어휘가 아니다. */
import { createElement } from 'react';
import {
  Boxes,
  FilePen,
  Download,
  FileUp,
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

/** 브랜드 — 앱 아이콘 파일은 public/ 한곳에 있고, index.html 과 PWA 매니페스트가 같은 파일을 쓴다.
 *  경로는 BASE_URL 로 맞춘다. GitHub Pages 는 하위 경로(/nighteditor/)로 서빙되므로
 *  절대 경로로 박으면 배포본에서 404 다 (index.html 안의 링크는 Vite 가 고쳐주지만 이건 런타임 문자열이다).
 *  IconBrand 는 이미지를 쓰지 않을 때의 대체 그림이다. */
export const APP_ICON = import.meta.env.BASE_URL + 'apple-touch-icon.png';
export const IconBrand = FilePen;

/** 파일 */
export const IconOpen = FolderOpen;
/** 폴더째 열기 — 파일 하나가 아니라 묶음을 연다 */
export const IconOpenFolder = FolderTree;
export const IconDrop = FileUp;
export const IconSave = Save;
export const IconDownloadCopy = Download;

/** 되돌리기 */
export const IconRevert = Undo2;
export const IconRevertAll = RotateCcw;

/** 상태 — 잠금(대원칙 3)과 안내는 다른 그림을 쓴다 */
export const IconLocked = Lock;
export const IconNotice = Info;
/** 알림 닫기 */
export const IconClose = X;
/** 자원을 못 붙였다 — 참조는 있는데 파일이 없다 */
export const IconUnlinked = Unplug;
export const IconLinkFolder = FolderSearch;
/** 묶음 안의 문서 하나 */
export const IconDocument = FileCode2;
export const IconScanning = LoaderCircle;

/** 블록 집계 */
export const IconBlocks = Boxes;
export const IconEditable = PencilLine;

/** 언어 */
export const IconLanguage = Languages;

/** 테마 — 누르면 바뀌는 쪽을 보여준다 */
export const IconThemeLight = Sun;
export const IconThemeDark = Moon;

/**
 * 깃허브 마크. lucide 는 상표 아이콘을 더 이상 싣지 않아 여기서 직접 그린다
 * (octicons `mark-github`). 다른 아이콘과 같은 자리에 두어야 갈아끼울 곳이 하나로 남는다.
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
