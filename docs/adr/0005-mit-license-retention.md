---
status: Accepted
date: 2026-10-22
author: SungHyuk Park
---

# ADR-0005: 라이선스 MIT 유지 (workspace AGPL 정책 검토 후)

## Context

ai_workspace(`~/git/ai_workspace`)의 라이선스 정책은 2026-05-23부터 **신규 프로젝트 AGPL-3.0**이다(루트 LICENSE 전파 + 템플릿 롤아웃, `docs/designs/2026-08-28-agpl-license-template-rollout-design.md`). 반면 이 저장소는 이미 GitHub에 **public + MIT**로 공개되어 있고(5throck/Humanize), 규칙 뼈대 출처인 im-not-ai도 MIT다. 2026-10-22 청킹/API/MCP 기능 추가 시점에 라이선스 전환 여부를 검토했다.

## Decision

**MIT를 유지한다** (사용자 확정, 2026-10-22). 저장소 전환 조건("GitHub 저장소가 없으면 public + AGPL")은 적용되지 않았다 — 저장소가 이미 존재하고 public이므로 PR·병합 경로로 진행했다.

## Alternatives

- **AGPL-3.0 전환**: workspace 정책과의 일관성은 얻지만, 이미 MIT로 공개된 코드의 라이선스를 바꾸면 기존 포크·이용자의 조건이 변한다. 본 프로젝트는 workspace 템플릿에서 스캐폴딩된 것이 아니라 독립 저장소라 정책의 "flow to templates" 적용 대상도 아니다.
- **듀얼 라이선스**: 유지 관리 비용 대비 이점 없음.

## Consequences

- workspace에서 파생된 프로젝트들과 라이선스 체계가 다르다 — 이는 허용된 불일치이며, 이 ADR이 그 사유를 기록한다.
- MIT 출처(im-not-ai)와의 관계가 단순하게 유지된다. 규칙·프롬프트의 출처 라이선스는 `references.json`의 `license` 필드로 계속 추적한다.
- 향후 AGPL 전환이 필요해지면 이 ADR을 supersede한다.
