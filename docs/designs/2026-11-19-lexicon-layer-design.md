---
lang: ko
---

# 어휘 레이어 포팅 (lexical layer hints) 설계

| Field | Value |
|-------|-------|
| Date | 2026-11-19 |
| Status | accepted (본 PR에서 병합 예정) |
| Related | ADR-0002 (제로 디펜던시), ADR-0003 (충실 포팅), ADR-0004 (단일 엔진 로더), `references.json` im-not-ai `adopted[].date=2026-11-19` |
| Upstream 기준 | epoko77-ai/im-not-ai v2.4.0~v2.4.7 (2026-11-15~17) — `scripts/lexical_layer.py`, `skills/humanize-korean/references/lexicon.json` v1.3 |

## Problem

2026-11-19 드리프트 점검에서 upstream이 v2.4.0~v2.4.7(총 15커밋)로 진화했다. 핵심 신기능은 **어휘 레이어**다: 문장 구조 티(A~J)와 별개로, AI 글에는 독자가 읽다가 걸리는 낱말("~의 렌즈로", "성공을 달성한다")이 있고, 이는 메인테이너 블라인드 평가(148 후보 → 111 채택 + 추가·재판정 = 115개)로 근거화되어 있다. 웹 포트에는 이 축이 아예 없었다.

## Change Design

### D1 — lexicon-data.js + lexicon.js (충실 포팅)

- `lexicon-data.js`: upstream `lexicon.json` v1.3 verbatim(JSON → `window.HumanizeLexiconData`). 엔트리는 좁은 복원용 regex·넓은 힌트용 regex_detect·정당 용법 제외 regex_exclude·장르별 바꿀 때/둘 때/방식·skip_genres·내장 픽스처를 갖는다.
- `lexicon.js`: `lexical_layer.py`의 hints 경로 이식 — 컴파일 캐시, 제외 창(±12자), 직접 인용 제외(QUOTE_RE, v2.4.1 실측 반영), skip_genres, 장르 키 매핑(report→보고서 / paper·abstract→논문 / 그 외 일반), tier 정렬(change 우선→count), `[어휘 점검]` 블록 렌더링(MAX 15 + 생략 안내), graceful degrade(사전 없음·깨짐 → 빈 문자열).

### D2 — 통합 지점 (upstream 결합 입력 파일과 동일한 배치)

- **app.js LLM 모드**: 단일 경로는 힌트 블록을 user 메시지 앞에, 청킹 경로는 **청크별로** 계산해 헤더 뒤에 붙인다(upstream이 청크 결합 입력 파일마다 어휘 블록을 싣는 것과 동일).
- **serve.ts**: `/api/lexicon`(hits + block) 신설, `/api/chunk`는 본문 청크에 `hint` 필드를 포함해 반환.
- **mcp-server.mjs**: `humanize_lexicon` 도구 신설(총 6개), `humanize_chunk`에 청크별 hint 포함.

### D3 — 검증 전략: 사전 내장 픽스처 전수 실행

upstream이 엔트리마다 `test_detect_pos/neg`(넓은 정규식)와 `test_positive/negative`(좁은 정규식)를 갖고 있어, 이 1,011건을 JS 매처로 전수 실행하면 포트의 정규식 호환성과 의미 등가가 한 번에 검증된다. 실제로 이 스윕이 포트 오류(Python식 `m.end()` 잔여)를 즉시 잡았다.

- 장르 처리: POS detect 픽스처는 스킵되지 않는 어떤 장르에서든 히트해야 하고, NEG는 스킵되지 않는 모든 장르에서 무히트여야 한다. `skip_genres`가 3장르 전부인 엔트리(X-01 지형류)는 hints에서 도달 불가라 narrow-regex 픽스처가 담당한다.

## Alternatives Considered

| 대안 | 기각 사유 |
|------|----------|
| 어휘 항목을 규칙(A~K)으로 규칙화 | upstream 설계와 정반대 — 같은 낱말도 문맥상 정당 용법이 많아(스마트폰 잠금 해제 등) 일괄 치환은 오탐·새 상투어를 만든다. upstream이 일괄 치환을 명시적으로 금지 |
| restore 경로 동시 포팅 | restore_modality.py의 문장 정렬·유사도·분할/병합 판정 기계 의존(ADR-0003의 "upstream에 없는 것은 추가하지 않음" 원칙). 본 프로젝트는 프롬프트 절차 3 ③·자체검증 ⑥이 역주입을 방어 — deferred에 기록 |
| 힌트를 시스템 프롬프트(prompt.js)에 정적으로 삽입 | 발견 비례 비용 설계가 사라지고 115개 전문이 매 콜 실림 — upstream이 밝힌 토큰 폭발의 재현 |

## Verification

- `bun test.mjs` 268체크 ALL PASS — 어휘 섹션 9케이스(픽스처 전수 포함) 신설
- 실서버 스모크: `/api/lexicon`(AST-01 히트), `/api/chunk` 7/7 청크 hint 포함, MCP `humanize_lexicon`(L-38 히트)·`humanize_chunk` hint — 장르 미지정 시 일반 스킵 규칙이 작동하는 것까지 확인
- `bun scripts/ref-check.mjs --local` VALIDATION PASS
