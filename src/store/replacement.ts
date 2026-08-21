/**
 * 문서 갈아 끼우기 예약 — "문서를 바꾸는 동안 무엇이 잠기고 누가 이기는가" 는
 * 전부 이 파일에서 정한다 (spec §5 · 갈아 끼우기 예약, ADR-010).
 *
 * ## 누가 이기는가 — 마지막 예약
 *
 * 문서를 바꾸려는 흐름(파일 열기·드롭·폴더 열기·묶음 갈아타기·폴더 연결·OS 열기)은
 * **사용자 행동의 순간**에 예약부터 받는다 — 훑기·대화상자·묻기·저장처럼 오래
 * 걸리는 일을 시작하기 전에. 늦게 받으면, 먼저 시작했지만 늦게 준비를 마친 흐름이
 * 더 새 예약을 받아 사용자의 마지막 선택을 덮는다.
 *
 * 겹치면 마지막 예약이 이긴다 — 그것이 사용자의 마지막 선택이다. 흐름은 오래
 * 걸리는 단계를 마칠 때마다 `current()` 로 자기 예약이 아직 최신인지 확인하고,
 * 밀려났으면 **제가 만든 것만 정리하고 물러난다** — 설치도, 알림도, 잠금 해제도
 * 하지 않는다. 그건 전부 최신 예약의 몫이다.
 *
 * ## 무엇이 잠기는가 — replacing 하나
 *
 * 물음에 답해 갈아 끼우기가 확정된 순간(`engage`)부터 설치·실패(`release`)까지
 * `replacing` 이 선다. 화면의 잠금은 전부 이 값 하나에서 파생된다 (spec §4).
 *
 * - 프리뷰 — 포인터를 막는다. 그래도 들어온 편집 확정은 스토어가 거절하고 알린다
 * - 제목 칸 — 비활성
 * - 변경 목록 — 되돌리기·전체 되돌리기·`Ctrl+Z` 를 막는다 (이전 문서를 고치는 일이다)
 * - 툴바 — 열기·문서 고르기·폴더 연결·저장 비활성
 *
 * 저장 중 표시(editor 의 `saving`)는 저장의 것이라 여기 없다 — 저장하는 사이의
 * 편집은 살아남으므로 저장은 화면을 잠그지 않고, 앞선 저장이 갈아 끼우는 사이에
 * 끝나도 제 표시만 내릴 뿐 이 잠금은 건드리지 못한다.
 *
 * ## 늦게 끝난 비동기 — 설치 세대
 *
 * 새 문서가 설치될 때마다 `installed` 가 오른다. 저장처럼 갈아탄 뒤에 끝날 수 있는
 * 비동기는 시작할 때 `claimDocument()` 로 그때의 세대를 받아 두고, 끝났을 때
 * 세대가 달라졌으면 결과(상태 갱신·알림·제 표시 해제)를 버린다 (spec §5).
 */
import { create } from 'zustand';

interface ReplacementState {
  /** 확정된 갈아 끼우기가 진행 중 — 화면 잠금의 유일한 근거 */
  replacing: boolean;
  /** 설치된 문서의 세대. 값 자체에는 뜻이 없고 비교만 뜻이 있다 */
  installed: number;
}

export const useReplacement = create<ReplacementState>(() => ({
  replacing: false,
  installed: 0,
}));

/** 마지막으로 받은 예약 번호. 화면이 볼 일이 없어 상태 밖에 둔다 */
let reserved = 0;

export interface Replacement {
  /** 이 예약이 아직 최신인가 — 오래 걸리는 단계를 마칠 때마다 이것 하나로 판정한다 */
  current(): boolean;
  /** 갈아 끼우기 확정(물음까지 통과) — 화면을 잠근다. 밀려난 흐름이 불러도 아무 일 없다 */
  engage(): void;
  /** 새 상태가 설치됐다 — 세대를 올려 이전 문서 몫의 늦은 비동기를 끊는다 */
  install(): void;
  /**
   * 이 흐름의 끝 — 최신일 때만 잠금을 내린다. 밀려난 흐름이 내리면 아직 읽는 중인
   * 최신 흐름의 화면이 풀리므로, 판정을 부르는 쪽에 맡기지 않고 여기서 강제한다.
   */
  release(): void;
}

/**
 * 갈아 끼우기 한 번의 예약. 진입점은 이것을 받아 두고 끝까지 같은 예약으로 움직인다.
 *
 * 예약을 받는 순간 이전 예약은 전부 밀려난다 — 취소로 끝나더라도 마찬가지다.
 * 취소는 "보던 문서에 그대로" 라는 뜻이고, 밀려난 옛 흐름이 대신 설치되는 것은
 * 취소가 아니다 (spec §5 · 갈아 끼우기 예약).
 */
export function reserveReplacement(): Replacement {
  const gen = ++reserved;
  const current = (): boolean => gen === reserved;
  return {
    current,
    engage: () => {
      if (current()) useReplacement.setState({ replacing: true });
    },
    install: () => {
      if (current()) useReplacement.setState((s) => ({ installed: s.installed + 1 }));
    },
    release: () => {
      if (current()) useReplacement.setState({ replacing: false });
    },
  };
}

/**
 * "이 결과가 지금 문서의 것인가" 를 한 자리에서 판정한다 (spec §5).
 *
 * 비동기를 시작하기 전에 부르면 확인 함수를 돌려준다 — 그 사이 문서가 갈아
 * 끼워졌으면 false 고, 그때의 결과는 이전 문서의 것이라 버린다.
 */
export function claimDocument(): () => boolean {
  const installed = useReplacement.getState().installed;
  return () => useReplacement.getState().installed === installed;
}
