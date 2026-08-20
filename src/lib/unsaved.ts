/**
 * 저장하지 않은 편집을 지키는 장치.
 *
 * 이 도구의 편집 결과는 저장하기 전까지 메모리에만 있다. 탭을 닫거나 새 파일을 열면
 * 되돌릴 방법이 없으므로, 사라지기 전에 반드시 물어본다.
 */

/**
 * 저장하지 않은 변경이 있을 때 탭 닫기·새로고침을 브라우저에 되묻게 한다.
 *
 * 문구는 브라우저가 정한 것으로 뜬다 — 페이지가 넣은 문장은 무시된 지 오래다.
 *
 * @param hasChanges 지금 저장하지 않은 변경이 있는지. 이벤트가 날 때마다 새로 묻는다
 * @returns 리스너를 떼는 함수
 */
export function onBeforeUnload(hasChanges: () => boolean): () => void {
  const onUnload = (e: BeforeUnloadEvent) => {
    if (!hasChanges()) return;
    // 두 가지를 다 해야 한다. 브라우저마다 보는 것이 다르다.
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', onUnload);
  return () => window.removeEventListener('beforeunload', onUnload);
}
