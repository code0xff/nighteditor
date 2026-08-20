# Rules

## 1. 불변식

코드로 반드시 지켜야 하는 것. 위반은 리뷰에서 무조건 반려한다.

### INV-1 · 원본 문자열은 불변
세션 동안 로드한 원본 문자열을 **어떤 코드도 수정하지 않는다.**
저장은 언제나 `applyPatches(original, patches)` 라는 순수 함수의 결과다.

### INV-2 · 전체 재직렬화 금지
아래 호출이 문서 전체를 대상으로 등장하면 안 된다.
```
document.documentElement.outerHTML
parse5.serialize(document)
new XMLSerializer().serializeToString(document)
```
블록 단위 `element.innerHTML` 읽기는 허용된다 — 그 결과는 해당 블록의 범위에만 쓰인다.

### INV-3 · offset은 항상 원본 기준
모든 offset은 **로드된 원본 문자열**의 인덱스다. 마커 주입본이나 라이브 DOM 기준 offset을
저장 경로로 흘려보내지 않는다. 마커 주입본의 offset이 필요하면 별도 타입으로 구분한다.

### INV-4 · 패치는 내림차순으로 적용
`innerStart` 오름차순으로 스플라이스하면 두 번째 패치부터 offset이 어긋난다.
적용 직전 정렬을 함수 안에서 강제하고, 호출자의 정렬을 신뢰하지 않는다.

### INV-5 · 잠긴 블록은 패치 목록에 들어갈 수 없다
`locked !== null` 인 블록의 패치는 생성 단계에서 거부한다. UI 차단만으로는 부족하다.

### INV-6 · `core/`는 브라우저 API를 모른다
`core/` 아래에서 `document`, `window`, `HTMLElement` 참조 금지.
문자열 in, 문자열 out. 이 경계가 테스트 가능성의 전부다.

### INV-7 · `sourceCodeLocation`은 항상 null 가드
parse5는 스펙에 따라 **소스에 없는 노드를 트리에 삽입한다.**
레퍼런스 파일에서 테이블 13개에 `<tbody>`가 자동 삽입되고, 이들의 위치 정보는 `null`이다.
`node.sourceCodeLocation.startTag` 를 가드 없이 접근하는 코드는 반려한다.

위치 정보가 없는 노드는 **블록이 될 수 없다.** 통과시켜 자식으로 재귀할 뿐이다.

### INV-8 · 비교는 디코딩 후, 저장은 인코딩 후
HTML 엔티티 때문에 소스 문자열과 라이브 텍스트는 같은 내용이어도 다르게 보인다.

- **대조 검사(ADR-005)** — 양쪽 모두 디코딩해서 비교한다.
  원시 슬라이스로 비교하면 엔티티 포함 블록이 오탐으로 잠긴다
- **저장** — 사용자가 입력한 `&`, `<`, `>` 는 반드시 엔티티로 인코딩해 기록한다.
  안 하면 사용자가 `&` 를 치는 순간 문서 구조가 깨진다

디코딩/인코딩은 한 곳에 모으고 직접 구현하지 않는다.

---

## 2. 개발 프로세스

모든 작업은 **플랜 → 구현 → 리뷰** 순서를 지킨다. 순서를 건너뛰지 않는다.

### 2.1 플랜

코드를 쓰기 전에 아래를 정하고 합의한다.

- 무엇을 바꾸는가 (범위와 범위 밖)
- 어떤 파일을 건드리는가
- 어떤 불변식(§1)에 닿는가
- 어떻게 검증하는가 (테스트 목록)
- 커밋을 어떻게 쪼갤 것인가 (§3.2)

사소하지 않은 작업은 플랜 모드나 `Plan` 에이전트를 쓴다.
**플랜 없이 시작한 구현은 리뷰에서 반려 사유가 된다.**

문서(`spec.md` / `architecture.md`)에 영향이 있으면 **문서를 먼저 고친다.** 코드가 문서를 앞서지 않는다.

### 2.2 구현

- 플랜에서 합의한 범위만 건드린다. 벗어난 개선은 별도 커밋·별도 작업으로 뺀다
- `core/` 변경은 테스트를 먼저 쓰거나 최소한 같은 커밋에 포함한다
- 커밋 직전 `pnpm verify` 통과 (§5)

### 2.3 리뷰

커밋 전에 반드시 거친다.

| 대상 | 방법 |
|---|---|
| 정확성·버그 | `/code-review` |
| 중복·단순화·과잉설계 | `/simplify` |
| 불변식 위반 | §1 체크리스트 수동 대조 |
| 합격 기준 | `docs/spec.md` §6 해당 항목 |

리뷰에서 나온 지적은 **고치거나, 안 고치는 이유를 남긴다.** 조용히 넘기지 않는다.

---

## 3. 커밋

### 3.1 형식

```
type: message
```

스코프가 의미를 더할 때만 `type(scope): message` 를 쓴다.

| type | 용도 |
|---|---|
| `feat` | 사용자가 체감하는 기능 추가 |
| `fix` | 버그 수정 |
| `refactor` | 동작 변화 없는 구조 개선 |
| `test` | 테스트 추가·수정 |
| `docs` | 문서만 변경 |
| `chore` | 빌드·의존성·설정 |
| `ci` | CI 워크플로 변경 |
| `perf` | 성능 개선 |

- 메시지는 명령형 현재시제, 소문자로 시작, 마침표 없음
- 한 줄 요약은 72자 이내. 배경 설명이 필요하면 본문에 **왜**를 쓴다
- 식별자·커밋 메시지는 영어, 문서는 한국어

```
feat(core): add offset-based patch applier
fix(preview): keep markers alive after script DOM rewrite
test(core): assert byte-identical output on zero patches
```

### 3.2 기능 단위로 쪼갠다

**커밋 하나 = 되돌릴 수 있는 변경 하나.** 최대한 잘게 나눈다.

각 커밋은 아래를 모두 만족해야 한다.

- 그 커밋만으로 `pnpm verify` 가 통과한다 (빌드가 깨진 중간 커밋 금지)
- 한 문장으로 설명된다. `and` 가 들어가면 쪼갤 신호다
- 되돌려도 다른 기능이 함께 죽지 않는다

금지 패턴:

- 리팩터링과 기능 추가를 한 커밋에 — 리뷰에서 diff가 읽히지 않는다
- 여러 모듈을 한꺼번에 — `core/` 와 `ui/` 는 따로
- "작업 중 전부" 식 뭉치 커밋
- 포매팅 변경을 로직 변경에 섞기 — 포매팅만 별도 `chore` 커밋으로

---

## 4. 코드 분리

기능이 다르면 파일이 다르다. `docs/architecture.md` 의 모듈 경계를 코드가 그대로 반영한다.

- **한 파일은 바뀔 이유가 하나다.** 파싱과 렌더링, 패치와 UI 상태를 같은 파일에 두지 않는다
- **의존 방향은 단방향** — `ui/` → `store/` → `core/`. 역방향 import 금지.
  `core/` 는 아무것도 import 하지 않는다 (parse5 제외)
- **`preview/` 는 iframe 안에서 도는 별개 번들**이다. `ui/` 와 코드를 공유하지 않고 `postMessage` 로만 통신한다
- 파일이 200줄을 넘거나 여러 관심사가 섞이기 시작하면 쪼갠다. 줄 수는 신호일 뿐 기준은 관심사다
- export는 필요한 것만. 모듈 내부 헬퍼를 밖으로 노출하지 않는다

---

## 5. 검증과 push

### 5.1 단일 진입점

로컬과 CI가 **똑같은 명령**을 돌린다. 두 곳이 달라지면 로컬 통과가 아무 의미도 없어진다.

```jsonc
// package.json
"scripts": {
  "typecheck": "tsc --noEmit",
  "lint":      "eslint .",
  "format":    "prettier --check .",
  "test":      "vitest run",
  "verify":    "pnpm typecheck && pnpm lint && pnpm format && pnpm test"
}
```

### 5.2 CI는 `verify` 만 호출한다

`.github/workflows/ci.yml` 에 검증 로직을 직접 쓰지 않는다. `pnpm verify` 한 줄만 부른다.
CI에만 있는 검사가 생기는 순간 로컬 사전 확인이 무력해진다.

```yaml
name: CI
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm verify
```

### 5.3 push 전에 반드시 통과시킨다

**CI에서 처음 실패를 발견하는 일이 없게 한다.** push 전에 로컬에서 끝낸다.

```bash
pnpm verify        # 필수
act -j verify      # 선택 — 워크플로 자체를 로컬에서 실행 (nektos/act)
```

pre-push 훅으로 강제한다. 의존성 없이 git 기본 기능만 쓴다.

```bash
# .githooks/pre-push
#!/bin/sh
pnpm verify || {
  echo "verify 실패 — push 중단. 고치고 다시 시도할 것."
  exit 1
}
```

```bash
git config core.hooksPath .githooks   # 클론 후 1회
```

훅을 `--no-verify` 로 우회하지 않는다. 우회해야 할 상황이면 그건 고쳐야 할 문제다.

---

## 6. 테스트

### 필수: 패치 엔진 골든 테스트
`core/` 의 커버리지는 타협 대상이 아니다. 최소한 아래는 있어야 한다.

- **무편집 항등성** — 파싱 후 패치 0개로 저장 → 원본과 바이트 동일.
  레퍼런스 파일 전체로 검증한다. 이게 깨지면 다른 테스트는 의미 없다
- **단일 블록 최소 diff** — 블록 1개 수정 → diff 라인 수가 예상 범위 내
- **다중 블록 순서** — 여러 블록 동시 수정 시 offset 어긋남 없음 (INV-4 회귀)
- **인라인 보존** — `<b>` 포함 블록 수정 후 `<b>` 유지
- **블록 판정 회귀** — 레퍼런스 파일에서 867개, 태그별 분포 일치
- **엔티티 왕복** — `&amp;` 포함 블록을 수정 후 저장 → 엔티티가 보존되고 오탐 잠금 없음 (INV-8)
- **합성 노드** — `<tbody>` 13개에서 순회가 죽지 않음 (INV-7)

레퍼런스 파일을 픽스처로 커밋해 두고 회귀 대상으로 삼는다.

### UI 테스트
`ui/` 는 스냅샷 테스트를 강요하지 않는다. IME·contenteditable 처럼 수동 확인이 빠른 영역은
합격 기준(`spec.md` §6) 체크리스트로 대체한다.

---

## 7. 컨벤션

- TypeScript `strict`. `any` 금지, 불가피하면 `unknown` + 좁히기
- offset을 다루는 값은 이름에 단위를 남긴다 — `innerStart`, `srcOffset` (o) / `pos`, `idx` (x)
- 예외를 삼키지 않는다. 파싱 실패는 사용자에게 보여준다
- 주석은 **왜**를 쓴다. 무엇을 하는지는 코드가 말한다

---

## 8. 금지 사항

| 금지 | 이유 |
|---|---|
| 플랜 없이 구현 시작 | §2.1 |
| 리뷰 없이 커밋 | §2.3 |
| `git push --no-verify` | §5.3 — 훅은 우회하라고 있는 게 아니다 |
| 빌드가 깨진 중간 커밋 | §3.2 — bisect가 무의미해진다 |
| CI에만 존재하는 검사 | §5.2 — 로컬 사전 확인이 무력해짐 |
| 리치 텍스트 프레임워크 도입 | ADR-004 — 임의 마크업이 정규화로 소실 |
| 백엔드·API 서버 추가 | 대원칙 5 — 보안 모델 전제가 무너짐 |
| 원본 파일 자동 저장 | 덮어쓰기는 항상 명시적 사용자 행동으로 |
| 잠긴 블록 강제 해제 옵션 | 대원칙 3 — 틀리게 고칠 자유를 주지 않음 |
| 외부 전송(텔레메트리 포함) | 대원칙 5 |
| offset 계산을 정규식으로 대체 | 파서만이 정확한 위치를 안다 |
