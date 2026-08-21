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
import { encodeAttribute } from './entities.js';

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
  /**
   * 경로 뒤에 붙어 있던 질의·조각 (`?v=3`, `#icon`).
   *
   * 파일을 찾을 때는 떼어낸다. 붙일 때 다시 다는 것은 **조각뿐**이다 —
   * `<use href="sprite.svg#icon">` 에서 `#icon` 을 잃으면 스프라이트에서 무엇을
   * 꺼낼지가 사라져 아무것도 그리지 않는다. 질의까지 달면 반대로 전부 잃는다
   * (`blobSuffix` 참조).
   */
  suffix: string;
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
export function splitSuffix(url: string): { path: string; suffix: string } {
  const at = url.search(/[?#]/);
  return at < 0 ? { path: url, suffix: '' } : { path: url.slice(0, at), suffix: url.slice(at) };
}

export function resolvePath(baseDir: string, url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  // `scheme:` 과 프로토콜 상대 URL. 윈도 경로(`C:\`)도 여기서 걸린다.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) return null;

  const { path: clean } = splitSuffix(trimmed);
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
        for (const attr of node.attrs) {
          // parse5 는 `xlink:href` 를 `{ name: 'href', prefix: 'xlink' }` 로 쪼개 두고
          // 위치만 `xlink:href` 키로 남긴다. 이름만 보면 xlink 참조를 놓치거나,
          // 둘 다 있는 문서에서 엉뚱한 쪽 값을 집는다.
          const key = attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name;
          const loc = attrs[key];
          if (!names.includes(key) || !loc) continue;

          const path = resolvePath(baseDir, attr.value);
          const span = path === null ? null : valueSpan(source, loc);
          if (path !== null && span) {
            const { suffix } = splitSuffix(attr.value.trim());
            refs.push({
              url: attr.value,
              path,
              suffix,
              valueStart: span.start,
              valueEnd: span.end,
            });
          }
        }
      }
    }
    for (const child of childrenOf(node)) visit(child);
  };

  visit(doc);
  return refs;
}

/**
 * 붙일 URL 에 다시 달 수 있는 것은 **조각뿐**이다.
 *
 * 조각(`#icon`)은 지켜야 한다 — 잃으면 스프라이트에서 무엇을 꺼낼지가 사라진다.
 * 질의(`?v=3`)는 버려야 한다 — blob URL 은 질의가 붙는 순간 만들어 둔 객체와
 * 다른 이름이 되어 브라우저가 아예 열지 못한다. 캐시 무력화는 blob 에는 의미도 없다.
 */
function blobSuffix(suffix: string): string {
  const hash = suffix.indexOf('#');
  return hash < 0 ? '' : suffix.slice(hash);
}

/** 붙일 자원이 있는 참조만 치환 목록으로 만든다 */
export function assetEdits(refs: readonly AssetRef[], resolve: Resolve): Edit[] {
  const edits: Edit[] = [];
  for (const ref of refs) {
    const url = resolve(ref.path);
    // 조각만 다시 붙인다. 없으면 스프라이트에서 무엇을 꺼낼지가 사라진다.
    // 조각은 디코딩된 값이라 되적기 전에 인코딩한다 (INV-8) — 엔티티로 적힌 따옴표가
    // 풀린 채 들어가면 속성이 조기 종료되어, 조각의 나머지가 프리뷰에서 새 속성
    // (onerror= 등)으로 승격된다.
    if (url) {
      edits.push({
        start: ref.valueStart,
        end: ref.valueEnd,
        text: url + encodeAttribute(blobSuffix(ref.suffix)),
      });
    }
  }
  return edits;
}

/** 따옴표 문자열의 끝 (닫는 따옴표 다음). 이스케이프를 건너뛴다 */
function endOfString(css: string, at: number): number {
  const quote = css[at];
  let i = at + 1;
  while (i < css.length) {
    if (css[i] === '\\') {
      i += 2;
      continue;
    }
    if (css[i] === quote) return i + 1;
    i++;
  }
  return css.length;
}

/** `url(` 다음부터 닫는 괄호까지를 뜯는다. 값 자체가 따옴표에 싸여 있을 수 있다 */
function readUrl(css: string, at: number): { raw: string; quote: string; end: number } | null {
  let i = at;
  while (i < css.length && /\s/.test(css[i] ?? '')) i++;

  const quote = css[i] === '"' || css[i] === "'" ? (css[i] as string) : '';
  if (quote) {
    const close = endOfString(css, i);
    const raw = css.slice(i + 1, close - 1);
    let j = close;
    while (j < css.length && /\s/.test(css[j] ?? '')) j++;
    return css[j] === ')' ? { raw, quote, end: j + 1 } : null;
  }

  const close = css.indexOf(')', i);
  if (close < 0) return null;
  return { raw: css.slice(i, close).trim(), quote: '', end: close + 1 };
}

/**
 * CSS 안의 `url(...)` 을 바꾼다.
 *
 * blob URL 에는 디렉터리가 없다. 스타일시트만 붙이고 이걸 안 바꾸면 그 안의 글꼴이
 * 기준을 잃어 전부 깨진다. `@import` 는 건드리지 않는다 (spec §5.1).
 *
 * 문자열과 주석은 통째로 건너뛴다. `content: "url(icon.png)"` 는 자원을 가리키는
 * 함수가 아니라 **화면에 찍히는 글자**다. 이걸 바꾸면 없던 글자가 생긴다.
 */
export function rewriteCssUrls(css: string, baseDir: string, resolve: Resolve): string {
  let out = '';
  let i = 0;

  while (i < css.length) {
    const ch = css[i] ?? '';

    if (ch === '"' || ch === "'") {
      const end = endOfString(css, i);
      out += css.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      const end = close < 0 ? css.length : close + 2;
      out += css.slice(i, end);
      i = end;
      continue;
    }
    // 토큰 경계 뒤의 url( 만 함수다. 식별자 한가운데서도 바꾸면 `--icon: myurl(x)`
    // 같은 남의 함수 이름이 잘려 `myurl(blob:...)` 이 된다 — 자원이 아닌 값을 바꾸는 셈이다.
    if (
      css.slice(i, i + 4).toLowerCase() === 'url(' &&
      !/[-\w\u0080-\uffff]/.test(css[i - 1] ?? '')
    ) {
      const token = readUrl(css, i + 4);
      const path = token ? resolvePath(baseDir, token.raw) : null;
      const url = path === null ? undefined : resolve(path);
      if (token && url) {
        const { suffix } = splitSuffix(token.raw.trim());
        out += `url(${token.quote}${url}${blobSuffix(suffix)}${token.quote})`;
        i = token.end;
        continue;
      }
    }

    out += ch;
    i++;
  }

  return out;
}

/** CSS 가 가리키는 자원 경로만 모은다 — 무엇을 못 붙였는지 세기 위한 것이다 */
export function cssAssetPaths(css: string, baseDir: string): string[] {
  const paths: string[] = [];
  rewriteCssUrls(css, baseDir, (path) => {
    paths.push(path);
    return undefined;
  });
  return paths;
}

/** 문서에 박혀 있는 `<style>` 들의 본문. 무엇을 부르는지 세려면 텍스트가 필요하다 */
export function styleTexts(source: string): string[] {
  const doc = parse(source, { sourceCodeLocationInfo: true });
  const texts: string[] = [];

  const visit = (node: Node): void => {
    if (isElement(node) && node.tagName === 'style') {
      for (const child of childrenOf(node)) {
        if (child.nodeName === '#text' && 'value' in child) texts.push(child.value);
      }
      return;
    }
    for (const child of childrenOf(node)) visit(child);
  };

  visit(doc);
  return texts;
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
