# Humanize

AI가 쓴 한국어 글의 "AI 티"를 제거하는 윤문 웹앱. 왼쪽 패널에 원문을 넣고 **윤문하기**를 누르면 오른쪽 패널에 다듬어진 글이 표시됩니다.

윤문 규칙과 프롬프트는 단일 출처가 아니라 여러 출처로 구성되어 있으며, [REFERENCES.md](REFERENCES.md)로 관리합니다. 뼈대는 [epoko77-ai/im-not-ai](https://github.com/epoko77-ai/im-not-ai)(Humanize KR, MIT License)의 룰북·모놀리스 프롬프트이고, 여기에 2026-09부터 동종 저장소를 벤치마킹해 보강했습니다 — [IsaacEryn/humanizer-ko](https://github.com/IsaacEryn/humanizer-ko)(챗봇 잔여물 K 카테고리 등), [devswha/patina](https://github.com/devswha/patina)(마크업 잔재·MATTR 등 통계 탐지), [amondnet/yoonmoon](https://github.com/amondnet/yoonmoon)(과소 서술 보정). 웹 구현·서버·테스트는 이 저장소의 것입니다. 출처별 채택·보류 내역은 [`references.json`](references.json)이 단일 진실 공급원(SSOT)이며, 규칙마다 `src` 필드로 출처가 표기됩니다. 기능 업데이트 시에는 `bun scripts/ref-check.mjs`로 업스트림 드리프트를 먼저 확인하세요.

## 실행

빌드 과정이 없는 단일 TS 서버입니다. 기본 런타임은 **Bun**이며, Node 22+에서도 동일하게 동작합니다. 의존성이 없으므로 `bun install`은 필요 없습니다.

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

### 일반 공급자 (4종)

| `LLM_PROVIDER` | 처리 방식 | 기본 Base URL | 키 |
|----------------|----------|---------------|-----|
| `openai-compatible` | OpenAI 호환 전달 | `https://api.openai.com/v1` | `LLM_API_KEY` (또는 `OPENAI_API_KEY`) |
| `anthropic` | 네이티브 **Messages API**로 변환 (`x-api-key` + `anthropic-version`) | `https://api.anthropic.com` | `LLM_API_KEY` (또는 `ANTHROPIC_API_KEY`) |
| `gemini` | 네이티브 **generateContent**로 변환 (`x-goog-api-key`) | `https://generativelanguage.googleapis.com/v1beta` | `LLM_API_KEY` (또는 `GEMINI_API_KEY`/`GOOGLE_API_KEY`) |
| `custom` | 임의 OpenAI 호환 엔드포인트 — **`LLM_BASE_URL` 필수** | (직접 지정) | `LLM_API_KEY` |

- 기본 Base URL은 각 공급자의 공식 주소이며, `LLM_BASE_URL`로 덮어쓸 수 있습니다 (예: `custom` + `https://api.z.ai/api/coding/paas/v4`, 또는 Z.ai의 Anthropic 프로토콜 엔드포인트 `https://api.z.ai/api/anthropic` + `LLM_PROVIDER=anthropic`).
- 브라우저는 항상 OpenAI chat/completions 형식만 말하고, Anthropic·Gemini 프로토콜 변환은 서버가 합니다.

### 편의 프리셋 (위 4종의 축약형)

| `LLM_PROVIDER` | 실제 조합 |
|----------------|----------|
| `zai` | `openai-compatible` + `https://api.z.ai/api/paas/v4` + `ZAI_API_KEY` |
| `zai-coding` | `openai-compatible` + `https://api.z.ai/api/coding/paas/v4` + `ZAI_API_KEY` |
| `openai` | `openai-compatible` + `https://api.openai.com/v1` + `OPENAI_API_KEY` |
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
| **규칙 기반 (오프라인)** | quick-rules 중 문맥 없이 안전하게 적용 가능한 40여 개 패턴(이중 피동, "~에 있어서", 결산 어휘 남발, 분열문, 연결어미 쉼표, 챗봇 잔여물, 마크업 잔재, 평서 종결 단조 등)을 정규식·통계 엔진으로 탐지·수정 | 없음 |
| **LLM** | 원본 `humanize-monolith`의 철칙 9항 + 전체 룰북을 시스템 프롬프트로 실행. Z.ai/GLM·OpenAI·Anthropic·Gemini·DeepSeek 지원 | `.env` 또는 설정창의 키 |

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
| "공급자가 600초 안에 응답하지 않아 중단했습니다" (504) | 생성이 서버의 10분 상한을 넘긴 것입니다. 긴 원문(1만 자 이상)은 토큰 단위 생성 특성상 몇 분이 걸릴 수 있습니다. 원문을 절반씩 나눠 처리하거나, 더 빠른 모델(flash 계열)을 사용하세요. |
| 규칙 기반 모드에서 "원문 N건 → 결과 N건" 변화가 거의 없을 때 | 의도된 동작입니다. 46개 규칙 중 자동 수정 가능한 것(단순 치환)만 polish가 고치고, 나머지는 감지 전용(문맥 재작성 필요: 리듬·대구·관용구 등)이거나 임계 미달(예: 연결어미 쉼표는 3회+ 군집만 수정)입니다. 결과 아래 패턴 칩이 남은 이유이며, 문맥까지 다듬으려면 **LLM 모드**를 사용하세요. |

## 개발

빌드 과정이 없는 단일 페이지 + 단일 서버입니다.

```bash
bun test.mjs        # 스모크 테스트 — 규칙 ↔ references.json 레지스트리 일관성
bun serve.ts        # 로컬 실행 (node serve.ts 도 동일)
bun scripts/ref-check.mjs   # 출처 저장소 드리프트 점검
```

push(main)·PR마다 GitHub Actions가 스모크 테스트, `node --check app.js`, `bun build serve.ts`를 실행합니다(`.github/workflows/ci.yml`). 변경은 main에 직접 푸시하기보다 **브랜치 → PR → CI 통과 → 병합** 흐름을 권장합니다.
| "엔드포인트가 경로를 찾지 못했습니다(404)" | Base URL이 API 루트가 아닙니다. `/chat/completions`는 앱이 붙이므로 Base URL에는 넣지 마세요 (예: `https://api.openai.com/v1` ← O). 오류 메시지에 호출한 전체 주소와 공급자별 권장 URL이 표시됩니다. |
| "API 응답이 JSON이 아닙니다" | Base URL 경로가 잘못됐을 가능성이 큽니다. 공급자 문서의 API 루트까지 넣으세요 (예: `https://api.openai.com/v1`, `http://localhost:11434/v1`). |
| "API에 연결할 수 없습니다" / 연결 테스트 "✕ 연결 실패" | 서버(`bun serve.ts`)가 실행 중인지, Base URL 오타가 없는지 확인하세요. 브라우저는 로컬 서버로만 요청하므로 공급자 CORS 차단의 영향을 받지 않습니다. |
| reasoning 모델(o1·o3·gpt-5 계열) 오류 | 이 모델들은 `temperature` 파라미터를 받지 않아서, 앱이 자동으로 뺀 채 호출합니다. 그래도 오류가 있으면 모델명을 확인하세요. |
| 윤문이 너무 느림 | 추론 모델(GLM-5.3 계열, deepseek-reasoner 등)은 1~3분 걸릴 수 있습니다. `glm-4.6`, `deepseek-chat` 같은 비추론 모델로 바꿔보세요. |

## 파일 구성

```
serve.ts          로컬 서버 — 정적 서빙, CORS 프록시, .env 구성, Anthropic/Gemini 프로토콜 변환
index.html        화면 구조
style.css         스타일 (Pretendard, 반응형 2패널)
rules.js          규칙 엔진 — quick-rules 포팅(탐지/수정/변경률/등급), 규칙별 출처(src) 표기
prompt.js         LLM 모드 시스템 프롬프트 — monolith 철칙 + 룰북
app.js            UI 로직, LLM 클라이언트, 통계 렌더링
references.json   출처 레지스트리 (SSOT) — 출처별 채택/보류 내역, 규칙 ID 매핑, 점검일
REFERENCES.md     출처 관리 문서 — 요약 표, 업데이트 절차, 새 출처 추가 기준
scripts/ref-check.mjs  출처 검증 + 업스트림 드리프트 점검 (bun scripts/ref-check.mjs)
.env.sample       .env 템플릿 (공급자·키·모델 예시)
package.json      bun 스크립트 — bun run start / test / ref-check
test.mjs          규칙 엔진 + 레지스트리 매핑 테스트 (bun test.mjs)
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
