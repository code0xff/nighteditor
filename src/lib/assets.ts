/**
 * 읽어들인 파일들을 프리뷰에 붙일 수 있는 `blob:` URL 묶음으로 만든다 (ADR-009).
 *
 * 파일은 이 기기를 떠나지 않는다 (대원칙 5). blob URL 은 이 탭 안에서만 유효한
 * 이름표일 뿐, 어디로도 올라가지 않는다.
 */
import { cssAssetPaths, dirOf, rewriteCssUrls } from '@/core/assets';
import type { AssetBundle } from './bundle';

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

/**
 * 이 파일의 blob 에 붙일 형식 — **아는 확장자면 확장자가 이긴다** (spec §5.1).
 *
 * 폴더·드롭이 준 `File` 의 보고된 형식은 못 믿는다 — `.js` 를 `text/plain` 으로
 * 주는 환경이 있고, 그대로 blob 에 실으면 브라우저가 링크된 스크립트를 형식이
 * 다르다며 거절해 파일이 옆에 있는데도 프리뷰에서 돌지 않는다. 문서가 확장자로
 * 참조한 파일에 기대하는 형식은 확장자의 것이다. 모르는 확장자만 보고된 형식을 믿는다.
 */
function typeFor(path: string, blob: Blob): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME[ext] ?? (blob.type || 'application/octet-stream');
}

function isCss(path: string): boolean {
  return path.toLowerCase().endsWith('.css');
}

/**
 * 파일 묶음을 blob URL 묶음으로 바꾼다.
 *
 * CSS 는 나중에 만든다. 그 안의 `url()` 을 다른 자원의 blob URL 로 바꿔야
 * 하는데, 그러려면 그 자원들의 URL 이 먼저 있어야 한다.
 */
export async function buildAssets(
  files: ReadonlyMap<string, Blob>,
  /** 문서가 실제로 부르는 경로. 여기서 닿는 스타일시트만 훑는다 */
  reachable?: readonly string[]
): Promise<AssetBundle> {
  const urls = new Map<string, string>();
  const made: string[] = [];
  const add = (path: string, blob: Blob): void => {
    const url = URL.createObjectURL(blob);
    urls.set(path, url);
    made.push(url);
  };

  for (const [path, blob] of files) {
    if (isCss(path)) continue;
    const type = typeFor(path, blob);
    add(path, blob.type === type ? blob : new Blob([blob], { type }));
  }

  // 스타일시트끼리도 서로를 부른다 (`@import url(…)`). 부르는 쪽의 blob 을 먼저
  // 만들면 불리는 쪽의 URL 이 아직 없어 참조가 상대 경로로 남는다 — blob 문서에서
  // 상대 경로는 풀리지 않는다. 그래서 무엇이 무엇을 부르는지 먼저 읽어 둔다.
  const sheets = new Map<string, { text: string; wants: string[] }>();
  for (const [path, blob] of files) {
    if (isCss(path)) sheets.set(path, { text: await blob.text(), wants: [] });
  }
  for (const [path, sheet] of sheets) {
    // 스타일시트는 자기가 놓인 자리를 기준으로 자기 안의 경로를 푼다.
    sheet.wants = cssAssetPaths(sheet.text, dirOf(path)).filter((p) => p !== path && sheets.has(p));
  }

  // 불리는 쪽부터 만든다. 순환이면 더 기다려도 URL 은 생기지 않으므로 고리를 그대로
  // 만들어야 하는데, 그때 **남은 것 전부**를 만들면 안 된다 — 고리를 밖에서 부르는
  // 시트(문서의 진입 시트 등)까지 고리 멤버의 URL 이 생기기 전에 만들어져, 그 @import
  // 가 상대 경로로 남아 blob 문서에서 영영 풀리지 않는다. 고리도 여럿일 수 있다 —
  // 서로 얽힌 시트들(강결합 덩어리)이 한 단위고, 다른 고리에 기대는 고리를 한꺼번에
  // 만들면 그 @import 도 같은 이유로 상대 경로로 남는다. 그래서 남은 시트에 더는
  // 기대지 않는 **덩어리 하나**만 만들고, 기대던 쪽(고리든 낱장이든)은 다음 바퀴에서
  // 방금 생긴 URL 을 달고 만든다 (spec §5.1).
  const left = new Map(sheets);
  /** start 에서 남은 시트의 @import 만 따라가 닿는 시트들 (자기 자신 포함 가능) */
  const reach = (start: string): Set<string> => {
    const seen = new Set<string>();
    const queue = [...(left.get(start)?.wants ?? [])];
    for (let at = 0; at < queue.length; at++) {
      const path = queue[at] as string;
      if (seen.has(path) || !left.has(path)) continue;
      seen.add(path);
      queue.push(...(left.get(path)?.wants ?? []));
    }
    return seen;
  };
  /**
   * 남은 시트끼리 서로 닿는 덩어리(강결합 덩어리) 중, 남은 다른 시트에 더는 기대지
   * 않는 것 하나. ready 가 비었을 때만 부른다 — 그때 남은 모두가 남은 시트를
   * 기다리는 중이라 고리가 반드시 있고, 덩어리 사이의 의존에는 고리가 없으므로
   * (있다면 이미 한 덩어리다) 밖에 기댈 곳 없는 덩어리도 반드시 있다.
   */
  const sinkCycle = (): [string, { text: string; wants: string[] }][] => {
    for (const start of left.keys()) {
      const forward = reach(start);
      if (!forward.has(start)) continue; // 고리의 멤버가 아니다
      const scc = new Set([start, ...[...forward].filter((p) => reach(p).has(start))]);
      const leans = [...scc].some((member) =>
        (left.get(member)?.wants ?? []).some((want) => left.has(want) && !scc.has(want))
      );
      if (!leans) return [...left].filter(([path]) => scc.has(path));
    }
    // 여기 올 수 없다 — 그래도 온다면 남은 전부를 만들어 순회만은 끝낸다 (탭을 굳히지 않는다).
    return [...left];
  };
  while (left.size > 0) {
    const ready = [...left].filter(([, sheet]) => !sheet.wants.some((p) => left.has(p)));
    // 매 바퀴 최소 한 장(ready 한 장 또는 덩어리 하나)은 만들어져 루프는 끝난다.
    const batch = ready.length > 0 ? ready : sinkCycle();
    for (const [path, sheet] of batch) {
      const css = rewriteCssUrls(sheet.text, dirOf(path), (p) => urls.get(p));
      add(path, new Blob([css], { type: 'text/css' }));
      left.delete(path);
    }
  }

  // 못 붙인 것은 **이 문서가 부르는** 스타일시트에서만 센다. 폴더에 굴러다니는 남의
  // 스타일시트가 부르는 글꼴까지 세면, 이 문서와 아무 상관 없는 파일을 찾으라고 조른다.
  const wanted = reachable ? new Set(reachable) : null;
  // "부르는" 은 한 다리가 아니다 — 문서가 부른 시트가 @import 로 다른 시트를 부르면
  // 그 시트가 부르는 것도 이 문서의 것이다. 문서에서 바로 닿는 시트만 보면 한 다리
  // 건너의 깨진 참조가 조용히 넘어가, 화면은 깨졌는데 못 붙였다는 말이 없다 (대원칙 3).
  if (wanted) {
    const queue = [...wanted].filter((p) => sheets.has(p));
    for (let at = 0; at < queue.length; at++) {
      for (const want of sheets.get(queue[at] ?? '')?.wants ?? []) {
        if (!wanted.has(want)) {
          wanted.add(want);
          queue.push(want);
        }
      }
    }
  }
  const missing = new Set<string>();

  for (const [path, sheet] of sheets) {
    if (wanted && !wanted.has(path)) continue;
    for (const want of cssAssetPaths(sheet.text, dirOf(path))) {
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
