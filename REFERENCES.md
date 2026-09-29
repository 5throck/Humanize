# References — 출처 레지스트리

이 프로젝트의 규칙·프롬프트·테스트가 **어느 저장소에서 왔는지**, 무엇을 채택했고 무엇을 보류했는지 관리하는 문서입니다. 출처는 하나(im-not-ai)가 아니라 여러 곳이며, 앞으로도 늘어납니다.

## 파일 역할

| 파일 | 역할 |
|---|---|
| [`references.json`](references.json) | **SSOT (단일 진실 공급원).** 출처 목록, 채택 항목 ↔ 규칙 ID 매핑, 보류 사항(deferred), 점검일. 모든 수정은 여기서. |
| `rules.js` | 각 규칙의 `src: ["출처id", …]` 필드로 코드 안에 출처를 직접 표기. **src가 없으면 기본 출처 `im-not-ai`**. |
| `scripts/ref-check.mjs` | 레지스트리 검증 + 업스트림 드리프트 점검 (아래 참고). |
| `test.mjs` | 레지스트리 매핑 유효성을 테스트 스위트에 포함 — 규칙 이름이 바뀌면 매핑이 깨진 걸 즉시 잡아냅니다. |

## 현재 출처 요약

| id | 저장소 | role | 우리가 가져온 것 |
|---|---|---|---|
| `im-not-ai` | [epoko77-ai/im-not-ai](https://github.com/epoko77-ai/im-not-ai) | **upstream** | 룰북(A~J) 전체, 철칙·자체검증·등급 체계 (기본 출처) |
| `isaac-humanizer-ko` | [IsaacEryn/humanizer-ko](https://github.com/IsaacEryn/humanizer-ko) | benchmark | A-8 보여지/쓰여지, K 카테고리(챗봇 잔여물), 2-pass 자문 루프, 군집 원칙 |
| `patina` | [devswha/patina](https://github.com/devswha/patina) | benchmark | J-4 마크업 잔재, J-5 구분선 과다, E-3 평서 단조, E-4 MATTR, 극성 반전 스캔 |
| `yoonmoon` | [amondnet/yoonmoon](https://github.com/amondnet/yoonmoon) | benchmark | 과소 서술 보정 패스 (프롬프트 절차 4) |
| `dotori-korean-humanizer` | [dotoricode/korean-humanizer](https://github.com/dotoricode/korean-humanizer) | reference | 오탐 화이트리스트 발상, eval fixture 방식 |
| `hjongc-humanizer-kr` | [hjongc/humanizer-kr](https://github.com/hjongc/humanizer-kr) | reference | 미채택 — 원본과 고도 중복 (사유는 references.json) |

세부 채택 내역(어떤 규칙·프롬프트 라인에 반영됐는지)과 **보류 목록(deferred)** — 다음 기능 업데이트 때 다시 검토할 후보 — 은 `references.json`의 각 출처 항목을 참고하세요.

## 기능 업데이트 시 사용법

1. **드리프트 확인** — `bun scripts/ref-check.mjs` (`bun run ref-check`)
   각 출처의 최신 푸시일과 key_files 마지막 커밋일을 GitHub API로 조회해, `last_checked` 이후 변경이 있으면 표시합니다. (오프라인이면 `--local`로 검증만.)
2. **변경된 출처 재검토** — 드리프트가 표시된 출처의 `key_files`를 다시 읽고, `adopted`(채택)와 `deferred`(보류) 목록을 검토합니다. 보류 목록이 이번에 채택 가능해졌는지가 핵심 질문입니다.
3. **새 기능 반영** — 출처가 기존 목록에 있으면 그 출처 항목의 `adopted`에 추가하고, 없으면 새 출처를 `sources`에 추가합니다. 규칙을 추가/수정했다면 `rules.js`의 `src` 필드와 `adopted[].rules` 매핑을 함께 갱신합니다.
4. **검증** — `bun test.mjs`와 `bun scripts/ref-check.mjs --local`. 매핑이 실제 규칙 ID와 일치하는지, `src` id가 레지스트리에 있는지 자동 확인됩니다.
5. **점검일 갱신** — 확인한 날짜로 해당 출처의 `last_checked`를 바꿉니다. 이 값이 드리프트 판정 기준이 됩니다.

## 새 출처 추가 기준

- 한국어 윤문·AI-tell 탐지·텍스트 인간화와 직접 관련된 공개 저장소/문서
- 라이선스 확인 가능 (MIT 선호, 비MIT면 `license` 필드에 명시)
- "어디에 무엇을" 반영했는지 `adopted`에 규칙 ID·프롬프트 섹션 단위로 기록 가능할 것
- 검토만 하고 채택하지 않았어도 `role: "reference"` + `not_adopted_reason`으로 기록 — 나중에 같은 후보를 재조사하는 낭비를 막습니다

## 라이선스

원본 [im-not-ai](https://github.com/epoko77-ai/im-not-ai)는 MIT License입니다. 벤치마크 출처들의 라이선스는 각 저장소에서 확인하세요(레지스트리 `license` 필드에 기록).
