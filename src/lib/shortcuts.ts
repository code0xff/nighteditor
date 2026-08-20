/**
 * 호스트 창의 키 단축키. 프리뷰(iframe) 안의 키는 여기 닿지 않으므로
 * 에이전트가 따로 가로채 메시지로 넘긴다 (ADR-007, spec §4).
 *
 * 조합 판정은 이 파일과 에이전트 두 곳에 있다. 에이전트는 문자열화돼 주입되므로
 * 코드를 공유할 수 없다 — 그래서 조합을 바꿀 땐 두 곳을 같이 고친다.
 */

export interface EditorShortcuts {
  /** Ctrl+S · ⌘S */
  save: () => void;
  /** Ctrl+Shift+S · ⌘⇧S */
  downloadCopy: () => void;
}

/**
 * 저장·사본 내려받기 단축키를 잡는다. 브라우저의 "페이지 저장" 대화상자는 막는다.
 *
 * @returns 리스너를 떼는 함수
 */
export function onEditorShortcuts({ save, downloadCopy }: EditorShortcuts): () => void {
  const onKey = (e: KeyboardEvent) => {
    const sKey = e.key === 's' || e.key === 'S';
    if (!sKey || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    e.preventDefault();
    if (e.shiftKey) downloadCopy();
    else save();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
