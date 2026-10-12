# refpin

[English](README.md) | 한국어

단일 파일의 코드 구간을 JSON 앵커로 저장하고, 최신 소스에서 위치와 내용 변화를 확인하는 JavaScript / TypeScript 라이브러리.

주요 용도: 에이전트 메모리, 코드 리뷰, 문서의 코드 참조, 저장된 검색 결과의 최신성 확인.

- 동기 API: `createAnchor()`와 `checkAnchor()`
- `unchanged`, `moved`, `changed`, `missing`, `ambiguous` 판정
- 수정된 구간의 현재 위치와 짧은 줄 단위 diff
- Node.js 22+, 현대 브라우저, ESM / CommonJS / TypeScript
- 런타임 의존성 0개

## 시작하기

```sh
npm install refpin
```

```js
import { createAnchor, checkAnchor } from "refpin";

const source = [
  "function validateSession(session) {",
  "  if (!session) return false;",
  "  return session.expiresAt > Date.now();",
  "}",
].join("\n");

const anchor = createAnchor(source, {
  file: "src/auth.ts",
  startLine: 1,
  endLine: 4,
});

checkAnchor(anchor, source);
// { status: "unchanged", startLine: 1, endLine: 4 }

checkAnchor(anchor, "// new header\n" + source);
// { status: "moved", startLine: 2, endLine: 5 }

const result = checkAnchor(anchor, source.replace(" > ", " >= "));
if (result.status === "changed") {
  console.log(result.startLine, result.endLine);
  console.log(result.diff.text);
  console.log(result.diff.truncated); // Whether the preview was truncated.
}
```

CommonJS에서 동일한 API 사용.

```js
const { createAnchor, checkAnchor } = require("refpin");
```

브라우저 번들러에서 동일한 import 사용. 번들러 없이 사용할 경우 `dist/esm/` 전체를 서버에서 제공하고 `index.js`를 import. ES2022와 `TextEncoder` 지원 환경 필요.

```js
import { createAnchor, checkAnchor } from "/vendor/refpin/esm/index.js";
```

## 저장과 복원

앵커 구성: 버전, 파일 식별자, 원래 줄 범위, 코드 내용, 해시, 앞뒤 문맥. JSON으로 저장 가능한 일반 객체.

```js
const saved = JSON.stringify(anchor);
const restored = JSON.parse(saved);
const latest = checkAnchor(restored, updatedSource);
```

`file`은 식별용 메타데이터. 같은 파일의 최신 소스 전달과 저장소 선택은 호출자 담당. 검사 중 원래 앵커의 변경 없음.

## API

### `createAnchor(source, options)`

| 옵션 | 설명 | 기본값 |
|---|---|---|
| `file` | 비어 있지 않은 파일 식별자 | 필수 |
| `startLine` | 시작 줄, 1부터 시작 | 필수 |
| `endLine` | 끝 줄, 해당 줄 포함 | 필수 |
| `contextLines` | 앞뒤 각각 저장할 문맥 줄 수, 0 이상 | `3` |

선택 내용의 UTF-8 FNV-1a 64-bit 해시를 `fnv1a64:` 접두사와 함께 저장. 정확 일치 판정 시 실제 줄 내용 비교.

### `checkAnchor(anchor, updatedSource, options?)`

`options.maxDiffLines`: hunk 헤더를 포함한 diff 표시 줄 수. 기본값 `20`, 허용 범위는 1 이상의 정수.

| 상태 | 의미 | 추가 필드 |
|---|---|---|
| `unchanged` | 유일한 정확 일치가 원래 줄 범위에 있음 | `startLine`, `endLine` |
| `moved` | 유일한 정확 일치가 다른 줄 범위에 있음 | `startLine`, `endLine` |
| `changed` | 문맥·내용으로 수정된 후보 하나를 찾음 | `startLine`, `endLine`, `diff` |
| `missing` | 충분한 근거로 구간을 찾지 못함 | 없음 |
| `ambiguous` | 서로 다른 발생 지점에 후보가 여러 개 있음 | `candidates: { startLine, endLine }[]` |

`diff` 형식: `{ text: string, truncated: boolean }`. 변경 주변 2줄의 문맥 포함. `-`는 삭제, `+`는 추가. `truncated`가 참이면 일부 내용이 생략된 표시용 미리보기이며, 적용용 patch로 사용 불가.

```ts
import type { CodeAnchor, AnchorResult, LineRange } from "refpin";
```

`AnchorResult`는 `status`를 기준으로 타입 구분 가능. `missing` 결과에는 줄 번호 필드 없음.

## 판정 규칙

1. 정확 일치 우선: 새 파일 전체에서 같은 연속 줄 구간 탐색. 여러 곳에 있으면 원래 위치에 하나가 남아 있어도 `ambiguous` 반환.
2. 문맥 탐색: 충분한 앞뒤 문맥 사이에서 내용이 교체된 구간을 `changed` 후보로 판단. 공백 제외 8자 미만의 문맥은 단독 근거에서 제외.
3. 유사도 탐색: 정확 일치가 없으면 줄 삽입·삭제와 줄 내용의 bigram 유사도 비교. 후보 기준은 문맥이 남아 있으면 0.65 이상, 없으면 0.85 이상.
4. 후보 선택: 원래 줄 번호와의 거리를 선택 근거에서 제외. 같은 발생 지점의 겹치는 경계 변형은 병합하고, 떨어진 후보는 모두 반환.

`missing`은 충분한 근거로 재탐색하지 못한 상태. 삭제된 경우 외에 큰 재작성, 문맥 소실, 큰 길이 변화도 포함. 수정 후보의 최대 길이는 `max(originalLineCount * 2, originalLineCount + 3)`. 유사도만으로 코드의 의미나 함수의 동일성을 보장하지 않음.

첫 버전의 추적 범위는 전달된 단일 파일 내부. 파일 간 이동과 심볼 이름 기반 추적은 지원 범위 밖.

### 줄과 공백

- LF, CRLF, 단독 CR을 동일하게 처리.
- 마지막 개행 자체는 변경 판정에서 제외. `a\n`은 1줄, `a\n\n`은 2줄.
- 공백과 들여쓰기 보존. 해당 변경도 `changed`로 판정 가능.
- 빈 소스는 0줄. `\n`은 빈 줄 하나.
- 주변 문맥만 바뀌고 선택 내용과 줄 범위가 같으면 `unchanged`.

### 오류

- `TypeError`: 잘못된 소스, 옵션, 앵커 구조, 지원하지 않는 버전, 내용과 맞지 않는 해시.
- `RangeError`: 유효하지 않은 줄 범위나 숫자 옵션.

## 개발 및 검증

```sh
npm ci                 # Install the locked development dependencies.
npm run check          # Run all release checks below.
npm test               # Build ESM/CJS and run tests.
npm run typecheck      # Check library and ESM/CJS consumer types.
npm run test:package   # Install a tarball in an isolated consumer and verify it.
npm pack --dry-run     # Inspect package contents.
npm publish --dry-run  # Exercise publication hooks without publishing.
```

CI에서 Node.js 22·24·26별 배포 검사 실행. `npm publish` 시 `prepublishOnly`를 통한 동일 검사 실행. 패키지 검증 범위: 배포 파일, ESM·CommonJS 실행, 설치된 TypeScript 선언.

미배포 체크아웃의 로컬 사용: 해당 폴더에서 `npm ci`와 `npm run build` 실행 후, 사용하는 프로젝트에서 `npm install /absolute/path/to/refpin` 실행.

## 라이선스

[MIT](LICENSE)
