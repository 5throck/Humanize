---
lang: ko
---

# 장문 청킹 포팅 + HTTP API + MCP 서버 설계

| Field | Value |
|-------|-------|
| Date | 2026-10-22 |
| Status | accepted (PR #8 병합) |
| Related | ADR-0002 (제로 디펜던시), ADR-0003 (청킹 충실 포팅), ADR-0004 (단일 엔진 로더), `references.json` im-not-ai `adopted[].date=2026-10-22` |
| Upstream 기준 | epoko77-ai/im-not-ai — `scripts/prepare_monolith_input.py`, `scripts/reassemble_chunks.py`, `skills/humanize-korean/SKILL.md` (Heavy 경로 P2) |

## Problem

세 가지 결핍이 겹쳐 있었다.

1. **장문 한계** — LLM 모드는 원문 전체를 단일 호출로 보낸다. 1만 자 이상에서 길이 제한 잘림·600초 타임아웃이 잦았고, upstream이 밝혔듯 콜마다 룰북 재로드가 토큰 폭발의 주범이다. upstream에는 검증된 청킹 파이프라인이 있지만 JS 웹앱에는 포팅되어 있지 않았다.
2. **프로그래밍 접근 부재** — 규칙 엔진(47개 규칙)이 브라우저 `<script>` 안에만 존재해, 스크립트·에이전트가 analyze/polish를 쓸 방법이 없었다.
3. **MCP 부재** — Claude Code 등 에이전트 호스트가 같은 기능을 도구로 쓸 수 없었다.

## Change Design

### D1 — chunking.js: upstream 청킹 파이프라인의 충실 포팅

원본 Python을 읽고 알고리즘·상수·경고 문구까지 이식했다 (결정 근거는 ADR-0003).

- 분할: 말미 각주 블록(`^\d+\)\s`, `^\[\d+\]\s` 역방향 스캔) 제외 → 헤딩 줄 강제 컷(연속 헤딩 런 억제) → 세그먼트별 문단 그리디 패킹(빈 줄 런 **끝**에서 절단 — 구분 개행은 앞 청크 꼬리에 부착) → 4,000자 초과 문단은 문장 경계 폴백.
- 불변식: 청크는 offset `[start, end)` 구간, 전체 연결 === 원문 (self-check 실패 시 `ChunkingError`).
- 헤딩 글루: 현재 청크가 헤딩으로 끝나는 동안은 크기와 무관하게 이어붙임.
- 청크 헤더: `[청크 컨텍스트] …서두·결말·전환 문구를 새로 만들지 말 것…` (upstream 문구 이식, 청크가 헤딩으로 시작하면 병합 금지 행 추가).
- 병합: 공백 복원(trim 후 원문 청크의 leading/trailing 공백 재부착), 빈 결과는 유실 사고 오류, 비율 <0.5 유실 의심 / >2.0 증식 의심 경고, plan 타일링 재검증.
- 인터페이스: `plan(text, opts?) → { recommended, reason, target, max, chunks[], warnings }`, `merge(original, plan, parts) → { text, warnings, chunks }` (parts는 **본문 청크 순서**만 — passthrough는 호출자가 더미를 넣지 않는다).

### D2 — app.js LLM 모드 청킹 경로

15,000자 이상 + `plan.recommended`일 때만 청킹 경로로 분기한다. 본문 청크를 워커 풀로 병렬 호출(**동시성 4, upstream P2와 동일**), 각 호출의 user 메시지는 `청크 헤더 + 청크 본문`, 시스템 프롬프트(룰북)는 공유 — 콜마다 재로드하지 않는다. 단일 호출 경로의 견고한 응답 파싱(게이트웨이 오류·404·인증 실패·fenced wrapper 제거)은 `llmChatOnce`로 추출해 두 경로가 공유한다. 병합 후 유실/증식 경고는 통계 영역에 그대로 노출한다(오류가 아니라 검토 힌트 — upstream `--strict=false` 동작).

### D3 — serve.ts `/api/*` 5종 + lib/engine.mjs

- `lib/engine.mjs`: 브라우저 IIFE 3개를 샌드박스로 로드하는 공용 로더 (ADR-0004).
- 엔드포인트: `analyze`(감지), `polish`(윤문+등급), `prompt`(장르별 시스템 프롬프트), `chunk`(분할 계획), `merge`(병합+재검증). `merge`는 원문과 target/max만 받아 plan을 **재계산**한다 — plan이 결정적이므로 청크 순서가 재현되고, merge 내부 타일링 검증이 원문 대조를 보장한다(페이로드에서 plan 왕복 불필요).
- 상한: analyze/polish/prompt 30,000자(UI `MAX_CHARS`와 동일), chunk/merge 200,000자 — 청킹은 장문이 존재 이유이므로 상한을 분리.
- 오류 매핑: 검증·도메인 오류(ChunkingError 포함)는 400, 크기 초과는 413, 알 수 없는 경로는 404.

### D4 — mcp-server.mjs: 제로 디펜던시 stdio MCP

- newline-delimited JSON-RPC 2.0, `initialize`(클라이언트가 제시한 protocolVersion 에코)/`notifications`(무음)/`ping`/`tools/list`/`tools/call`만 구현. stdout은 프로토콜 프레임 전용, 로그는 stderr.
- 도구 5개는 `/api/*`와 동일 페이로드·동일 응답. 도메인 오류(유실 사고, 크기 초과)는 프로토콜 오류(-32xxx)가 아니라 `result.isError=true` 결과로 반환해 호스트가 모델에 피드백으로 보여준다.
- 직접 실행 판별(`import.meta.url === pathToFileURL(argv[1])`)로 테스트 import 시 프로토콜 루프가 기동되지 않는다.

### D5 — 테스트·CI

- `test.mjs`: 청킹 20케이스(무손실 왕복, 병합 항등, 유실/증식 경고, 빈 결과 중단, 개수 불일치, 각주 passthrough, 권장 임계, 문장 폴백, 쪼갤 수 없는 초장 런 경고, 타일링 위반) + MCP 11케이스(핸드셰이크, tools/list 5종, analyze/polish/prompt/chunk 호출, isError, -32601/-32602, 크기 초과). 총 215체크.
- CI: `node --check chunking.js`, `node --check mcp-server.mjs` 추가.

## Alternatives Considered

| 대안 | 기각 사유 |
|------|----------|
| 공식 MCP SDK 도입 | 제로 디펜던시 원칙(ADR-0002). 필요한 프로토콜 면이 작아 직접 구현 비용이 의존성 비용보다 작다 |
| 1,800자 소청크(flash-lite 방식) | upstream 명시적 금지 — 큰 모델은 문단 횡단 신호(대구·리듬)를 잡아야 한다 (ADR-0003) |
| 서버 사이드 LLM 폴리싱 엔드포인트(`/api/llm-polish`) | `/llm/chat/completions` 프록시가 이미 호출을 대행하므로 이중화. 청킹 지식은 API/MCP 도구로 노출해 호출자가 자기 모델로 처리하는 것이 역할 분리상 명확하다 |
| merge에서 plan을 클라이언트가 되돌려 받는 방식 | 페이로드가 커지고 변조 여지가 생긴다. 결정적 plan 재계산 + 타일링 검증이 더 안전하다 |

## Verification

- `bun test.mjs` 215체크 ALL PASS, `bun scripts/ref-check.mjs --local` VALIDATION PASS.
- 실서버 스모크: 5개 엔드포인트 curl(청킹→병합 왕복 항등 포함), `/api/nope` 404 확인.
- MCP: stdin으로 initialize → tools/list → tools/call 확인, 로그가 stderr로만 나오는지 확인.
- CI 그린 후 PR #8 병합(머지 커밋).
