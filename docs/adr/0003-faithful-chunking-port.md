---
status: Accepted
date: 2026-10-22
author: SungHyuk Park + ZCode
related: docs/designs/2026-10-22-chunking-api-mcp-design.md
---

# ADR-0003: upstream 청킹 파이프라인을 상수까지 그대로 JS로 포팅

## Context

LLM 모드에서 1만 자 이상 원문은 단일 호출로 (1) 길이 제한 잘림, (2) 600초 타임아웃, (3) 콜마다 룰북 재로드에 따른 토큰 비용 폭발 문제가 있었다. upstream im-not-ai는 이 문제를 이미 풀었다 — `scripts/prepare_monolith_input.py`(손실 없는 분할) + `scripts/reassemble_chunks.py`(병합·검증) + 실측 기반 상수.

선택지는 세 가지였다: (a) 우리가 청킹을 새로 설계, (b) upstream 알고리즘만 참고해 재작성, (c) **충실 포팅**.

## Decision

**(c) 충실 포팅** — `chunking.js`에 upstream 구현을 이식하되, 설계상 선택 여지가 있는 부분까지 upstream의 결정을 따른다.

- **offset 구간 불변식**: 청크는 부분 문자열이 아니라 원문 `[start, end)` 구간이며, 전체 연결이 원문과 정확히 일치해야 한다(위반 시 즉시 중단).
- **상수 그대로**: 권장 최소 15,000자 / 목표 7,000자 / 상한 9,000자 / 문장 폴백 트리거 4,000자. upstream의 단서 — *"웹앱의 1,800자는 flash-lite 전제라 이식 금지 — 큰 모델은 대구·리듬 같은 문단 횡단 신호를 잡아야 하므로 청크가 커야 한다"* — 를 준수해, 사용자 오버라이드에도 2,000자 하한을 둔다.
- **헤딩 글루**: 청크가 헤딩으로 끝나는 것을 구조적으로 금지(구형 웹앱의 알려진 버그).
- **병합 검증**: 앞뒤 공백 복원("원문 그대로를 재투입하면 재조립 = 원문" 항등), 청크별 글자 비율 경고(0.5x 미만 유실 / 2.0x 초과 증식), 빈 결과는 유실 사고로 중단.
- upstream이 경고 수준으로 다루는 것(상한 초과, 문서 말미 헤딩)은 오류가 아니라 경고로 유지한다.

## Consequences

- upstream이 청킹을 개선하면 diff를 JS에 반영하는 것만으로 따라갈 수 있다 — 알고리즘 재논증이 필요 없다.
- JS 포트 자체의 회귀는 upstream 테스트(`tests/test_chunking.py`)와 별개로 우리 테스트가 고정한다(무손실 왕복, 항등, 비율 경고, 각주 passthrough, 문장 폴백 — 20케이스).
- upstream에 없는 것(진단 1콜 공유, 경계 이음매 국소 패치)은 추가하지 않았다 — `references.json` deferred에 사유와 함께 보류.
