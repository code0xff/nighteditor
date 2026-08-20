import { useEffect, useRef } from 'react';
import { useEditor } from '@/store/editor';
import type { FromPreview, ToPreview } from '@/preview/protocol';

/**
 * 아티팩트를 렌더하고 프리뷰 에이전트와 postMessage 로만 대화한다 (rules §4).
 *
 * `sandbox` 에 allow-same-origin 과 allow-scripts 를 함께 준다. 샌드박스로서는
 * 무력한 조합이지만 대상이 사용자 자신의 로컬 파일이고 서버가 없으므로 감수한다 (ADR-006).
 */
export function PreviewFrame() {
  const frame = useRef<HTMLIFrameElement>(null);
  const previewDoc = useEditor((s) => s.previewDoc);
  const blocks = useEditor((s) => s.blocks);
  const scanned = useEditor((s) => s.scanned);
  const onReady = useEditor((s) => s.onReady);
  const onEdit = useEditor((s) => s.onEdit);
  const onBlocked = useEditor((s) => s.onBlocked);
  const select = useEditor((s) => s.select);

  useEffect(() => {
    const handle = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const msg = e.data as FromPreview;
      if (msg.type === 'ready') onReady(msg.blocks);
      else if (msg.type === 'edit') onEdit(msg.id, msg.html);
      else if (msg.type === 'blocked') onBlocked(msg.id);
      else if (msg.type === 'select') select(msg.id);
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [onReady, onEdit, onBlocked, select]);

  // 대조가 끝나 잠금이 확정되면 프리뷰에 알린다. UI 차단만으로는 부족하다 (INV-5).
  useEffect(() => {
    if (!scanned) return;
    const ids = blocks.filter((b) => b.locked !== null).map((b) => b.id);
    const msg: ToPreview = { type: 'locked', ids };
    frame.current?.contentWindow?.postMessage(msg, '*');
  }, [scanned, blocks]);

  if (!previewDoc) return null;

  return (
    <iframe
      ref={frame}
      title="preview"
      className="h-full w-full border-0 bg-white"
      sandbox="allow-scripts allow-same-origin"
      srcDoc={previewDoc}
    />
  );
}
