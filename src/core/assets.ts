/**
 * 문서가 옆에 두고 참조하는 외부 자원 (spec §5.1).
 *
 * 여기서 하는 일은 **찾기와 치환 목록 만들기**까지다. 파일을 읽는 것도 blob URL 을
 * 만드는 것도 브라우저 쪽 일이라 `lib/assets.ts` 가 한다 (INV-6).
 *
 * 치환 결과는 **프리뷰 전용**이다. 원본 문자열은 언제나 그대로이므로 저장본에는
 * blob URL 이 한 글자도 들어가지 않는다 (대원칙 1 · ADR-009).
 */
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import type { Edit } from './edits.js';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

/**
 * 자원을 **가리키는** 속성만 바꾼다.
 * `<a href>` 는 없다 — 이동할 곳이지 붙일 자원이 아니다.
 */
const ASSET_ATTRS: Record<string, readonly string[]> = {
  link: ['href'],
  script: ['src'],
  img: ['src'],
  source: ['src'],
  video: ['src', 'poster'],
  audio: ['src'],
  iframe: ['src'],
  embed: ['src'],
  object: ['data'],
  track: ['src'],
  input: ['src'],
  use: ['href', 'xlink:href'],
};

export interface AssetRef {
  /** 문서에 적힌 그대로 */
  url: string;
  /** 문서 위치를 기준으로 푼 정규 경로. 자원 묶음의 키가 된다 */
  path: string;
  /** 원본에서 **값만** 가리키는 범위 (따옴표는 포함하지 않는다) */
  valueStart: number;
  valueEnd: number;
}

/** 자원 경로 → 붙일 URL. 없으면 undefined 를 돌려주면 그 자리는 그대로 둔다 */
export type Resolve = (path: string) => string | undefined;

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}

function childrenOf(node: Node): Node[] {
  return 'childNodes' in node ? (node as ParentNode).childNodes : [];
}

/** `a/b/c.html` → `a/b`. 디렉터리가 없으면 빈 문자열 */
export function dirOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

/**
 * 문서 위치를 기준으로 상대 경로를 푼다.
 *
 * 밖으로 나가는 참조(`https:`, `//cdn`, `data:`, `#anchor`)는 null 이다 —
 * 그대로 두는 것이 맞다. 이미 브라우저가 알아서 가져올 수 있거나, 자원이 아니다.
 */
export function resolvePath(baseDir: string, url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  // `scheme:` 과 프로토콜 상대 URL. 윈도 경로(`C:\`)도 여기서 걸린다.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) return null;

  const [clean = ''] = trimmed.split(/[?#]/);
  if (!clean) return null;

  // 절대 경로는 문서가 아니라 묶음의 뿌리를 기준으로 본다 — 폴더/zip 의 최상단이다.
  const fromRoot = clean.startsWith('/');
  const joined = fromRoot ? clean.slice(1) : `${baseDir ? `${baseDir}/` : ''}${clean}`;

  const out: string[] = [];
  for (const segment of joined.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  if (out.length === 0) return null;

  const path = out.join('/');
  // 파일 이름에 공백이 있으면 문서에는 %20 으로 적힌다. 묶음의 키는 실제 이름이다.
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * 속성 위치에서 **값만** 잘라낸다.
 *
 * parse5 가 주는 범위는 `href="deck.css"` 전체다. 따옴표까지 바꾸면 다음 속성과
 * 붙어버리므로 `=` 뒤의 따옴표 안쪽만 골라낸다. 따옴표 없는 값도 받는다.
 */
function valueSpan(
  source: string,
  loc: { startOffset: number; endOffset: number }
): { start: number; end: number } | null {
  const raw = source.slice(loc.startOffset, loc.endOffset);
  const eq = raw.indexOf('=');
  if (eq < 0) return null;

  let at = eq + 1;
  while (at < raw.length && /\s/.test(raw[at] ?? '')) at++;

  const quote = raw[at];
  if (quote === '"' || quote === "'") {
    return { start: loc.startOffset + at + 1, end: loc.endOffset - 1 };
  }
  return { start: loc.startOffset + at, end: loc.endOffset };
}

/**
 * 문서가 참조하는 외부 자원을 모은다.
 *
 * @param baseDir 문서가 놓인 디렉터리 (묶음 안에서의 경로). 루트면 빈 문자열
 */
export function parseAssetRefs(source: string, baseDir = ''): AssetRef[] {
  const doc = parse(source, { sourceCodeLocationInfo: true });
  const refs: AssetRef[] = [];

  const visit = (node: Node): void => {
    if (isElement(node)) {
      const names = ASSET_ATTRS[node.tagName];
      const attrs = node.sourceCodeLocation?.attrs;
      if (names && attrs) {
        for (const name of names) {
          const loc = attrs[name];
          const url = node.attrs.find((a) => a.name === name)?.value;
          if (!loc || url === undefined) continue;

          const path = resolvePath(baseDir, url);
          const span = path === null ? null : valueSpan(source, loc);
          if (path !== null && span) {
            refs.push({ url, path, valueStart: span.start, valueEnd: span.end });
          }
        }
      }
    }
    for (const child of childrenOf(node)) visit(child);
  };

  visit(doc);
  return refs;
}

/** 붙일 자원이 있는 참조만 치환 목록으로 만든다 */
export function assetEdits(refs: readonly AssetRef[], resolve: Resolve): Edit[] {
  const edits: Edit[] = [];
  for (const ref of refs) {
    const url = resolve(ref.path);
    if (url) edits.push({ start: ref.valueStart, end: ref.valueEnd, text: url });
  }
  return edits;
}

/**
 * CSS 안의 `url(...)` 을 바꾼다.
 *
 * blob URL 에는 디렉터리가 없다. 스타일시트만 붙이고 이걸 안 바꾸면 그 안의 글꼴이
 * 기준을 잃어 전부 깨진다. `@import` 는 건드리지 않는다 (spec §5.1).
 */
export function rewriteCssUrls(css: string, baseDir: string, resolve: Resolve): string {
  return css.replace(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi, (whole, quote: string, raw: string) => {
    const path = resolvePath(baseDir, raw);
    if (path === null) return whole;
    const url = resolve(path);
    return url ? `url(${quote}${url}${quote})` : whole;
  });
}

/** 문서에 박혀 있는 `<style>` 안의 `url(...)` 도 같은 규칙으로 바꾼다 */
export function styleEdits(source: string, baseDir: string, resolve: Resolve): Edit[] {
  const doc = parse(source, { sourceCodeLocationInfo: true });
  const edits: Edit[] = [];

  const visit = (node: Node): void => {
    if (isElement(node) && node.tagName === 'style') {
      for (const child of childrenOf(node)) {
        const loc = child.sourceCodeLocation;
        if (child.nodeName !== '#text' || !loc || !('value' in child)) continue;
        const next = rewriteCssUrls(child.value, baseDir, resolve);
        if (next !== child.value) {
          edits.push({ start: loc.startOffset, end: loc.endOffset, text: next });
        }
      }
      return;
    }
    for (const child of childrenOf(node)) visit(child);
  };

  visit(doc);
  return edits;
}
