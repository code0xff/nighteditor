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
import { applyEdits, type Edit } from './edits.js';
import { encodeAttribute, encodeAttributeSerialized, requoteAttribute } from './entities.js';

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

/** 바깥으로 나가는 참조인가 — `scheme:` 과 프로토콜 상대 URL. 윈도 경로(`C:\`)도 걸린다 */
function isExternal(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//');
}

/** 풀 수 있으면 푼다. 잘못된 인코딩은 적힌 그대로 둔다 */
function decodePart(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/**
 * 조각 하나의 퍼센트 인코딩을 푼다.
 *
 * `%2F` 만은 풀지 않고 적힌 그대로 둔다 (spec §5.1) — 디스크의 파일 이름에는
 * 슬래시가 있을 수 없으므로, 푸는 순간 이름의 일부가 경로 구분자로 변해
 * `a%2Fb.png` 라는 실제 파일 대신 `a/b.png` 라는 없는 자리를 찾는다.
 * 표기(대소문자)도 그대로 남긴다 — 묶음의 키는 디스크의 이름이다.
 */
function decodeSegment(segment: string): string {
  return segment
    .split(/(%2F)/i)
    .map((part) => (/^%2F$/i.test(part) ? part : decodePart(part)))
    .join('');
}

/** `.`·`..` 을 접고 퍼센트 인코딩을 푼 정규 경로. 뿌리는 빈 문자열이다 */
function collapse(baseDir: string, path: string): string {
  // 절대 경로는 문서가 아니라 묶음의 뿌리를 기준으로 본다 — 폴더/zip 의 최상단이다.
  const fromRoot = path.startsWith('/');
  const joined = fromRoot ? path.slice(1) : `${baseDir ? `${baseDir}/` : ''}${path}`;

  const out: string[] = [];
  for (const raw of joined.split('/')) {
    // 접기 **전에** 푼다 (spec §5.1). URL 사양은 %2e/%2e%2e 조각도 점 조각으로
    // 접는다 — 접은 뒤에 풀면 `%2e%2e/logo.png` 가 한 단계 올라가지 못해,
    // 브라우저는 찾는 파일을 우리만 없다고 센다. 파일 이름의 %20 이 실제 공백이
    // 되는 것도 같은 자리다. 묶음의 키는 문서의 표기가 아니라 디스크의 이름이다.
    const segment = decodeSegment(raw);
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }

  return out.join('/');
}

export function resolvePath(baseDir: string, url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  if (isExternal(trimmed)) return null;

  const { path: clean } = splitSuffix(trimmed);
  if (!clean) return null;

  const path = collapse(baseDir, clean);
  return path === '' ? null : path;
}

/**
 * `<base href>` 가 정한 실효 기준 디렉터리 (spec §5.1).
 *
 * 문서가 기준을 옮겨 두면 브라우저는 상대 참조를 거기서 푼다. 문서 자리만 보고
 * 찾으면 실제로 옆에 있는 파일을 없다고 세고, 프리뷰도 붙일 것을 안 붙인다.
 * href 가 있는 **첫** `<base>` 하나만 유효하다 — HTML 사양과 같다.
 *
 * @returns 묶음 안 기준 디렉터리 (뿌리는 빈 문자열). base 가 바깥(절대 URL)을
 *   가리키면 null — 그 문서의 상대 참조는 로컬 파일이 아니다.
 */
export function documentBaseDir(source: string, docDir: string): string | null {
  const doc = parse(source);
  let href: string | undefined;

  const visit = (node: Node): void => {
    if (href !== undefined) return;
    if (isElement(node) && node.tagName === 'base') {
      href = node.attrs.find((a) => !a.prefix && a.name === 'href')?.value;
      if (href !== undefined) return;
    }
    for (const child of childrenOf(node)) visit(child);
  };
  visit(doc);

  const trimmed = href?.trim();
  if (!trimmed) return docDir;
  if (isExternal(trimmed)) return null;

  const { path } = splitSuffix(trimmed);
  // 질의·조각만 있는 base(`?v=2`·`#top`)는 자리를 옮기지 않는다 — URL 해석에서
  // 문서 제 주소에 질의만 갈아 끼운 것이라 기준 디렉터리는 문서 자리 그대로다.
  if (!path) return docDir;
  // base 는 디렉터리가 아니라 URL 이다. `/` 로 끝나거나 마지막 조각이 `.`·`..`
  // (인코딩 포함)이면 그 자체가 자리 표시라 통째로 접는다 — 풀기 전에 떼면
  // `..`·`foo/..` 의 마지막 조각이 접히는 대신 잘려 나가, deck/sub 의 `..` 가
  // deck 이 아니라 deck/sub 로 남는다 (spec §5.1).
  const segments = path.split('/');
  const last = decodeSegment(segments[segments.length - 1] ?? '');
  if (path.endsWith('/') || last === '.' || last === '..') return collapse(docDir, path);
  // 마지막 조각은 파일 이름이다 — **인코딩된 조각째로** 떼어낸다. 조각 안의 %2F 는
  // 구분자가 아니라 이름의 일부라, 푼 뒤에 떼면 이름 속 슬래시에서 잘린다.
  const dir = segments.slice(0, -1).join('/');
  if (dir) return collapse(docDir, `${dir}/`);
  // 조각 하나짜리 base — 이름만 갈렸다. 절대면 뿌리, 아니면 문서 자리다.
  return path.startsWith('/') ? '' : docDir;
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

/**
 * 참조 하나가 프리뷰에서 갖는 표기. 붙일 자원이 없으면 null — 그 자리는 그대로 둔다.
 *
 * 조각만 다시 붙인다. 없으면 스프라이트에서 무엇을 꺼낼지가 사라진다.
 * 조각은 디코딩된 값이라 되적기 전에 인코딩한다 (INV-8) — 엔티티로 적힌 따옴표가
 * 풀린 채 들어가면 속성이 조기 종료되어, 조각의 나머지가 프리뷰에서 새 속성
 * (onerror= 등)으로 승격된다.
 *
 * 나가는 치환(assetEdits)과 되돌림 짝(assetSwaps)이 **여기 하나**를 쓴다 (ADR-011) —
 * 두 자리에서 따로 계산하면 반드시 어긋나는 짝이 생긴다.
 */
function previewValue(ref: AssetRef, resolve: Resolve): { url: string; text: string } | null {
  const url = resolve(ref.path);
  return url ? { url, text: url + encodeAttribute(blobSuffix(ref.suffix)) } : null;
}

/** 붙일 자원이 있는 참조만 치환 목록으로 만든다 */
export function assetEdits(refs: readonly AssetRef[], resolve: Resolve): Edit[] {
  const edits: Edit[] = [];
  for (const ref of refs) {
    const value = previewValue(ref, resolve);
    if (value) edits.push({ start: ref.valueStart, end: ref.valueEnd, text: value.text });
  }
  return edits;
}

/**
 * 프리뷰 치환 하나의 짝 — 나갈 때 `from`→`to`, 돌아올 때 `to`→`from` (ADR-011).
 * offset 은 전부 원본 문자열 기준이다 (INV-3).
 */
export interface AssetSwap {
  start: number;
  end: number;
  /** 원본에 적힌 그대로의 표기 (엔티티 포함) — 되돌릴 때 이 바이트로 돌아간다 */
  from: string;
  /** 프리뷰 문서에 들어가는 표기 */
  to: string;
  /**
   * 브라우저가 innerHTML 로 직렬화했을 때의 표기 짝. 원문 쪽(`serializedFrom`)까지
   * `from`/`to` 와 같으면 생략한다.
   *
   * 내보낸 보수적 인코딩(`&#32;` 등)은 브라우저를 한 바퀴 돌면 최소 인코딩으로
   * 갈아 끼워져 돌아온다 — 내보낸 표기만 들고 있으면 그 편집에서 blob 이 샌다.
   */
  serializedTo?: string;
  /**
   * 직렬화 문맥으로 되돌릴 원문 표기 — `from` 에서 `"` 만 `&quot;` 로 잠근 것.
   * 디코딩된 값을 재인코딩하면 원문의 엔티티 표기가 갈려 손대지 않은 속성의
   * diff 가 생긴다 (대원칙 2).
   */
  serializedFrom?: string;
}

/**
 * 문서 전체의 치환 짝 목록 — 속성 값과 `<style>` 본문 (spec §5.1 · ADR-011).
 *
 * 프리뷰 문서 조립도, 블록 단위의 양방향 경계(assetBoundary)도 이 목록 하나에서
 * 나온다. 붙일 자원이 없는 참조는 목록에 들지 않아 어느 방향으로도 건드리지 않는다.
 */
export function assetSwaps(
  source: string,
  refs: readonly AssetRef[],
  baseDir: string,
  resolve: Resolve
): AssetSwap[] {
  const swaps: AssetSwap[] = [];
  for (const ref of refs) {
    const value = previewValue(ref, resolve);
    if (value === null) continue;
    // 되돌릴 값은 디코딩·재인코딩한 값이 아니라 **원본의 그 자리 슬라이스**다 —
    // 치환했다 되돌린 결과가 바이트 단위로 같아야 한다 (대원칙 1·2).
    const from = source.slice(ref.valueStart, ref.valueEnd);
    const serializedTo = value.url + encodeAttributeSerialized(blobSuffix(ref.suffix));
    // 직렬화 짝의 원문 쪽도 같은 원칙이다 — 디코딩된 값(ref.url)을 재인코딩하면
    // 표준이 아닌 원문 엔티티(`&#32;` 등)가 최소 표기로 갈려, 그 블록을 고치는
    // 순간 손대지 않은 속성의 표기가 바뀐다 (대원칙 2). 원본 슬라이스를 그대로
    // 쓰되, 직렬화 문맥(큰따옴표)에서 값을 조기 종료시키는 `"` 만 바꾼다.
    const serializedFrom = requoteAttribute(from);
    const swap: AssetSwap = { start: ref.valueStart, end: ref.valueEnd, from, to: value.text };
    if (serializedTo !== value.text || serializedFrom !== from) {
      swap.serializedTo = serializedTo;
      swap.serializedFrom = serializedFrom;
    }
    swaps.push(swap);
  }
  // <style> 본문은 rawtext 라 직렬화가 표기를 바꾸지 않는다 — 짝이 하나로 충분하다.
  for (const edit of styleEdits(source, baseDir, resolve)) {
    swaps.push({
      start: edit.start,
      end: edit.end,
      from: source.slice(edit.start, edit.end),
      to: edit.text,
    });
  }
  return swaps;
}

/**
 * 프리뷰와 저장 사이의 양방향 경계 (ADR-011).
 *
 * 마커는 블록이 겹치지 않아 블록 안으로 들어올 일이 없지만, 자원 치환은 블록
 * **안**에서도 일어난다. 나가는 조각은 치환하고, 돌아온 편집은 원문 표기로 되돌린다.
 */
export interface AssetBoundary {
  /**
   * 원본 조각(블록 `sourceInner` 등)을 프리뷰용으로 — 조각 범위 안의 참조를
   * 프리뷰 표기로 치환한다. @param textStart 조각이 원본에서 시작하는 offset (INV-3)
   */
  toPreview(text: string, textStart: number): string;
  /** 프리뷰에서 돌아온 HTML 을 저장용으로 — 프리뷰 표기를 원문 표기로 되돌린다 */
  fromPreview(html: string): string;
}

export function assetBoundary(swaps: readonly AssetSwap[]): AssetBoundary {
  // 되돌림 표. 같은 프리뷰 표기에 원문 표기가 여럿이면(`logo.png` 와 `./logo.png`)
  // 먼저 나온 표기로 되돌린다 — 어느 쪽이든 같은 파일을 가리킨다.
  const back = new Map<string, string>();
  for (const swap of swaps) {
    // 직렬화 짝이 먼저다 — fromPreview 가 받는 것은 브라우저가 직렬화한 HTML 이라,
    // 두 표기가 같으면(to === serializedTo) 그 문맥에 맞는 쪽(serializedFrom,
    // `"` 가 &quot; 로 잠긴 원본 슬라이스)으로 되돌려야 속성이 조기 종료되지 않는다.
    if (swap.serializedTo !== undefined && swap.serializedFrom !== undefined) {
      if (!back.has(swap.serializedTo)) back.set(swap.serializedTo, swap.serializedFrom);
    }
    if (!back.has(swap.to)) back.set(swap.to, swap.from);
  }
  // 긴 표기부터 되돌린다 — 조각 없는 표기(`blob:u`)는 조각 있는 표기(`blob:u#icon`)의
  // 접두사라, 짧은 쪽을 먼저 바꾸면 긴 쪽이 영영 안 잡혀 조각이 blob 이름에 남는다.
  const pairs = [...back].sort((a, b) => b[0].length - a[0].length);

  return {
    toPreview(text, textStart) {
      const inside: Edit[] = [];
      for (const swap of swaps) {
        if (swap.start < textStart || swap.end > textStart + text.length) continue;
        // 자리의 내용까지 원문 표기와 맞아야 한다 — 다르면 이 조각은 원본의 그
        // 자리가 아니므로 추측으로 바꾸지 않는다 (대원칙 3).
        if (text.slice(swap.start - textStart, swap.end - textStart) !== swap.from) continue;
        inside.push({ start: swap.start - textStart, end: swap.end - textStart, text: swap.to });
      }
      return applyEdits(text, inside);
    },
    fromPreview(html) {
      let out = html;
      // blob URL 은 탭마다 새로 만든 무작위 이름이라 문서에 원래 있던 텍스트와
      // 충돌하지 않는다 — 통째 문자열 치환으로 충분하다.
      for (const [to, from] of pairs) if (to !== from) out = out.split(to).join(from);
      return out;
    },
  };
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
