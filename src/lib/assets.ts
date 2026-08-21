/**
 * 읽어들인 파일들을 프리뷰에 붙일 수 있는 `blob:` URL 묶음으로 만든다 (ADR-009).
 *
 * 파일은 이 기기를 떠나지 않는다 (대원칙 5). blob URL 은 이 탭 안에서만 유효한
 * 이름표일 뿐, 어디로도 올라가지 않는다.
 */
import { cssAssetPaths, dirOf, rewriteCssUrls } from '@/core/assets';

/** 확장자로 유추한 형식 */
const MIME: Record<string, string> = {
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

/**
 * 스타일시트는 형식을 붙여야 한다. 표준 모드의 브라우저는 `text/css` 가 아닌 응답을
 * 스타일시트로 쓰지 않으므로, 형식 없이 만든 blob 은 붙여도 적용되지 않는다.
 */
export function mimeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
}

export interface AssetBundle {
  /** 자원 경로 → blob URL */
  urls: ReadonlyMap<string, string>;
  /**
   * 붙인 스타일시트가 부르는데 묶음에 없던 것.
   *
   * 문서의 속성만 봐서는 알 수 없다 — CSS 안의 글꼴과 배경은 그 파일을 열어봐야 나온다.
   * 못 붙인 것을 세는 자리(§5.1)에서 이걸 함께 센다.
   */
  missing: readonly string[];
  /** 다 쓰면 반드시 부른다. 안 부르면 blob 이 탭을 닫을 때까지 메모리에 남는다 */
  dispose: () => void;
}

export const EMPTY_BUNDLE: AssetBundle = { urls: new Map(), missing: [], dispose: () => {} };

function isCss(path: string): boolean {
  return path.toLowerCase().endsWith('.css');
}

/**
 * 파일 묶음을 blob URL 묶음으로 바꾼다.
 *
 * CSS 는 두 번째 차례에 만든다. 그 안의 `url()` 을 다른 자원의 blob URL 로 바꿔야
 * 하는데, 그러려면 그 자원들의 URL 이 먼저 있어야 한다.
 */
export async function buildAssets(files: ReadonlyMap<string, Blob>): Promise<AssetBundle> {
  const urls = new Map<string, string>();
  const made: string[] = [];
  const add = (path: string, blob: Blob): void => {
    const url = URL.createObjectURL(blob);
    urls.set(path, url);
    made.push(url);
  };

  for (const [path, blob] of files) {
    if (!isCss(path)) add(path, blob.type ? blob : new Blob([blob], { type: mimeOf(path) }));
  }

  const missing = new Set<string>();
  for (const [path, blob] of files) {
    if (!isCss(path)) continue;
    // 스타일시트는 자기가 놓인 자리를 기준으로 자기 안의 경로를 푼다.
    const text = await blob.text();
    const css = rewriteCssUrls(text, dirOf(path), (p) => urls.get(p));
    add(path, new Blob([css], { type: 'text/css' }));

    for (const want of cssAssetPaths(text, dirOf(path))) {
      if (!files.has(want)) missing.add(want);
    }
  }

  return {
    urls,
    missing: [...missing],
    dispose: () => {
      for (const url of made) URL.revokeObjectURL(url);
    },
  };
}
