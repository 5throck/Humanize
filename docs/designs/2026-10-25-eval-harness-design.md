---
lang: ko
---

# 오프라인 평가 하네스 설계 (프롬프트 개선 루프)

| Field | Value |
|-------|-------|
| Date | 2026-10-25 |
| Status | accepted (PR #16 병합) |
| Related | ADR-0006 (ML 프레임워크 미도입 — 이 설계의 상위 결정), ADR-0002 (제로 디펜던시), ADR-0004 (엔진 재사용) |
| 파일 | `lib/eval-core.mjs`, `scripts/eval.mjs`, `scripts/bootstrap-fewshot.mjs`, `eval/corpus.json` |

## Problem

`engine/prompt.js`의 시스템 프롬프트를 고칠 때 "좋아졌는지"에 대한 재현 가능한 검증이 없었다. 윤문 품질의 최종 재판관은 사람이지만, 프롬프트 변경이 잦을수록 매번 사람 눈으로 전체를 읽는 것은 불가능하고, 제안도 "느낌"으로만 주고받게 된다.

## Change Design

### D1 — 메트릭은 규칙 엔진 재사용

새 점수 체계를 만들지 않는다. `HumanizeRules.analyze/polish/changeRate/grade`(웹 UI 배지와 동일한 엔진)를 재사용해 S1 잔존·변경률·등급을 낸다. 순수 로직(`lib/eval-core.mjs`)과 CLI(`scripts/eval.mjs`)를 분리해 `bun test.mjs`가 점수·집계·비교 동작을 그대로 고정할 수 있게 한다 — 하네스 자체의 회귀가 테스트로 잡힌다.

### D2 — 코퍼스는 expect 태그 픽스처

`eval/corpus.json`: AI 티가 있는 한국어 원문 8편(이 저장소에서 새로 쓴 합성 텍스트) + 편별 기대 신호(`expect`). `bun test.mjs`가 (1) 픽스처의 신호가 규칙으로 실제 감지되는지, (2) 규칙 임계값이 바뀌어 픽스처가 썩지 않았는지를 함께 검증한다. `--only <id>`로 일부만 실행 가능.

### D3 — LLM 호출은 serve.ts 프록시 경유

평가 스크립트가 공급자를 직접 두드리지 않는다 — 실행 중인 `serve.ts`의 `/llm/chat/completions` 프록시를 경유한다(키 주입·프로토콜 변환은 웹 UI와 완전히 같은 경로). 스크립트는 `.env`를 읽지 않는다. 실패한 픽스처는 기록만 남기고 계속, 일시 오류는 백오프 재시도.

### D4 — 런 파일 기반 A/B

`--out`으로 런 JSON(모델명·시스템 프롬프트 sha256·픽스처별 결과물 원문·메트릭)을 저장하고, `--prompt <파일>`로 변안 프롬프트를 넣어 같은 런을 수행한 뒤 `--compare`로 등급·S1 잔존·역주입(원문에 없던 신호)을 비교한다. 프롬프트 개선 PR에 런 JSON 비교를 붙이면 리뷰어가 숫자로 검증할 수 있다.

### D5 — few-shot은 후보만, 자동 주입 없음

`scripts/bootstrap-fewshot.mjs`가 하드케이스를 분류한다: A(few-shot 후보 — 엔진이 고칠 수 있는 S1 잔존: 결정적·검증 가능한 원문→결과 예시 쌍) / B(역주입 회귀 — 프롬프트 결함 보고) / C(감지 전용 잔존 — 룰북 갭 과제). 반영은 references.json 큐레이션 절차를 거친다 — 자동 생성 프롬프트와 출처 추적 체계(ADR-0001)의 충돌 방지.

## Alternatives Considered

| 대안 | 기각 사유 |
|------|----------|
| DSPy/AdalFlow 등 ML 최적화 프레임워크 | ADR-0006 — 스택 충돌(Python 런타임 vs Bun 전용), 문제 형상 불일치(모놀리식 프롬프트에는 최적화할 그래프가 없음), 큐레이션 프로세스 충돌 |
| 사람 라벨 품질 점수 | 최종 재판관은 사람이지만 반복 가능한 보조 지표가 필요한 시점에는 과비용. 엔진 메트릭이 프록시임을 명시하고 사람 읽기 단계를 루프에 남김 |
| 별도 평가 서비스·DB | 런 JSON 파일이면 충분 — git에 함께 보관·비교 가능 |

## Verification

- `bun test.mjs`가 eval-core(픽스처 검증·점수·diff·few-shot 분류)를 고정 — 이후 모든 회차에서 함께 통과.
- README 「프롬프트 개선 루프」 절에 한계 명시: "엔진이 아는 47개 패턴만 본다 — 엔진 통과 ≠ 좋은 윤문. 런 JSON의 결과물 원문을 사람이 읽어 최종 판단."
