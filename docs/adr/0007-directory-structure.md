---
status: Accepted
date: 2026-11-19
author: SungHyuk Park + ZCode
---

# ADR-0007: 디렉터 구조 — engine/ 분리, scripts/는 ops 전용

## Context

기능이 늘면서 root에 JS 파일이 9개(rules·prompt·chunking·lexicon-data·lexicon·fidelity·app·mcp-server·test) 쌓였다. "scripts/로 옮기자"는 제안이 있었지만, scripts/는 이미 ops 도구 전용(ref-check·eval·bootstrap-fewshot)이고 옮길 대상들의 성격이 제각각이다:

- **엔진 6개**(rules·prompt·chunking·lexicon-data·lexicon·fidelity) — 스크립트가 아니라 브라우저(`index.html` script 태그)와 서버(`lib/engine.mjs`)가 공유하는 **순수 로직 모듈**. `scripts/`에 넣으면 "ops 도구 디렉터"의 의미가 깨진다.
- **app.js** — UI 컨트롤러. `index.html` 옆에 있어야 한다.
- **serve.ts·mcp-server.mjs** — 실행 엔트리. root 배치가 배포·MCP 등록 커맨드(`bun mcp-server.mjs`)를 안정적으로 유지한다.
- **test.mjs** — bun 테스트 관례 상 root가 자연스럽다(`bun test.mjs`, package.json test 스크립트).

## Decision

1. **`engine/` 신설** — 엔진 모듈 6개를 이동한다. root의 JS는 9개 → 3개(app.js·test.mjs·mcp-server.mjs)로 줄고, 의존 방향이 한 줄로 정리된다:
   `engine/`(순수 로직, window IIFE) ← `index.html`(script 태그)·`lib/engine.mjs`(서버 로더) ← `serve.ts`·`mcp-server.mjs`·`scripts/*`.
2. **`scripts/`는 ops 전용**을 명문화한다 — 런타임 코드가 아닌 개발·운영 스크립트만 둔다. 엔진·UI·서버 코드는 넣지 않는다.
3. **`lib/`은 서버 사이드 공유 모듈**(engine 로더·eval-core) — 브라우저가 로드하는 파일은 여기 두지 않는다.
4. 이동으로 바뀌는 참조: `index.html` script src 6건, `lib/engine.mjs` 경로, `test.mjs` 로더 2곳, `scripts/ref-check.mjs`의 rules.js 경로, CI 문법 검사 경로 4건.

## Consequences

- 새 기능(엔진 모듈) 추가 시 root가 더러워지지 않고 `engine/`에 하나씩 붙는다. 레지스트리 참조(`ref-check`)·테스트 로더·CI 검사 목록에 같이 추가하는 것이 변경 체크리스트다.
- upstream 파일 경로를 기록한 기존 ADR·references.json의 adopted 서술은 당시 상태의 기록으로 유지한다(append-mostly) — 파일 위치 질의는 README 파일 구성이 담당한다.
- `engine/` 아래는 여전히 서버에서 정적 서빙된다(공개). 이들은 공개 규칙 그 자체라 비밀이 없으며, MIT 저장소에 공개되는 게 정책과 일치한다.
