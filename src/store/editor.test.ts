// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { fixtureSource } from '../__fixtures__/load.js';
import { useEditor } from './editor.js';

const dropped = () => new File([fixtureSource()], 'artifact.html', { type: 'text/html' });

beforeEach(() => {
  useEditor.setState({ file: null, source: '', blocks: [], previewDoc: '', patches: new Map() });
});

describe('editor · 파일 열기 (동적 import 경로)', () => {
  it('놓은 파일을 파싱해 블록과 프리뷰 문서를 채운다', async () => {
    await useEditor.getState().loadDropped(dropped());

    const { source, blocks, previewDoc, notice } = useEditor.getState();
    // 파서를 동적으로 불러오므로 load 를 await 하지 않으면 여기가 전부 빈 채로 남는다 (ADR-008).
    expect(notice).toBeNull();
    expect(blocks.length).toBeGreaterThan(0);
    expect(source).toBe(fixtureSource());
    expect(previewDoc).toContain('data-ne-id');
  });

  it('로드가 끝나면 busy 가 풀린다 — 청크를 기다리다 굳지 않는다', async () => {
    await useEditor.getState().loadDropped(dropped());
    expect(useEditor.getState().busy).toBe(false);
  });
});

describe('editor · 저장', () => {
  it('고친 것이 없으면 저장하지 않는다 — Ctrl+S 가 같은 내용을 다시 쓰지 않게', async () => {
    await useEditor.getState().loadDropped(dropped());

    await useEditor.getState().save();

    // 아무 일도 없었으니 알릴 것도 없다.
    expect(useEditor.getState().notice).toBeNull();
  });
});
