/**
 * 호스트 창의 키 단축키. 프리뷰(iframe) 안의 키는 여기 닿지 않으므로
 * 에이전트가 따로 가로채 메시지로 넘긴다 (ADR-007, spec §4).
 */

/** 눌린 키가 저장 단축키인가 — Ctrl+S / ⌘S. Shift·Alt 조합은 다른 명령 자리다 */
function isSaveCombo(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 's' || e.key === 'S');
}

/**
 * Ctrl+S 를 잡는다. 브라우저의 "페이지 저장" 대화상자를 막고 핸들러를 부른다.
 *
 * @returns 리스너를 떼는 함수
 */
export function onSaveShortcut(handler: () => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!isSaveCombo(e)) return;
    e.preventDefault();
    handler();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
