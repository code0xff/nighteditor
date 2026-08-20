// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureSource } from '../__fixtures__/load.js';
import { useEditor } from './editor.js';

const dropped = () => new File([fixtureSource()], 'artifact.html', { type: 'text/html' });

beforeEach(() => {
  // notice 까지 지운다. 남겨두면 앞 테스트의 알림이 다음 단정으로 새어 나간다.
  useEditor.setState({
    file: null,
    source: '',
    blocks: [],
    previewDoc: '',
    patches: new Map(),
    notice: null,
  });
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

describe('editor · 사본 내려받기', () => {
  it('패치가 없어도 원본을 그대로 내려받는다 — 고치기 전 백업 용도', () => {
    const url = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', { ...URL, createObjectURL: url, revokeObjectURL: vi.fn() });

    useEditor.setState({
      file: { name: 'artifact.html', text: fixtureSource(), handle: null },
      source: fixtureSource(),
      blocks: [],
      patches: new Map(),
    });
    useEditor.getState().downloadCopy();

    expect(url).toHaveBeenCalledOnce();
    expect(useEditor.getState().notice).toEqual({
      key: 'notice.copyDownloaded',
      params: { name: 'artifact.html', count: 0 },
    });
    vi.unstubAllGlobals();
  });

  it('파일이 없으면 아무 일도 하지 않는다', () => {
    useEditor.getState().downloadCopy();
    expect(useEditor.getState().notice).toBeNull();
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
