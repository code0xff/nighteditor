/** 블록이 편집 불가인 이유. null 이면 편집 가능. (docs/spec.md §3) */
export type LockReason =
  'RAW_TEXT' | 'SCRIPT_GENERATED' | 'EMPTY_IN_SOURCE' | 'CODE_BLOCK' | 'AMBIGUOUS' | 'MARKER_CLASH';

/**
 * 편집 단위. offset 은 모두 **원본 문자열** 기준이다 (INV-3).
 * innerStart..innerEnd 는 여는 태그 뒤부터 닫는 태그 앞까지.
 */
export interface Block {
  id: number;
  tag: string;
  innerStart: number;
  innerEnd: number;
  /** 원본 innerHTML 원형 (엔티티 포함) */
  sourceInner: string;
  /** 태그를 제거하고 엔티티를 디코딩한 텍스트. 대조 검사용 (INV-8) */
  sourceText: string;
  /** RCDATA 라 내부에 태그를 넣을 수 없음 — 평문 전용 (spec §2.1) */
  rcdata: boolean;
  locked: LockReason | null;
}

/** 사용자가 편집한 결과. 저장 시 해당 블록의 inner 범위를 이 값으로 교체한다. */
export interface Patch {
  id: number;
  newInnerHtml: string;
}
