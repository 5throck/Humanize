---
status: Accepted
date: 2026-08 (초기 설계), 2026-10-22 문서화
author: SungHyuk Park
---

# ADR-0002: 제로 디펜던시 단일 서버 (빌드 없음, 프레임워크·SDK 미도입)

## Context

이 도구는 로컬에서 돌아가는 윤문 웹앱이다. 필요한 서버 기능은 (1) 정적 파일 서빙, (2) 공급자 CORS 차단 우회를 위한 프록시, (3) Anthropic/Gemini 네이티브 프로토콜 변환, (4) `.env` 키 주입이다. 이후 MCP 서버가 추가됐다(ADR-0004 설계 문서 참조).

프레임워크(Express·Hono)와 공식 MCP SDK(`@modelcontextprotocol/sdk`)를 쓰면 개발은 빠르지만, 키를 다루는 로컬 보안 도구 특성상 의존성 그래프 전체를 신뢰해야 하는 비용이 생긴다.

## Decision

- **의존성 0개**를 설계 원칙으로 유지한다. 서버는 `node:http` 하나(`serve.ts`, bun/Node 22+ type-strip으로 빌드 없이 실행), MCP 서버(`mcp-server.mjs`)는 stdio JSON-RPC 2.0을 필요한 부분(initialize/ping/tools)만 직접 구현한다.
- 필요한 프로토콜 변환(OpenAI ↔ Anthropic Messages ↔ Gemini generateContent)은 serve.ts 안에 명시적으로 둔다.
- 기능 추가로 의존성이 정말 필요해질 때는 그때 ADR로 재결정한다. "작게 유지"는 목적이 아니라 감사 가능성과 설치 단순성(`bun install` 불필요)을 위한 수단이다.

## Consequences

- 키를 다루는 코드 전체가 수백 줄 안에서 감사 가능하다. supply-chain 공격면이 없다.
- 대가: MCP 사양 변경 시 직접 대응한다. 완화 — 노출하는 프로토콜 면(tools만)은 사양에서 가장 안정적인 부분이고, 테스트가 핸드셰이크를 고정한다.
- 제로 디펜던시는 ai_workspace 코딩 지침의 의존성 규칙(카피레프트·상용 라이선스 의존성 회피)과도 정합된다.
