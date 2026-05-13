# Midscene.js 모델 호출 아키텍처 분석

## 1. 개요

Midscene.js는 **OpenAI 호환 API**를 기반으로 모든 LLM 호출을 수행합니다. 내부적으로 `openai` npm 패키지를 사용하며, `baseURL`과 `apiKey`를 교체하는 것만으로 커스텀 LLM 서버를 연동할 수 있도록 설계되어 있습니다.

---

## 2. 아키텍처 계층 구조

```
┌─────────────────────────────────────────────────────────┐
│                    사용자 코드 / Agent                      │
│         (Playwright, Puppeteer, Android, iOS 등)          │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              TaskExecutor (task-runner.ts)               │
│     자연어 명령 → 세부 작업 분해 및 실행 루프                    │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              Service Layer (service/index.ts)            │
│       locate() / extract() / plan() 등 고수준 API          │
│       UIContext(스크린샷+메타데이터) 관리                      │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│           AI Model Layer (ai-model/)                    │
│  ┌────────────────────────────────────────────────┐     │
│  │  inspect.ts: AiLocateElement, AiExtractElement │     │
│  │  llm-planning.ts: plan()                       │     │
│  │  → 프롬프트 구성 + 이미지 전처리                     │     │
│  └────────────────────┬───────────────────────────┘     │
│                       │                                  │
│  ┌────────────────────▼───────────────────────────┐     │
│  │  service-caller/index.ts                       │     │
│  │  callAI() / callAIWithObjectResponse()         │     │
│  │  → OpenAI SDK로 실제 HTTP 요청                    │     │
│  └────────────────────┬───────────────────────────┘     │
└───────────────────────┼─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│            OpenAI SDK (openai npm package)               │
│     new OpenAI({ baseURL, apiKey }) → chat.completions  │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  LLM API 서버    │
              │ (OpenAI 호환)    │
              └─────────────────┘
```

---

## 3. 핵심 파일 및 역할

| 파일 경로 | 역할 |
|-----------|------|
| `packages/core/src/ai-model/service-caller/index.ts` | **핵심** — `callAI()`, `callAIWithObjectResponse()`, `callAIWithStringResponse()` 함수. OpenAI 클라이언트 생성, 스트리밍, 재시도 로직 |
| `packages/core/src/ai-model/inspect.ts` | `AiLocateElement()`, `AiExtractElementInfo()` — 스크린샷을 메시지로 변환하고 callAI 호출 |
| `packages/core/src/ai-model/llm-planning.ts` | `plan()` — 자연어 지시를 행동 계획으로 변환. XML 기반 응답 파싱 |
| `packages/core/src/ai-model/prompt/llm-locator.ts` | 요소 위치 결정 시스템 프롬프트 |
| `packages/core/src/ai-model/prompt/llm-planning.ts` | 작업 계획 시스템 프롬프트, 액션 스키마 설명 |
| `packages/core/src/ai-model/prompt/extraction.ts` | 데이터 추출 프롬프트 |
| `packages/core/src/service/index.ts` | 고수준 Service 클래스 — locate/extract 오케스트레이션 |
| `packages/shared/src/env/types.ts` | 환경변수 키 상수, `IModelConfig` 인터페이스, `TModelFamily` 타입 |
| `packages/shared/src/env/parse-model-config.ts` | 환경변수 → `IModelConfig` 파싱 로직 |
| `packages/shared/src/env/model-config-manager.ts` | Intent별(default/insight/planning) 모델 설정 관리 |

---

## 4. 모델 호출 상세 흐름

### 4.1 요청 흐름 (예: 요소 위치 결정)

```
1. agent.ai("로그인 버튼을 클릭하세요")
2. TaskExecutor가 plan() 호출 → LLM에게 행동 계획 요청
3. 계획 결과: [{ type: "Tap", param: { locate: "로그인 버튼" } }]
4. Service.locate("로그인 버튼") 호출
5. AiLocateElement() 실행:
   a. 스크린샷을 base64로 인코딩
   b. 시스템 프롬프트 구성 (systemPromptToLocateElement)
   c. 사용자 메시지: [스크린샷 이미지, "Find: 로그인 버튼"]
6. callAIWithObjectResponse(messages, modelConfig)
7. callAI(messages, modelConfig) 내부:
   a. createChatClient() → new OpenAI({ baseURL, apiKey })
   b. completion.create({ model, messages, temperature, ... })
   c. 응답 파싱 → { bbox: [x1, y1, x2, y2] }
8. bbox를 화면 좌표로 변환 → 클릭 실행
```

### 4.2 OpenAI 클라이언트 생성 (`createChatClient`)

```typescript
// service-caller/index.ts:36-213
const openAIOptions = {
  baseURL: modelConfig.openaiBaseURL,     // ← 커스텀 서버 URL
  apiKey: modelConfig.openaiApiKey,       // ← API 키
  dangerouslyAllowBrowser: true,
  ...modelConfig.openaiExtraConfig,       // ← 추가 설정
};

const openai = new OpenAI(openAIOptions);
// → openai.chat.completions.create() 호출
```

### 4.3 세 가지 호출 패턴

| 함수 | 용도 | 응답 형식 |
|------|------|----------|
| `callAI()` | 기본 호출. 스트리밍/비스트리밍 모두 지원 | `{ content: string, reasoning_content?: string, usage }` |
| `callAIWithObjectResponse<T>()` | JSON 응답이 필요할 때 (요소 위치, 추출 등) | `{ content: T, usage }` |
| `callAIWithStringResponse()` | 순수 텍스트 응답이 필요할 때 | `{ content: string, usage }` |

### 4.4 재시도 메커니즘

- 기본 재시도 횟수: **10회** (총 11번 시도)
- 재시도 간격: **2000ms**
- 재시도 시 temperature를 0.1씩 증가 (최대 1.0)
- 환경변수로 설정 가능: `MIDSCENE_MODEL_RETRY_COUNT`, `MIDSCENE_MODEL_RETRY_INTERVAL`

---

## 5. Intent 기반 다중 모델 전략

Midscene는 세 가지 **Intent**에 따라 다른 모델을 사용할 수 있습니다:

| Intent | 용도 | 환경변수 접두사 |
|--------|------|----------------|
| `default` | 기본 작업 (어설션, 코드 생성 등) | `MIDSCENE_MODEL_*` |
| `insight` | 시각적 질의응답(VQA), 요소 위치 결정(Grounding) | `MIDSCENE_INSIGHT_MODEL_*` |
| `planning` | 자연어 → 행동 계획 변환 | `MIDSCENE_PLANNING_MODEL_*` |

각 Intent는 독립적인 모델 이름, API 키, Base URL, 타임아웃, 온도 등을 가질 수 있으며, `insight`나 `planning` 모델이 설정되지 않으면 `default` 설정을 폴백으로 사용합니다.

---

## 6. 모델 설정 환경변수

### 6.1 필수 설정

```bash
# 모델 이름 (필수)
MIDSCENE_MODEL_NAME="qwen3-vl-plus"

# API 키 (필수)
MIDSCENE_MODEL_API_KEY="your_api_key"

# Base URL (필수 - OpenAI 호환 엔드포인트)
MIDSCENE_MODEL_BASE_URL="https://your-llm-server.com/v1"

# 모델 패밀리 (VL 모델 사용 시 필수)
MIDSCENE_MODEL_FAMILY="qwen3-vl"
```

### 6.2 선택적 설정

```bash
# 온도 (기본값: 0)
MIDSCENE_MODEL_TEMPERATURE="0.3"

# 최대 토큰 수
MIDSCENE_MODEL_MAX_TOKENS="4096"

# 타임아웃 (ms, 기본값: 10000)
MIDSCENE_MODEL_TIMEOUT="30000"

# 재시도 (기본값: 10)
MIDSCENE_MODEL_RETRY_COUNT="5"
MIDSCENE_MODEL_RETRY_INTERVAL="3000"

# 추론 모드 설정
MIDSCENE_MODEL_REASONING_ENABLED="true"
MIDSCENE_MODEL_REASONING_EFFORT="high"
MIDSCENE_MODEL_REASONING_BUDGET="4096"

# 프록시
MIDSCENE_MODEL_HTTP_PROXY="http://proxy:8080"
MIDSCENE_MODEL_SOCKS_PROXY="socks5://proxy:1080"

# 추가 OpenAI SDK 설정 (JSON)
MIDSCENE_MODEL_INIT_CONFIG_JSON='{"defaultHeaders":{"X-Custom":"value"}}'
```

### 6.3 지원 모델 패밀리 (`MIDSCENE_MODEL_FAMILY`)

| 값 | 모델 | 비고 |
|----|------|------|
| `qwen2.5-vl` | Qwen 2.5 VL | `vl_high_resolution_images: true` 자동 설정 |
| `qwen3-vl` | Qwen 3 VL | `enable_thinking`/`thinking_budget` 지원 |
| `qwen3.5` | Qwen 3.5 | qwen3-vl과 동일하게 동작 |
| `doubao-vision` | 豆包(Doubao) Vision | `thinking.type`/`reasoning_effort` 지원 |
| `doubao-seed` | 豆包 Seed | doubao-vision과 동일 |
| `gemini` | Google Gemini | |
| `vlm-ui-tars` | UI-TARS v1.0 | 특수 행동 계획 모드 |
| `vlm-ui-tars-doubao` | UI-TARS (Doubao) | |
| `vlm-ui-tars-doubao-1.5` | UI-TARS (Doubao 1.5) | |
| `glm-v` | GLM-V | `thinking.type` 지원 |
| `auto-glm` | AutoGLM | 특수 프롬프트/파서 |
| `gpt-5` | GPT-5 | `reasoning.effort` 지원 |

---

## 7. 커스텀 LLM 서버 연동 방법

### 방법 1: 환경변수만으로 연동 (가장 간단)

커스텀 LLM 서버가 **OpenAI 호환 API** (`/v1/chat/completions`)를 제공하면 환경변수 설정만으로 즉시 사용 가능합니다.

```bash
# .env 파일
MIDSCENE_MODEL_NAME="your-custom-model"
MIDSCENE_MODEL_API_KEY="your-api-key"
MIDSCENE_MODEL_BASE_URL="http://your-server:8000/v1"
MIDSCENE_MODEL_FAMILY="qwen3-vl"  # 가장 가까운 모델 패밀리 선택
```

**요구 사항:**
- 서버가 OpenAI Chat Completions API 형식을 구현해야 함
- `POST /v1/chat/completions` 엔드포인트
- Vision 기능 지원 (`image_url` 타입의 멀티모달 메시지 처리)
- JSON 형식 응답 생성 능력

### 방법 2: `createOpenAIClient` 콜백 사용

프로그래밍 방식으로 OpenAI 클라이언트를 커스텀할 수 있습니다:

```typescript
import { PuppeteerAgent } from '@midscene/web/puppeteer';

const agent = new PuppeteerAgent(page, {
  modelConfig: {
    MIDSCENE_MODEL_NAME: 'your-model',
    MIDSCENE_MODEL_BASE_URL: 'http://your-server:8000/v1',
    MIDSCENE_MODEL_API_KEY: 'your-key',
    MIDSCENE_MODEL_FAMILY: 'qwen3-vl',
  },
  createOpenAIClient: async (openaiInstance, options) => {
    // OpenAI 인스턴스를 래핑하거나 교체
    // 예: 로깅 추가, 커스텀 헤더 설정 등
    return openaiInstance;
  },
});
```

### 방법 3: Intent별 다른 서버 사용

작업 유형에 따라 다른 모델/서버를 사용할 수 있습니다:

```bash
# 기본 모델 (어설션, 추출 등)
MIDSCENE_MODEL_NAME="fast-model"
MIDSCENE_MODEL_BASE_URL="http://fast-server:8000/v1"
MIDSCENE_MODEL_API_KEY="key1"

# Insight 전용 모델 (요소 위치 결정 - 높은 정밀도 필요)
MIDSCENE_INSIGHT_MODEL_NAME="vision-model"
MIDSCENE_INSIGHT_MODEL_BASE_URL="http://vision-server:8000/v1"
MIDSCENE_INSIGHT_MODEL_API_KEY="key2"
MIDSCENE_INSIGHT_MODEL_FAMILY="qwen3-vl"

# Planning 전용 모델 (행동 계획 - 강한 추론 능력 필요)
MIDSCENE_PLANNING_MODEL_NAME="reasoning-model"
MIDSCENE_PLANNING_MODEL_BASE_URL="http://reasoning-server:8000/v1"
MIDSCENE_PLANNING_MODEL_API_KEY="key3"
MIDSCENE_PLANNING_MODEL_FAMILY="qwen3-vl"
```

---

## 8. 커스텀 LLM 서버 요구 사항

커스텀 서버가 Midscene와 완벽히 호환되려면 다음을 구현해야 합니다:

### 8.1 API 엔드포인트

```
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer {api_key}
```

### 8.2 요청 형식

```json
{
  "model": "your-model-name",
  "messages": [
    {
      "role": "system",
      "content": "You are an AI assistant that helps identify UI elements..."
    },
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "This is the current page screenshot:"
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/png;base64,iVBORw0KGgo...",
            "detail": "high"
          }
        }
      ]
    },
    {
      "role": "user",
      "content": "Find: 로그인 버튼"
    }
  ],
  "temperature": 0.3,
  "max_tokens": 4096
}
```

### 8.3 응답 형식

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "{\"bbox\": [100, 200, 300, 250], \"errors\": []}"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 1500,
    "completion_tokens": 50,
    "total_tokens": 1550
  }
}
```

### 8.4 필수 능력

1. **멀티모달 입력**: `image_url` 타입의 base64 인코딩 이미지 처리
2. **JSON 구조화 응답**: bbox 좌표, 행동 계획 등의 구조화된 JSON 출력
3. **XML 구조화 응답**: Planning에서는 XML 태그 기반 응답 (`<thought>`, `<action-type>`, `<action-param-json>` 등)
4. **한국어/다국어**: 프롬프트와 응답에서 다국어 지원

---

## 9. 관찰성 (Observability) 통합

```bash
# LangSmith 연동
MIDSCENE_LANGSMITH_DEBUG="true"
LANGCHAIN_TRACING_V2="true"
LANGCHAIN_API_KEY="your-langsmith-key"

# Langfuse 연동
MIDSCENE_LANGFUSE_DEBUG="true"
LANGFUSE_SECRET_KEY="your-langfuse-key"
LANGFUSE_PUBLIC_KEY="your-public-key"
```

---

## 10. 디버깅

```bash
# 모델 프로파일 디버그 (토큰 사용량, 비용, 시간)
DEBUG=midscene:ai:profile:stats node your-script.js

# 모델 호출 상세 디버그
DEBUG=midscene:ai:call node your-script.js

# 설정 디버그
DEBUG=midscene:ai:config node your-script.js

# 전체 디버그
DEBUG=midscene:* node your-script.js
```

---

## 11. 커스텀 LLM 서버 연동 실행 계획

### 단계 1: OpenAI 호환 서버 준비
- vLLM, Ollama, LiteLLM, LocalAI 등의 프레임워크로 비전 모델 서빙
- `/v1/chat/completions` 엔드포인트 확인

### 단계 2: 환경변수 설정
```bash
MIDSCENE_MODEL_NAME="your-model"
MIDSCENE_MODEL_BASE_URL="http://localhost:8000/v1"
MIDSCENE_MODEL_API_KEY="dummy-key"  # 로컬 서버의 경우
MIDSCENE_MODEL_FAMILY="qwen3-vl"    # 모델에 맞는 패밀리
```

### 단계 3: 연결 테스트
```bash
# 단일 테스트 실행
npx vitest run packages/core/tests/ai/locate.test.ts
```

### 단계 4: (선택) 새 모델 패밀리 추가
기존 모델 패밀리와 동작이 다른 경우:
1. `packages/shared/src/env/types.ts`에 새 `TModelFamily` 값 추가
2. `packages/core/src/ai-model/service-caller/index.ts`의 `resolveReasoningConfig()`에 새 패밀리 분기 추가
3. 프롬프트 조정이 필요하면 `packages/core/src/ai-model/prompt/` 내 관련 파일 수정

### 단계 5: (선택) 성능 최적화
- Intent별 다른 모델 사용 (경량 모델은 default, 고성능 모델은 planning/insight)
- 재시도 설정 조정
- 타임아웃 조정

---

## 12. 요약

Midscene.js의 모델 호출 시스템은 **OpenAI SDK를 추상화 계층으로 사용**하여 설계되었습니다. 이는 OpenAI 호환 API를 제공하는 어떤 LLM 서버든 **환경변수 3개만 설정하면** 즉시 연동할 수 있음을 의미합니다. 소스 코드 수정 없이 커스텀 서버를 사용할 수 있으며, 더 깊은 커스터마이징이 필요한 경우 `createOpenAIClient` 콜백이나 새 모델 패밀리 추가를 통해 대응할 수 있습니다.
