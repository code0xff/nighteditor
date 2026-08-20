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
  /** Ctrl+Z · ⌘Z — 마지막으로 확정한 변경 되돌리기 */
  undo: () => void;
}

/**
 * 입력 칸 안에서는 단축키를 가로채지 않는다.
 * 제목을 고치다 누른 Ctrl+Z 는 그 칸의 undo 여야 한다 — 남의 블록을 되돌리면 안 된다.
 */
function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/**
 * 저장·사본 내려받기 단축키를 잡는다. 브라우저의 "페이지 저장" 대화상자는 막는다.
 *
 * @returns 리스너를 떼는 함수
 */
export function onEditorShortcuts({ save, downloadCopy, undo }: EditorShortcuts): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;

    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      if (e.shiftKey) downloadCopy();
      else save();
      return;
    }

    // 되돌리기는 입력 칸을 비껴간다. 저장은 어디서 눌러도 저장이라 비껴가지 않는다.
    if ((e.key === 'z' || e.key === 'Z') && !e.shiftKey && !inTextField(e.target)) {
      e.preventDefault();
      undo();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
