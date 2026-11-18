---
lang: ko
---

# 신규 출처 스캔 + fidelity 검사기 포팅 설계

| Field | Value |
|-------|-------|
| Date | 2026-11-19 |
| Status | accepted (본 PR에서 병합 예정) |
| Related | ADR-0002 (제로 디펜던시), ADR-0004 (단일 엔진 로더), 2026-11-19-lexicon-layer-design (같은 날 어휘 레이어), `references.json` slop-rewrite 등 신규 5개 출처 |
| Upstream 기준 | byungjunjang/slop-rewrite — `.claude/skills/slop-rewrite/scripts/check_fidelity.py` (971행, MIT) |

## Problem

REFERENCES.md의 새 출처 기준에 따라 GitHub 전역 검색을 수행한 결과, 레지스트리에 없는 후보가 다수 나왔다. 그중 **byungjunjang/slop-rewrite**는 우리 구조에 없는 축을 갖고 있다: 윤문 결과가 원문의 사실을 지켰는지를 **코드로 검증하는 fidelity 검사기**(문서 단위 다중집합 비교 — 문장 짝짓기 없음). 이 프로젝트의 merge 검증은 글자 비율(유실/증식)까지만 보고, 규칙 엔진은 AI 티만 보므로 "수치가 지어졌는가/떨어졌는가, 인용이 변형됐는가"를 아무도 검사하지 않았다.

## Change Design

### D1 — fidelity.js (check_fidelity.py 코어 포팅)

F1 수치·단위 / F2 인용 / F3 부정 / F7 자리표시자를 이식한다. upstream 설계 유지:

- **문서 단위 다중집합 비교** — 문장을 짝짓지 않는다. 추가된 것(결과에만 있음)이 S1급 실패, 사라진 것은 S2급 보고("자연스러움이 1순위라 어색한 문장은 수치가 들었어도 지울 수 있고, 코드는 지어낸 것만 막는다" — upstream 주석).
- **배수 단위 정규화**(천/만/억/조 곱셈, 단일 마디)로 3천 원↔3,000원을 정상 처리. 같은 값 다른 단위(12%→12%p)는 changed 보고.
- **인용 규약**: 결과의 인용 몸통은 원문(공백 제거) 어디엔가 있어야 한다(원문이 따옴표 없이 쓴 구절이어도 됨) / 원문 인용은 결과에 그대로(raw) 남지 않으면 사라진 것 보고.
- **F3 부정**: 계열별(않/없/못/안/아니/미) 카운트 — 계열 이동(없다→미비)도 소실 보고, 대조형 아닌가(A가 아니라 B)는 부정에서 제외(upstream NEG_ANI 이식). 뜻 뒤집힘 판정은 실행자 몫(upstream도 동일).
- 코드펜스는 면제(코드 속 수치는 산문 주장이 아님).

단순화(문서화됨): 합성 수치 canon(1억 2,000만)의 마디 곱, F4/F5/F8/F9 구조 게이트는 미포팅 — deferred.

### D2 — 노출·통합

- `/api/fidelity` `{original, polished}` 신설 / `/api/merge`와 MCP `humanize_merge` 응답에 `fidelity` 필드 추가 / MCP `humanize_fidelity` 도구 신설(총 7개).
- 웹 LLM 모드: 결과 메타에 "⚠ 의미 보존 확인 필요 — 지어낸 수치 1건, …" 경고(지어낸 것만 나열, 사라진 것은 보고 문구).

### D3 — 신규 출처 5건 레지스트리 등록

프로토콜(검토만 해도 기록)에 따라: slop-rewrite(benchmark, 채택), daleseo-korean-skills / k-humanizer / kordoc / im-not-strange-ai(reference, 미채택 + 사유). AT 카탈로그(134개)는 hk(upstream) 매핑 열이 있는 중복이라 규칙화하지 않았다.

## Alternatives Considered

| 대안 | 기각 사유 |
|------|----------|
| check_fidelity.py 전체 포팅(F4/F5/F8/F9 포함) | 구조 게이트는 청킹+변경률이 이미 커버. 코어(F1/F2/F3/F7)가 가치의 90% |
| fidelity를 규칙(A~K)으로 규칙화 | 원문↔결과 **대조**가 전제인 검사라 단일 텍스트 규칙과 성격이 다름 — 별도 레이어가 맞다 |
| eval-harness에 합산 | 목적이 다르다(프롬프트 A/B vs 결과 검증). 도구로 분리, merge에 내장 |

## Verification

- `bun test.mjs` 279체크 ALL PASS — fidelity 11케이스 신설(지어낸/사라진 수치, 단위 변경, 배수 정규화, 인용 fabricated/dropped, 부정 소실, 자리표시자, 코드 면제, 무오판)
- 서버·MCP 스모크: `/api/fidelity`, merge 응답 fidelity 필드, `humanize_fidelity` 확인
- `bun scripts/ref-check.mjs --local` VALIDATION PASS(11 출처)
