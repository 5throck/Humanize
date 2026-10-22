---
status: Accepted
date: 2026-09-29
author: SungHyuk Park + ZCode
---

# ADR-0001: 다중 출처 레지스트리를 references.json 단일 진실 공급원으로 관리

## Context

이 프로젝트의 규칙은 단일 출처가 아니다. 뼈대는 [epoko77-ai/im-not-ai](https://github.com/epoko77-ai/im-not-ai) 룰북이고, K 카테고리(챗봇 잔여물)는 [IsaacEryn/humanizer-ko](https://github.com/IsaacEryn/humanizer-ko), 통계 탐지(E-3·E-4, J-4·J-5)는 [devswha/patina](https://github.com/devswha/patina), 과소 서술 보정은 [amondnet/yoonmoon](https://github.com/amondnet/yoonmoon)에서 왔다. 출처가 여러 곳이고 출처들 자체도 계속 업데이트되므로, 두 가지 실패 모드가 있었다:

1. **출처 부패** — 어떤 규칙이 어느 저장소에서 왔는지 잊어버려, upstream이 근거를 철회한 규칙을 계속 운용하거나 같은 후보 저장소를 재조사하는 낭비가 생긴다.
2. **매핑 부패** — 규칙 이름을 바꾸거나 삭제할 때 출처 매핑이 조용히 깨진다.

## Decision

- [`references.json`](../../references.json)을 **SSOT**으로 삼는다: 출처 목록(id·repo·role·license), 출처별 `adopted`(무엇을 어느 규칙 ID·프롬프트 섹션에 반영했는지)·`deferred`(보류 + 사유), `last_checked` 점검일.
- `rules.js`의 각 규칙은 `src: ["출처id"]` 필드로 출처를 코드 안에 직접 표기한다. `src`가 없으면 `default_source`(im-not-ai)다.
- `scripts/ref-check.mjs`가 (1) 레지스트리 스키마, (2) `src` ↔ 출처 id 일치, (3) `adopted[].rules` ↔ 실제 규칙 id 존재를 검증하고, (4) GitHub API로 각 출처의 최신 푸시일·key_files 커밋일을 조회해 `last_checked` 이후 드리프트를 표시한다.
- 업데이트 절차(드리프트 확인 → 재검토 → 반영 → 검증 → 점검일 갱신)는 [`REFERENCES.md`](../../REFERENCES.md)에 문서화했다.
- 채택하지 않은 후보도 `role: "reference"` + `not_adopted_reason`으로 기록해 재조사 낭비를 막는다.

## Consequences

- 규칙 이름 변경·삭제가 매핑을 깨면 `bun test.mjs`와 ref-check가 즉시 잡아낸다 — 조용한 부패는 구조적으로 불가능하다.
- upstream 재검토 비용이 "레지스트리 읽기 + key_files diff"로 고정된다. 2026-10-22 회차에서 6개 출처 중 3개의 드리프트를 이 절차로 처리했다.
- 대가: 모든 규칙 변경에 레지스트리 갱신이 따라와야 한다(테스트가 강제). 출처별 임계·문구 변경은 규칙 파일과 레지스트리를 같은 PR에서 고쳐야 한다.
