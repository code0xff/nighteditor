import { useEffect, useRef } from 'react';
import { useEditor } from '@/store/editor';
import { useI18n } from '@/store/locale';
import { FORMAT_LABELS } from '@/lib/messages';
import type { FromPreview, ToPreview } from '@/preview/protocol';

/**
 * 아티팩트를 렌더하고 프리뷰 에이전트와 postMessage 로만 대화한다 (rules §4).
 *
 * `sandbox` 에 allow-same-origin 과 allow-scripts 를 함께 준다. 샌드박스로서는
 * 무력한 조합이지만 대상이 사용자 자신의 로컬 파일이고 서버가 없으므로 감수한다 (ADR-006).
 */
export function PreviewFrame() {
  const frame = useRef<HTMLIFrameElement>(null);
  const { t } = useI18n();
  const previewDoc = useEditor((s) => s.previewDoc);
  const blocks = useEditor((s) => s.blocks);
  const scanned = useEditor((s) => s.scanned);
  const onReady = useEditor((s) => s.onReady);
  const onEdit = useEditor((s) => s.onEdit);
  const onBlocked = useEditor((s) => s.onBlocked);
  const select = useEditor((s) => s.select);
  const save = useEditor((s) => s.save);
  const downloadCopy = useEditor((s) => s.downloadCopy);
  const undoLast = useEditor((s) => s.undoLast);
  const revertQueue = useEditor((s) => s.revertQueue);
  const drainReverts = useEditor((s) => s.drainReverts);
  const revealId = useEditor((s) => s.revealId);
  const drainReveal = useEditor((s) => s.drainReveal);

  useEffect(() => {
    const handle = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const msg = e.data as FromPreview;
      if (msg.type === 'ready') onReady(msg.blocks);
      else if (msg.type === 'edit') onEdit(msg.id, msg.html, msg.pristine);
      else if (msg.type === 'blocked') onBlocked(msg.id);
      else if (msg.type === 'select') select(msg.id);
      // 프리뷰 안에서 누른 Ctrl+S. 호스트 창은 그 키를 보지 못한다 (spec §4).
      else if (msg.type === 'save') void save();
      else if (msg.type === 'downloadCopy') downloadCopy();
      else if (msg.type === 'undo') undoLast();
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [onReady, onEdit, onBlocked, select, save, downloadCopy, undoLast]);

  // 서식 막대에 붙일 문구를 건넨다. 에이전트는 언어팩을 불러올 수 없다 (ADR-007).
  // 언어를 바꾸면 다시 보내 이미 떠 있는 막대까지 함께 바뀌게 한다.
  //
  // 문서가 갈린 직후의 전송은 새 iframe 이 아직 에이전트를 실행하기 전이라 사라질 수
  // 있다. 그래서 에이전트가 ready 를 보내 대조가 끝난 뒤(scanned)에도 다시 보낸다 —
  // 그 뒤라야 리스너가 확실히 걸려 있다 (spec §4.1).
  useEffect(() => {
    const labels: Record<string, string> = {};
    for (const key of FORMAT_LABELS) labels[key] = t(key);
    const msg: ToPreview = { type: 'labels', labels };
    frame.current?.contentWindow?.postMessage(msg, '*');
  }, [t, previewDoc, scanned]);

  // 대조가 끝나 잠금이 확정되면 프리뷰에 알린다. UI 차단만으로는 부족하다 (INV-5).
  useEffect(() => {
    if (!scanned) return;
    const ids = blocks.filter((b) => b.locked !== null).map((b) => b.id);
    const msg: ToPreview = { type: 'locked', ids };
    frame.current?.contentWindow?.postMessage(msg, '*');
  }, [scanned, blocks]);

  // 되돌리기는 프리뷰에도 반영해야 한다. 패치만 지우면 화면에는 고친 내용이 남는다.
  useEffect(() => {
    if (revertQueue.length === 0) return;
    for (const item of revertQueue) {
      const msg: ToPreview = { type: 'revert', id: item.id, html: item.html };
      frame.current?.contentWindow?.postMessage(msg, '*');
    }
    drainReverts();
  }, [revertQueue, drainReverts]);

  // 변경 목록에서 고른 블록을 화면에 보여준다. 어디를 고쳤는지 목록만으로는 알기 어렵다.
  useEffect(() => {
    if (revealId === null) return;
    const msg: ToPreview = { type: 'reveal', id: revealId };
    frame.current?.contentWindow?.postMessage(msg, '*');
    drainReveal();
  }, [revealId, drainReveal]);

  if (!previewDoc) return null;

  return (
    <iframe
      ref={frame}
      title={t('preview.title')}
      className="h-full w-full border-0 bg-white"
      sandbox="allow-scripts allow-same-origin"
      srcDoc={previewDoc}
    />
  );
}
