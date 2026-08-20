import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import type { Block, LockReason } from './types.js';
import { normalizeText } from './entities.js';
import { hasCodeBlockClass, isInline, RAW_TEXT_TAGS, RCDATA_TAGS } from './blocks.js';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}

function childrenOf(node: Node): Node[] {
  return 'childNodes' in node ? (node as ParentNode).childNodes : [];
}

function attr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

/** 자기 자신이 직접 가진 텍스트 — 인라인 자손 것은 세지 않는다 */
function hasDirectText(node: Node): boolean {
  return childrenOf(node).some(
    (c) => c.nodeName === '#text' && 'value' in c && c.value.trim().length > 0
  );
}

/**
 * 하위 텍스트를 모은 결과. RAW_TEXT 내부는 텍스트로 치지 않는다.
 *
 * parse5 는 `#text` 노드의 문자 참조를 **이미 디코딩해서** 넘겨준다.
 * 여기서 또 디코딩하면 `&amp;amp;` 가 `&` 까지 풀려 라이브 textContent 와
 * 어긋나고, ADR-005 대조 검사에서 멀쩡한 블록이 오탐 잠금된다.
 */
function textOf(node: Node): string {
  if (node.nodeName === '#text') {
    return 'value' in node ? node.value : '';
  }
  if (isElement(node) && RAW_TEXT_TAGS.has(node.tagName)) return '';
  return childrenOf(node).map(textOf).join('');
}

function ownLockReason(el: Element): LockReason | null {
  return hasCodeBlockClass(attr(el, 'class')) ? 'CODE_BLOCK' : null;
}

/**
 * 원본 HTML 문자열에서 편집 블록을 추출한다.
 *
 * 반환되는 offset 은 전부 `source` 기준이며, `source.slice(innerStart, innerEnd)` 가
 * 언제나 그 블록의 원본 innerHTML 과 정확히 일치한다 (INV-3).
 *
 * 알려진 한계 — 직접 텍스트와 블록 자식이 함께 있는 요소(`<div>글<p>단락</p></div>`)에서
 * 그 직접 텍스트는 편집 대상이 되지 않는다. 부모는 블록 자식 때문에 블록이 될 수 없고,
 * 텍스트만 따로 떼어낼 경계도 없기 때문이다.
 */
export function parseBlocks(source: string): Block[] {
  const doc = parse(source, { sourceCodeLocationInfo: true });
  const blocks: Block[] = [];
  let nextId = 0;

  const visit = (node: Node, inheritedLock: LockReason | null): void => {
    if (isElement(node) && RAW_TEXT_TAGS.has(node.tagName)) return;

    const elementChildren = childrenOf(node).filter(isElement);
    // 잠금은 자손에게 상속된다. .code 안의 중첩 요소가 편집 가능해지면 안 된다.
    const lock = isElement(node) ? (inheritedLock ?? ownLockReason(node)) : inheritedLock;

    if (isElement(node)) {
      const loc = node.sourceCodeLocation;
      const startTag = loc?.startTag;
      const hasBlockChild = elementChildren.some((c) => !isInline(c.tagName));

      // INV-7 · parse5 는 소스에 없는 노드를 삽입한다 (테이블의 <tbody> 등).
      // 위치 정보가 없으면 블록이 될 수 없다. 통과시켜 자식으로 내려간다.
      if (startTag && !hasBlockChild && textOf(node).trim().length > 0) {
        const endTag = loc?.endTag;
        const innerStart = startTag.endOffset;
        // 닫는 태그가 생략되면(`<li>a<li>b`) inner 범위를 확정할 수 없다.
        // 조용히 버리지 않고 AMBIGUOUS 로 잠가 이유를 남긴다 (대원칙 3).
        const innerEnd = endTag ? endTag.startOffset : (loc?.endOffset ?? innerStart);
        blocks.push({
          id: nextId++,
          tag: node.tagName,
          innerStart,
          innerEnd,
          sourceInner: source.slice(innerStart, innerEnd),
          sourceText: normalizeText(textOf(node)),
          rcdata: RCDATA_TAGS.has(node.tagName),
          locked: endTag ? lock : 'AMBIGUOUS',
        });
        return;
      }
    }

    // 인라인 자식으로 내려갈지 판단한다 (spec §2).
    //
    // 부모가 직접 텍스트를 가지면 인라인은 그 문장의 일부다. 승격시키면
    // 한 문장이 쪼개지므로 내려가지 않는다.
    // 부모에 직접 텍스트가 없으면 인라인은 독립 라벨이다
    // (`<div><span class="codelabel">제목</span><ul>…</ul></div>`).
    // 이때 내려가지 않으면 멀쩡히 보이는 텍스트가 편집 불가가 된다.
    const descendIntoInline = !hasDirectText(node);
    for (const child of elementChildren) {
      if (!isInline(child.tagName) || descendIntoInline) visit(child, lock);
    }
  };

  visit(doc, null);
  return blocks;
}
