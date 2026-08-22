// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from './editor.js';
import { useReplacement } from './replacement.js';
import { useToasts } from './toasts.js';
import { keepEdits, shortcutSave, useUnsaved } from './unsaved.js';

/**
 * 대화상자가 뜨기를 기다렸다가 대신 답한다 — 사람이 버튼을 누르는 자리다.
 *
 * 영영 기다리지 않는다. 물어야 하는데 묻지 않았다면 그 자리에서 실패해야
 * 무엇이 잘못됐는지 보인다. 무한정 돌면 테스트가 멈춘 것처럼만 보인다.
 */
async function answerWith(choice: 'save' | 'discard' | 'cancel'): Promise<void> {
  for (let tries = 0; useUnsaved.getState().why === null; tries++) {
    if (tries > 1000) throw new Error('대화상자가 뜨지 않았다');
    await Promise.resolve();
  }
  useUnsaved.getState().reply(choice);
}

/** 아직 파일에 없는 편집이 있는 상태 */
function edited(extra: Record<string, unknown> = {}): void {
  useEditor.setState({ patches: new Map([[0, '고친 값']]), unsaved: true, ...extra });
}

beforeEach(() => {
  useUnsaved.setState({ why: null, answer: null });
  useEditor.setState({ patches: new Map(), file: null, unsaved: false, saving: false });
  useReplacement.setState({ replacing: false });
  useToasts.getState().clear();
});

describe('keepEdits', () => {
  it('고친 것이 없으면 묻지 않는다', async () => {
    // 물을 것이 없는데 뜨는 대화상자는 방해일 뿐이다.
    const go = await keepEdits({ key: 'confirm.whyOpen' });

    expect(go).toBe(true);
    expect(useUnsaved.getState().why).toBeNull();
  });

  it('이미 저장했으면 묻지 않는다 — 잃을 것이 없다', async () => {
    // 저장해도 patches 는 남는다(INV-1). 그걸 "저장 안 함" 으로 읽으면 저장한 뒤에도 되묻는다.
    useEditor.setState({ patches: new Map([[0, '고친 값']]), unsaved: false });

    expect(await keepEdits({ key: 'confirm.whyOpen' })).toBe(true);
    expect(useUnsaved.getState().why).toBeNull();
  });

  it('취소하면 하던 자리에 그대로 있는다', async () => {
    edited();

    const asked = keepEdits({ key: 'confirm.whyOpen' });
    await answerWith('cancel');

    expect(await asked).toBe(false);
    expect(useEditor.getState().patches.size).toBe(1);
  });

  it('버리기를 고르면 계속한다', async () => {
    edited();

    const asked = keepEdits({ key: 'confirm.whyOpen' });
    await answerWith('discard');

    expect(await asked).toBe(true);
  });

  it('저장을 고르면 저장한 뒤에 계속한다', async () => {
    const save = vi.fn().mockResolvedValue(true);
    edited({ save });

    const asked = keepEdits({ key: 'confirm.whySwitch', params: { path: 'deck/b.html' } });
    await answerWith('save');

    expect(await asked).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });

  it('저장이 실패하면 계속하지 않는다', async () => {
    // 그대로 넘어가면 저장한 줄 알았던 편집이 사라진다.
    const save = vi.fn().mockResolvedValue(false);
    edited({ save });

    const asked = keepEdits({ key: 'confirm.whyOpen' });
    await answerWith('save');

    expect(await asked).toBe(false);
  });

  it('물음이 떠 있는 사이 이미 깨끗해졌으면 저장한 것으로 치고 계속한다', async () => {
    // 단축키로 부른 저장이 그 사이 끝났거나 마지막 편집을 되돌렸을 수 있다. 그때
    // save() 의 "쓸 것 없음" false 를 실패로 읽으면 하려던 일이 조용히 취소된다 (spec §4).
    const save = vi.fn().mockResolvedValue(false);
    edited({ save });

    const asked = keepEdits({ key: 'confirm.whyOpen' });
    for (let tries = 0; useUnsaved.getState().why === null; tries++) {
      if (tries > 1000) throw new Error('대화상자가 뜨지 않았다');
      await Promise.resolve();
    }
    // 물음이 떠 있는 사이 문서가 깨끗해졌다.
    useEditor.setState({ unsaved: false });
    useUnsaved.getState().reply('save');

    expect(await asked).toBe(true);
    // 청한 저장은 이미 충족됐다 — 헛되이 다시 쓰지 않는다.
    expect(save).not.toHaveBeenCalled();
  });

  it('무엇 때문에 사라지는지를 그대로 들고 있는다', async () => {
    edited();

    const asked = keepEdits({ key: 'confirm.whySwitch', params: { path: 'deck/b.html' } });
    await answerWith('cancel');

    expect(await asked).toBe(false);
  });

  it('묻는 중에 또 물으면 앞의 물음은 취소로 닫는다', async () => {
    // 답을 기다리는 프라미스를 그대로 두면 부른 쪽이 영영 풀리지 않는다.
    edited();

    const first = keepEdits({ key: 'confirm.whyOpen' });
    const second = keepEdits({ key: 'confirm.whyAssets' });
    await answerWith('discard');

    expect(await first).toBe(false);
    expect(await second).toBe(true);
  });
});

describe('shortcutSave · 물음이 떠 있는 동안의 Ctrl+S (spec §4)', () => {
  it('물음이 없으면 그냥 저장이다', () => {
    const save = vi.fn().mockResolvedValue(true);
    useEditor.setState({ save });

    shortcutSave();

    expect(save).toHaveBeenCalledOnce();
  });

  it('갈아 끼우는 동안의 Ctrl+S 는 거절하고 알린다 — 이전 문서를 쓰는 일이다', () => {
    // 버리기로 답한 편집이 아직 화면에 떠 있다. 여기서 저장하면 방금 버린 내용이
    // 파일에 적힌다 — 저장 버튼은 잠겨 있고, 단축키도 같은 기준을 따라야 한다.
    const save = vi.fn().mockResolvedValue(true);
    useEditor.setState({ save, unsaved: true });
    useReplacement.setState({ replacing: true });

    shortcutSave();

    expect(save).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts.some((t) => t.notice.key === 'app.saveWhileReplacing')).toBe(
      true
    );
  });

  it('물음이 떠 있으면 "저장하고 계속" 으로 흘러 하려던 일이 이어진다', async () => {
    // 여기서 그냥 저장만 하면 unsaved 가 풀린 채 물음이 남고, 그 뒤의 저장 버튼이
    // 저장할 것이 없다며 false 로 돌아 하려던 일(열기·갈아타기)이 취소된다.
    const save = vi.fn().mockResolvedValue(true);
    edited({ save });
    const asked = keepEdits({ key: 'confirm.whyOpen' });
    for (let tries = 0; useUnsaved.getState().why === null; tries++) {
      if (tries > 1000) throw new Error('대화상자가 뜨지 않았다');
      await Promise.resolve();
    }

    shortcutSave();

    expect(await asked).toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(useUnsaved.getState().why).toBeNull();
  });

  it('저장이 실패하면 여전히 계속하지 않는다', async () => {
    const save = vi.fn().mockResolvedValue(false);
    edited({ save });
    const asked = keepEdits({ key: 'confirm.whyOpen' });
    for (let tries = 0; useUnsaved.getState().why === null; tries++) {
      if (tries > 1000) throw new Error('대화상자가 뜨지 않았다');
      await Promise.resolve();
    }

    shortcutSave();

    expect(await asked).toBe(false);
  });

  it('저장이 도는 동안(saving)에는 답하지 않는다 — 대화상자의 저장 버튼과 같은 기준', async () => {
    const save = vi.fn().mockResolvedValue(true);
    edited({ save, saving: true });
    const asked = keepEdits({ key: 'confirm.whyOpen' });
    for (let tries = 0; useUnsaved.getState().why === null; tries++) {
      if (tries > 1000) throw new Error('대화상자가 뜨지 않았다');
      await Promise.resolve();
    }

    shortcutSave();

    expect(save).not.toHaveBeenCalled();
    expect(useUnsaved.getState().why).not.toBeNull();
    useUnsaved.getState().reply('cancel');
    expect(await asked).toBe(false);
  });
});
