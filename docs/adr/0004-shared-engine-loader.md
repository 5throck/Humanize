---
status: Accepted
date: 2026-10-22
author: SungHyuk Park + ZCode
related: docs/designs/2026-10-22-chunking-api-mcp-design.md
---

# ADR-0004: 브라우저 엔진 파일을 단일 로더로 재사용 — HTTP API와 MCP가 같은 엔진 공유

## Context

규칙 엔진(`rules.js`)·프롬프트(`prompt.js`)·청킹(`chunking.js`)은 브라우저 전용 `<script>` IIFE로 존재했다(`window.HumanizeRules` 등). HTTP API와 MCP 서버를 만들려면 이 로직이 서버 쪽에서도 필요했다. 선택지: (a) 서버용 복사본 유지, (b) 엔진을 ESM으로 재작성해 브라우저와 서버가 공유, (c) **기존 IIFE를 그대로 두고 샌드박스 로더로 재사용**.

## Decision

**(c)** — `lib/engine.mjs`가 `rules.js`/`prompt.js`/`chunking.js`를 `readFileSync` + `new Function('window', src)`로 샌드박스(`{ window: {} }`)에 로드해 `{ Rules, Prompt, Chunking }`을 돌려준다. 이 트릭은 `test.mjs`가 이미 쓰던 방식이라 검증되어 있다.

- `serve.ts`의 `/api/*` 5종과 `mcp-server.mjs`의 도구 5개는 **같은 엔진 인스턴스와 같은 페이로드**를 쓴다. API 문서와 MCP 도구 설명은 한쪽만 고쳐도 반대쪽이 틀리지 않게 된다.
- 브라우저 파일은 `window` 전역 IIFE 패턴을 유지한다 — ESM 재작성은 하지 않는다.

## Consequences

- 규칙 로직의 원본이 하나뿐이다. 규칙을 고치면 웹·API·MCP·테스트가 동시에 바뀐다.
- 대가: `new Function`은 런타임 컴파일이라 CSP가 엄격한 환경에서 막힐 수 있다 — 로컬 도구라 무관하며, 파일이 모두 신뢰된 저장소 산출물이라 안전하다.
- IIFE + `window` 패턴이 프로젝트 규약으로 고정된다. 언젠가 ESM으로 전환하면 이 ADR을 supersede하고 로더도 함께 바꾼다.
