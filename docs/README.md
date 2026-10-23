# 문서 인덱스

이 저장소의 아키텍처 결정(ADR)과 기능 설계 문서. 문서 역할 분담은 다음과 같다.

| 문서 | 역할 |
|------|------|
| [`../README.md`](../README.md) | 사용자 안내 — 실행, 설정, API/MCP 사용법, 문제 해결 |
| [`../REFERENCES.md`](../REFERENCES.md) + [`../references.json`](../references.json) | **출처 SSOT** — 규칙·프롬프트가 어느 저장소에서 왔는지, 채택/보류 내역, 드리프트 점검 절차 |
| `adr/` | **아키텍처 결정 기록** — 왜 그렇게 만들었는지, 무엇을 기각했는지. 부결된 안도 기각 사유와 함께 기록 |
| `designs/` | **기능 설계 문서** — 문제 정의, 설계 결정(D1, D2, …), 검증 결과를 한 회차 단위로 기록 |

## 규칙

- 결정은 삭제하지 않고 **superseded로 표기하고 앞뒤로 연결**한다 (append-mostly).
- ADR은 한 건당 하나의 결정만 다룬다. 회차 단위 구현은 `designs/`에, 그 설계가 남긴 "왜"는 ADR로 승격한다.
- 출처 관련 결정(채택/보류)은 ADR이 아니라 `references.json`의 `adopted`/`deferred`가 담당한다 — 두 기록이 충돌하면 레지스트리가 이긴다.

## ADR 목록

| ID | 제목 | 상태 |
|----|------|------|
| [ADR-0001](adr/0001-multi-source-registry-ssot.md) | 다중 출처 레지스트리를 references.json 단일 진실 공급원으로 관리 | Accepted |
| [ADR-0002](adr/0002-zero-dependency-single-server.md) | 제로 디펜던시 단일 서버 (빌드 없음, 프레임워크·SDK 미도입) | Accepted |
| [ADR-0003](adr/0003-faithful-chunking-port.md) | upstream 청킹 파이프라인을 상수까지 그대로 JS로 포팅 | Accepted |
| [ADR-0004](adr/0004-shared-engine-loader.md) | 브라우저 엔진 파일을 단일 로더로 재사용 — HTTP API와 MCP가 같은 엔진 공유 | Accepted |
| [ADR-0005](adr/0005-mit-license-retention.md) | 라이선스 MIT 유지 (workspace AGPL 정책 검토 후) | Accepted |
| [ADR-0006](adr/0006-eval-harness-no-ml-framework.md) | 오프라인 평가 하네스 — 프롬프트 개선 루프는 순수 Bun으로, ML 최적화 프레임워크는 미도입 | Accepted |

## 설계 문서 목록

| 문서 | 다룬 회차 |
|------|----------|
| [2026-10-22-chunking-api-mcp-design](designs/2026-10-22-chunking-api-mcp-design.md) | 장문 청킹 포팅 + `/api/*` 5종 + MCP stdio 서버 (PR #8) |
