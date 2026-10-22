# Humanize

AI가 쓴 한국어 글의 "AI 티"를 제거하는 윤문 웹앱. 왼쪽 패널에 원문을 넣고 **윤문하기**를 누르면 오른쪽 패널에 다듬어진 글이 표시됩니다.

윤문 규칙과 프롬프트는 단일 출처가 아니라 여러 출처로 구성되어 있으며, [REFERENCES.md](REFERENCES.md)로 관리합니다. 뼈대는 [epoko77-ai/im-not-ai](https://github.com/epoko77-ai/im-not-ai)(Humanize KR, MIT License)의 룰북·모놀리스 프롬프트이고, 여기에 2026-09부터 동종 저장소를 벤치마킹해 보강했습니다 — [IsaacEryn/humanizer-ko](https://github.com/IsaacEryn/humanizer-ko)(챗봇 잔여물 K 카테고리 등), [devswha/patina](https://github.com/devswha/patina)(마크업 잔재·MATTR 등 통계 탐지), [amondnet/yoonmoon](https://github.com/amondnet/yoonmoon)(과소 서술 보정). 웹 구현·서버·테스트는 이 저장소의 것입니다. 출처별 채택·보류 내역은 [`references.json`](references.json)이 단일 진실 공급원(SSOT)이며, 규칙마다 `src` 필드로 출처가 표기됩니다. 기능 업데이트 시에는 `bun scripts/ref-check.mjs`로 업스트림 드리프트를 먼저 확인하세요.

## 데모

예시 텍스트를 넣고 **윤문하기**를 누르는 전체 흐름 — 규칙 기반 모드(오프라인, 배지로 변경률·패턴 감소 확인)와 LLM 모드(등급 판정)가 이어서 실행됩니다.

https://github.com/user-attachments/assets/e84758cd-00c1-4592-98ef-a89ca16c77d5

*영상: 예시 텍스트 입력 → 규칙 기반 모드(오프라인, 17건→8건·패턴 감소 53%) → LLM 모드(glm-5.3-flash, 17건→1건·A등급). README에서 바로 재생됩니다.*

## 실행

빌드 과정이 없는 단일 TS 서버입니다. **Bun 전용**으로 동작합니다 — 실행·테스트·CI 전부 Bun 기준이며, 의존성이 없으므로 `bun install`도 필요 없습니다.

```bash
bun serve.ts                 # 기본 포트 8765  (bun run start / bun run dev 와 동일)
bun serve.ts --port 3000     # 포트 지정 (-p 3000, 위치 인수 3000, PORT=3000 모두 가능)
bun serve.ts --host 0.0.0.0  # 바인딩 주소 지정 (기본 127.0.0.1)
# http://localhost:8765 접속
```

`serve.ts`는 정적 서빙 + CORS 프록시 + `.env` 구성을 모두 담당하며 기본적으로 `127.0.0.1`에서만 리슨합니다. 브라우저는 항상 이 로컬 서버로만 요청하고, 외부 공급자 호출은 서버가 대행하므로 공급자의 CORS 정책을 신경 쓸 필요가 없습니다.

## 빠른 시작 — `.env` 세 줄 설정 (권장)

```bash
cp .env.sample .env
```

```ini
LLM_PROVIDER=openai-compatible  # ① 공급자 선택
LLM_API_KEY=실제_키              # ② 선택한 공급자의 키
LLM_MODEL=gpt-4.1-mini          # ③ 모델
```

`bun serve.ts`로 재시작하면 끝입니다. **Base URL은 생략해도 됩니다** — 공급자별 공식 기본 주소가 자동 적용되고, 설정창에 직접 키를 넣는 방식보다 `.env` 방식이 우선합니다. 키 값은 브라우저로 전송되지 않습니다(브라우저가 키 없이 호출하면 서버가 인증 헤더를 주입).

설정창에서 **저장하고 닫기**를 누르면 그 값이 서버의 `.env` 파일에도 반영되어(`LLM_BASE_URL`·`LLM_MODEL`·`LLM_API_KEY`, 프로토콜이 어긋나면 `LLM_PROVIDER`까지 조정) 재시작 없이 즉시 적용되고, 다른 브라우저에서 열어도 같은 설정이 쓰입니다. 빈 API Key 칸으로 저장하면 기존 `.env` 키를 유지합니다. 이 쓰기 엔드포인트(`/env-save`)는 로컬(127.0.0.1) 연결이면서 같은 출처(Origin)인 요청만 받아, 웹페이지 경유 변조를 차단합니다. `.env`를 손으로 고쳤을 때는 여전히 재시작이 필요합니다.

## 지원 공급자

### 일반 공급자 (5종)

| `LLM_PROVIDER` | 처리 방식 | 기본 Base URL | 키 |
|----------------|----------|---------------|-----|
| `openai` | OpenAI 호환 전달 (공급자 고정) | `https://api.openai.com/v1` | `OPENAI_API_KEY` (또는 `LLM_API_KEY`) |
| `openai-compatible` | OpenAI 호환 전달 | `https://api.openai.com/v1` | `LLM_API_KEY` (또는 `OPENAI_API_KEY`) |
| `anthropic` | 네이티브 **Messages API**로 변환 (`x-api-key` + `anthropic-version`) | `https://api.anthropic.com` | `LLM_API_KEY` (또는 `ANTHROPIC_API_KEY`) |
| `gemini` | 네이티브 **generateContent**로 변환 (`x-goog-api-key`) | `https://generativelanguage.googleapis.com/v1beta` | `LLM_API_KEY` (또는 `GEMINI_API_KEY`/`GOOGLE_API_KEY`) |
| `custom` | 임의 OpenAI 호환 엔드포인트 — **`LLM_BASE_URL` 필수** | (직접 지정) | `LLM_API_KEY` |

- 기본 Base URL은 각 공급자의 공식 주소이며, `LLM_BASE_URL`로 덮어쓸 수 있습니다 (예: `custom` + `https://api.z.ai/api/coding/paas/v4`, 또는 Z.ai의 Anthropic 프로토콜 엔드포인트 `https://api.z.ai/api/anthropic` + `LLM_PROVIDER=anthropic`).
- 브라우저는 항상 OpenAI chat/completions 형식만 말하고, Anthropic·Gemini 프로토콜 변환은 서버가 합니다.
- `openai`와 `openai-compatible`의 처리 방식은 같습니다 — `openai`는 OpenAI 공식 주소·키 이름을 고정한 것(`OPENAI_API_KEY` 우선)이고, `openai-compatible`은 임의 호환 엔드포인트용입니다.

### 편의 프리셋 (공급자별 공식 조합 축약형)

| `LLM_PROVIDER` | 실제 조합 |
|----------------|----------|
| `zai` | `openai-compatible` + `https://api.z.ai/api/paas/v4` + `ZAI_API_KEY` |
| `zai-coding` | `openai-compatible` + `https://api.z.ai/api/coding/paas/v4` + `ZAI_API_KEY` |
| `deepseek` | `openai-compatible` + `https://api.deepseek.com` + `DEEPSEEK_API_KEY` |
| `bigmodel` | `openai-compatible` + `https://open.bigmodel.cn/api/paas/v4` + `ZAI_API_KEY` |

### 특수 값

| `LLM_PROVIDER` | 동작 |
|----------------|------|
| `none` | 서버 키 주입 비활성 — 브라우저 설정창에 저장한 키만 사용 |
| (미설정) | Base URL 호스트로 키 자동 감지 (위 편의 프리셋의 키 이름들 — `ZAI_API_KEY`, `ANTHROPIC_API_KEY` 등 — 을 인식) |

키 선택 규칙: 프리셋 모드에서는 **선택한 공급자의 키가 우선**이고, `LLM_PROVIDER` 미설정 시에는 요청 대상 호스트로 키를 고릅니다. OpenRouter·Ollama·LM Studio 등 목록에 없는 곳은 `openai-compatible`(또는 `custom`) + `LLM_BASE_URL` 조합으로 연결하세요.

`.env`가 구성되면 툴바 칩에 `● 키 설정됨 (.env) · 모델명`으로 표시됩니다. `/env-config`는 키 구성 여부와 공급자·기본 주소만 알려줄 뿐 **키 값 자체를 반환하지 않고**, 브라우저가 키 없이 호출하면 서버가 인증 헤더를 주입합니다.

> 💡 Z.ai 코딩 플랜의 `glm-5.3-flash`는 Usage Campaign으로 시기에 따라 키 없이도 호출이 허용될 수 있습니다(2026-09 기준, 언제든 바뀔 수 있음).
>
> ⏱ GLM-5.3 계열 등 추론 모델은 요청당 1~3분 걸릴 수 있습니다. 빠른 결과가 필요하면 `glm-4.6` 같은 비추론 모델을 사용하세요.

## 두 가지 모드

| 모드 | 동작 | 필요 것 |
|------|------|---------|
| **규칙 기반 (오프라인)** | quick-rules 중 문맥 없이 안전하게 적용 가능한 47개 패턴(이중 피동, "~에 있어서", 결산 어휘 남발, 분열문, 연결어미 쉼표, 챗봇 잔여물, 마크업 잔재, 평서 종결 단조, 접속사 문단 밀집 등)을 정규식·통계 엔진으로 탐지·수정 | 없음 |
| **LLM** | 원본 `humanize-monolith`의 철칙 9항 + 전체 룰북을 시스템 프롬프트로 실행. Z.ai/GLM·OpenAI·Anthropic·Gemini·DeepSeek 지원. 15,000자 이상 원문은 장문 청킹으로 자동 분할 처리(아래 청킹 절) | `.env` 또는 설정창의 키 |

- 규칙 기반 모드는 결정론적이지만 **탐지 전용 패턴**(구조 재편·리듬 조정·완곡 변주 등 문맥이 필요한 것)은 고치지 못하고 플래그만 표시합니다. 등급 A/B를 목표로 하면 LLM 모드를 사용하세요.
- 두 모드 모두 결과를 로컬 엔진으로 재검증해 **변경률 / AI 티 신호 before→after / S1·S2 세부 / 등급(LLM 모드)** 배지를 표시합니다.
- 변경률은 원본 `metrics_v2.change_rate()`(`1 − SequenceMatcher.ratio()`)와 같은 공식의 토큰 단위 근사치입니다.

## LLM 모드 설정

두 가지 방법 중 하나를 쓰면 됩니다.

**① `.env` (권장)** — 위의 빠른 시작대로 공급자·키·모델을 지정합니다. 설정창에 키를 입력할 필요가 없습니다.

**② 설정창 (⚙)** — 브라우저에 저장하는 방식:

- **Base URL**: 공급자 공식 URL을 **그대로** 입력합니다 (예: `https://api.z.ai/api/coding/paas/v4`, `https://api.anthropic.com`, `https://generativelanguage.googleapis.com/v1beta`). 입력창 자동완성 목록에서 골라도 됩니다. `/chat/completions`는 앱이 붙입니다.
- **API Key**, **모델명** — [연결 테스트]로 확인 후 [저장하고 닫기].
- API 키는 브라우저 `localStorage`에만 저장됩니다. 공용 컴퓨터에서는 저장하지 마세요.
- 키가 맞는지 확신이 없으면 **[키 진단]** 버튼: 입력한 키를 8개 엔드포인트(Z.ai 일반/코딩, 빅모델 일반/코딩, OpenAI, Anthropic, Gemini, DeepSeek)에 순서대로 대조해 어디서 승인되는지 알려주고, 승인 조합을 찾으면 Base URL을 자동으로 채웁니다.
- 설정 저장 시 **저장 위치(origin)** 와 **저장된 키(마스킹)** 가 표시되어 어느 탭에 저장됐는지 바로 확인할 수 있습니다.

## 문제 해결

| 증상 | 원인과 해결 |
|------|------------|
| "API 키가 없습니다" 오류 | `.env`와 설정창 어디에도 키가 없다는 뜻입니다. `.env`의 `LLM_API_KEY`(또는 공급자별 키)를 채우고 서버를 재시작하거나, ⚙ 설정창에서 키를 저장하세요. `file://` 탭과 `http://localhost` 탭은 저장소가 다르고, 시크릿 모드에서는 저장이 유지되지 않습니다. |
| 툴바의 LLM 상태 칩 | LLM 모드에서 `● 키 저장됨 · 모델명` / `● 키 설정됨 (.env) · 모델명` / `○ API 키 없음` 중 하나가 항상 표시됩니다. 실행이 실패하면 먼저 이 칩을 보세요. |
| "API 오류 401" / "API가 키를 거부했습니다" | 요청은 게이트웨이에 도달했고 키가 거부된 것입니다. ⚙ 설정창의 **[키 진단]**으로 어느 공급자 조합이 승인하는지 확인하세요. 모두 거부되면 키가 만료·잘림된 것이므로 각 공급자 콘솔에서 재발급하세요. Z.ai 코딩 플랜 키는 **GLM Coding Plan > Plan Overview > API Key**에서 발급합니다(팀 플랜 키는 일반 키와 호환되지 않음). ZCode 등 다른 도구에 저장된 토큰은 만료된 OAuth 토큰일 수 있습니다. |
| "API 오류 404 / model_not_found" | 모델명이 해당 엔드포인트에 없습니다. 모델 ID 대소문자 규칙에 유의하세요 — z.ai는 소문자(`glm-5.3-flash`), Anthropic/Gemini/DeepSeek도 문서의 정확한 ID를 사용합니다. |
| "API가 오류를 반환했습니다: …" | 엔드포인트가 HTTP 200과 함께 오류 본문을 반환한 것입니다(일부 게이트웨이 방식). 메시지 내용(모델 없음, 쿼터 초과 등)을 그대로 따라가면 됩니다. |
| "응답에서 윤문 본문을 찾지 못했습니다 (finish_reason: …)" | 응답은 왔지만 본문이 비었습니다. `length`면 길이 제한으로 잘린 것이고, `content_filter`면 필터에 걸린 것입니다. 오류에 응답 본문 일부가 함께 표시됩니다. |
| "공급자가 600초 안에 응답하지 않아 중단했습니다" (504) | 생성이 서버의 10분 상한을 넘긴 것입니다. 15,000자 이상은 청킹으로 자동 분할되지만 청크 하나(최대 9,000자)도 추론 모델에서는 수 분 걸릴 수 있습니다. 더 빠른 모델(flash 계열)을 사용하거나 원문을 절반으로 나눠 시도하세요. |
| 장문을 넣었더니 API 호출이 여러 번 발생한다 | 의도된 동작입니다 — 장문 청킹(위의 「장문 청킹」 절). 본문이 청크 수만큼 병렬 호출되고 결과가 자동 병합·검증됩니다. |
| 규칙 기반 모드에서 "원문 N건 → 결과 N건" 변화가 거의 없을 때 | 의도된 동작입니다. 47개 규칙 중 자동 수정 가능한 것(단순 치환)만 polish가 고치고, 나머지는 감지 전용(문맥 재작성 필요: 리듬·대구·관용구 등)이거나 임계 미달(예: 연결어미 쉼표는 3회+ 군집만 감지·수정)입니다. 결과 아래 패턴 칩이 남은 이유이며, 문맥까지 다듬으려면 **LLM 모드**를 사용하세요. |
| "엔드포인트가 경로를 찾지 못했습니다(404)" | Base URL이 API 루트가 아닙니다. `/chat/completions`는 앱이 붙이므로 Base URL에는 넣지 마세요 (예: `https://api.openai.com/v1` ← O). 오류 메시지에 호출한 전체 주소와 공급자별 권장 URL이 표시됩니다. |
| "API 응답이 JSON이 아닙니다" | Base URL 경로가 잘못됐을 가능성이 큽니다. 공급자 문서의 API 루트까지 넣으세요 (예: `https://api.openai.com/v1`, `http://localhost:11434/v1`). |
| "API에 연결할 수 없습니다" / 연결 테스트 "✕ 연결 실패" | 서버(`bun serve.ts`)가 실행 중인지, Base URL 오타가 없는지 확인하세요. 브라우저는 로컬 서버로만 요청하므로 공급자 CORS 차단의 영향을 받지 않습니다. |
| reasoning 모델(o1·o3·gpt-5 계열) 오류 | 이 모델들은 `temperature` 파라미터를 받지 않아서, 앱이 자동으로 뺀 채 호출합니다. 그래도 오류가 있으면 모델명을 확인하세요. |
| 윤문이 너무 느림 | 추론 모델(GLM-5.3 계열, deepseek-reasoner 등)은 청크당 1~3분 걸릴 수 있습니다. `glm-4.6`, `deepseek-chat` 같은 비추론 모델로 바꿔보세요. |

## HTTP API

규칙 엔진을 HTTP로도 쓸 수 있습니다(`bun serve.ts` 실행 중, JSON 본문, CORS 허용). 모두 LLM 호출이 없는 결정적 엔드포인트이며, MCP 도구와 같은 페이로드를 씁니다.

| 엔드포인트 | 본문 | 반환 |
|------------|------|------|
| `POST /api/analyze` | `{text}` | AI 티 패턴 감지 결과(`findings`, S1/S2 합계) |
| `POST /api/polish` | `{text}` | 윤문문 + `applied`·before/after·`changeRate`·`grade` |
| `POST /api/prompt` | `{genre?}` (`auto/column/report/blog/formal`) | LLM 모드 시스템 프롬프트 |
| `POST /api/chunk` | `{text, target?, max?}` | 장문 청킹 계획(아래 청킹 절 참고) |
| `POST /api/merge` | `{original, rewritten[], target?, max?}` | 병합문 + 유실/증식 경고 + 재검증 통계 |

```bash
curl -s -X POST localhost:8765/api/polish \
  -H 'Content-Type: application/json' \
  -d '{"text":"중요한 것은 신뢰다. 필요한 것은 균형이다."}'
```

`analyze`/`polish`/`prompt`는 30,000자(웹 UI 상한과 동일), `chunk`/`merge`는 200,000자까지 받습니다.

## 장문 청킹 (LLM 모드)

15,000자가 넘는 원문은 [im-not-ai](https://github.com/epoko77-ai/im-not-ai)의 청킹 파이프라인(`prepare_monolith_input.py` + `reassemble_chunks.py`)을 JS로 포팅해 자동으로 나눠 처리합니다.

- **분할**: 헤딩 줄(`#`, `N.`, `제N장`, `가.` 등) 앞 강제 컷 + 빈 줄 문단 단위 그리디 패킹(목표 7,000자, 상한 9,000자, 4,000자 초과 문단은 문장 경계 폴백). 청크는 원문 offset 구간이라 **연결하면 원문과 정확히 일치**하고(무손실 self-check), 청크가 헤딩으로 끝나는 일은 구조적으로 금지됩니다. 말미 각주 블록(`1)` `[\d+]`)은 passthrough로 빼서 LLM에 보내지 않습니다.
- **처리**: 본문 청크만 병렬 호출(최대 4개, upstream과 동일), 각 청크 앞에 `[청크 컨텍스트]` 헤더(서두·결말 새로 만들기 금지)를 붙입니다. 시스템 프롬프트(룰북)는 청크 수와 무관하게 하나만 씁니다 — upstream이 밝힌 토큰 폭발의 주범이 콜마다 룰북 재로드였기 때문입니다.
- **병합·검증**: 원문 청크의 앞뒤 공백을 복원해 붙이고(원문을 그대로 재투입하면 재조립 = 원문), 청크별 글자 수 대사로 원문 절반 이하는 "유실 의심", 2배 초과는 "증식 의심" 경고를 냅니다.

upstream 단서에 따라 청크를 작게 만드는 것(구형 웹앱의 1,800자 등)은 의도적으로 하지 않습니다 — 큰 모델은 대구·리듬 같은 문단 횡단 신호를 잡아야 하므로 청크가 커야 합니다.

## MCP 서버

같은 엔진을 MCP 도구로 노출합니다(제로 디펜던시 stdio 구현, `mcp-server.mjs`).

```bash
claude mcp add humanize -- bun mcp-server.mjs
# 또는 설정 JSON: { "command": "bun", "args": ["mcp-server.mjs"] }
```

| 도구 | 설명 |
|------|------|
| `humanize_analyze` | AI 티 패턴 감지(47개 규칙) |
| `humanize_polish` | 규칙 기반 윤문 + 변경률·등급 |
| `humanize_prompt` | 장르별 시스템 프롬프트 반환 |
| `humanize_chunk` | 장문 무손실 분할(청크별 컨텍스트 헤더 포함) |
| `humanize_merge` | 청크별 윤문 결과 병합·검증(유실/증식 경고) |

에이전트 활용 패턴: `humanize_prompt`로 시스템 프롬프트를 받고, 길면 `humanize_chunk`로 나눠 각 청크를 자기 모델로 윤문한 뒤 `humanize_merge`로 합치고 경고를 확인합니다.

## 개발

빌드 과정이 없는 단일 페이지 + 단일 서버입니다.

```bash
bun test.mjs        # 스모크 테스트 — 규칙 ↔ references.json 레지스트리, 청킹, MCP 핸들러
bun serve.ts        # 로컬 실행
bun scripts/ref-check.mjs   # 출처 저장소 드리프트 점검
```

push(main)·PR마다 GitHub Actions가 스모크 테스트(`bun test.mjs`), 문법 검사(`bun build`로 app.js·chunking.js·mcp-server.mjs), `bun build serve.ts`를 실행합니다(`.github/workflows/ci.yml`). 변경은 main에 직접 푸시하기보다 **브랜치 → PR → CI 통과 → 병합** 흐름을 권장합니다.

아키텍처 결정 기록(ADR)과 기능 설계 문서는 [docs/](docs/README.md)에서 관리합니다. 출처별 채택 내역은 `references.json`(SSOT), 아키텍처 결정은 docs/, 사용자 안내는 이 문서가 담당합니다.

## 파일 구성

```
serve.ts          로컬 서버 — 정적 서빙, /api/* 규칙 엔진, CORS 프록시, .env 구성, 프로토콜 변환
index.html        화면 구조
style.css         스타일 (Pretendard, 반응형 2패널)
rules.js          규칙 엔진 — quick-rules 포팅(탐지/수정/변경률/등급), 규칙별 출처(src) 표기
prompt.js         LLM 모드 시스템 프롬프트 — monolith 철칙 + 룰북
chunking.js       장문 청킹 — im-not-ai 분할/병합 파이프라인 JS 포팅 (무손실 self-check 포함)
app.js            UI 로직, LLM 클라이언트(청킹 경로 포함), 통계 렌더링
mcp-server.mjs    MCP stdio 서버 — 도구 5개 (제로 디펜던시 JSON-RPC)
lib/engine.mjs    rules/prompt/chunking 로더 — serve.ts와 mcp-server.mjs 공용
references.json   출처 레지스트리 (SSOT) — 출처별 채택/보류 내역, 규칙 ID 매핑, 점검일
REFERENCES.md     출처 관리 문서 — 요약 표, 업데이트 절차, 새 출처 추가 기준
docs/             설계 기록 — ADR(아키텍처 결정)·설계 문서·인덱스
scripts/ref-check.mjs  출처 검증 + 업스트림 드리프트 점검 (bun scripts/ref-check.mjs)
.env.sample       .env 템플릿 (공급자·키·모델 예시)
package.json      bun 스크립트 — bun run start / test / ref-check
test.mjs          규칙 엔진 + 청킹 + MCP + 레지스트리 매핑 테스트 (bun test.mjs)
```

`.env`는 커밋 대상이 아닙니다(`.gitignore` 참고).

## 설계 원칙 (원본 저장소에서 계승)

- **의미 불변**: 사실·수치·날짜·고유명사·직접 인용·법률 조문·영어 약어(LLM·GPU·API)는 수정하지 않습니다.
- **빼기 전용**: 원문에 없던 표현을 새로 넣지 않습니다.
- **과윤문 가드**: 변경률 30% 초과 경고, 50% 이상은 등급 D 처리.
- **register 보존**: 격식체↔구어체 전환을 하지 않습니다.
- 원본 저장소와 마찬가지로 이 도구는 **AI 탐지기 우회를 보장하는 진실성 도구가 아닙니다.** 학술 제출물 등 소속 기관 규정을 확인 후 사용하세요.

## 라이선스

규칙·프롬프트의 뼈대 출처인 [im-not-ai](https://github.com/epoko77-ai/im-not-ai)는 MIT License입니다(벤치마크 출처들의 라이선스는 [`references.json`](references.json)의 `license` 필드에 기록). 이 프로젝트의 코드는 MIT로 배포합니다.
