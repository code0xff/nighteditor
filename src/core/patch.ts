import { encode } from './entities.js';
import type { Block, Patch } from './types.js';

/** 거부 사유. `core/` 는 화면 언어를 모르므로 문장이 아니라 코드를 넘긴다 (INV-6) */
export type PatchErrorCode = 'unknownId' | 'locked' | 'stale' | 'duplicate';

/**
 * 패치 거부. `message` 는 개발자용 진단이고, 사용자에게 보이는 문장은
 * `code` + `params` 를 언어팩(`lib/messages.ts`)이 옮긴 결과다.
 */
export class PatchError extends Error {
  constructor(
    readonly code: PatchErrorCode,
    readonly params: Record<string, string | number>,
    message: string
  ) {
    super(message);
  }
}

/**
 * 원본 문자열에 패치를 적용한다.
 *
 * 이 함수는 순수하다. `source` 는 수정되지 않으며(INV-1), 결과는 언제나
 * 원본 + 패치로 새로 만들어진다. 편집하지 않은 블록의 바이트는 그대로 남는다.
 */
export function applyPatches(source: string, blocks: readonly Block[], patches: readonly Patch[]) {
  const byId = new Map(blocks.map((b) => [b.id, b]));

  const targets = patches.map((patch) => {
    const block = byId.get(patch.id);
    if (!block) {
      throw new PatchError('unknownId', { id: patch.id }, `unknown block id: ${patch.id}`);
    }
    // INV-5 · 잠긴 블록은 패치 목록에 들어갈 수 없다.
    // UI 차단만으로는 부족해서 여기서 한 번 더 막는다.
    if (block.locked !== null) {
      throw new PatchError(
        'locked',
        { id: block.id, reason: block.locked },
        `locked block: id=${block.id} (${block.locked})`
      );
    }
    // 블록 정보가 이 원본에서 나온 게 맞는지 확인한다.
    // 저장 후 갱신하지 않은 blocks 를 재사용하면 offset 이 밀린 채로
    // 조용히 문서를 망가뜨린다. 시끄럽게 실패하는 편이 낫다.
    if (source.slice(block.innerStart, block.innerEnd) !== block.sourceInner) {
      throw new PatchError('stale', { id: block.id }, `stale block: id=${block.id}`);
    }
    // RCDATA 는 내부에 태그를 넣을 수 없다. 평문으로 보고 엔티티화한다 (spec §2.1, INV-8).
    const value = block.rcdata ? encode(patch.newInnerHtml) : patch.newInnerHtml;
    return { block, value };
  });

  const seen = new Set<number>();
  for (const { block } of targets) {
    if (seen.has(block.id)) {
      throw new PatchError('duplicate', { id: block.id }, `duplicate patch: id=${block.id}`);
    }
    seen.add(block.id);
  }

  // INV-4 · 반드시 내림차순으로 적용한다. 앞에서부터 자르면 뒤쪽 offset 이 전부 밀린다.
  // 호출자의 정렬을 신뢰하지 않고 여기서 강제한다.
  const ordered = [...targets].sort((a, b) => b.block.innerStart - a.block.innerStart);

  let out = source;
  for (const { block, value } of ordered) {
    out = out.slice(0, block.innerStart) + value + out.slice(block.innerEnd);
  }
  return out;
}
