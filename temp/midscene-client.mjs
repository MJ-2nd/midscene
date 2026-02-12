/**
 * Midscene MCP HTTP Client
 *
 * Android MCP 서버에 HTTP로 요청을 보내는 클라이언트.
 * MCP 프로토콜(JSON-RPC 2.0)을 사용하여 세션 관리, 도구 목록 조회, 액션 실행을 수행합니다.
 *
 * 사전 조건:
 *   1. .env 파일에 MIDSCENE_MODEL_* 환경 변수 설정
 *   2. Android MCP 서버 실행:
 *      npx @midscene/android-mcp --mode=http --port=3000 --host=0.0.0.0
 *
 * 사용법:
 *   node midscene-client.mjs
 */

// ============================================================
// 설정
// ============================================================

const BASE_URL = 'http://localhost:3000';

// ============================================================
// MCP 클라이언트
// ============================================================

class MidsceneMCPClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.sessionId = null;
    this.requestId = 0;
  }

  nextId() {
    return ++this.requestId;
  }

  /**
   * MCP 엔드포인트에 JSON-RPC 요청을 보냅니다.
   */
  async sendRequest(method, params = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }

    const body = {
      jsonrpc: '2.0',
      method,
      params,
      id: this.nextId(),
    };

    const res = await fetch(`${this.baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    // 첫 요청(initialize)의 응답 헤더에서 세션 ID 저장
    const newSessionId = res.headers.get('mcp-session-id');
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const contentType = res.headers.get('content-type') || '';

    let json;
    if (contentType.includes('text/event-stream')) {
      // SSE 응답 파싱: 여러 이벤트 중 JSON-RPC 응답(message 이벤트)을 추출
      const text = await res.text();
      const lines = text.split('\n');
      let eventType = '';
      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (eventType === 'message' && data) {
            json = JSON.parse(data);
            break;
          }
        }
      }
      if (!json) {
        throw new Error('SSE 응답에서 JSON-RPC message를 찾을 수 없습니다.');
      }
    } else {
      json = await res.json();
    }

    if (json.error) {
      throw new Error(`MCP Error [${json.error.code}]: ${json.error.message}`);
    }

    return json.result;
  }

  // ----------------------------------------------------------
  // 1단계: 세션 초기화
  // ----------------------------------------------------------
  async initialize() {
    console.log('[1/4] 세션 초기화 중...');

    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'midscene-http-client',
        version: '1.0.0',
      },
    });

    console.log(`  세션 ID: ${this.sessionId}`);
    console.log(`  서버: ${result.serverInfo?.name} v${result.serverInfo?.version}`);
    return result;
  }

  // ----------------------------------------------------------
  // 2단계: 사용 가능한 도구 목록 조회
  // ----------------------------------------------------------
  async listTools() {
    console.log('[2/4] 사용 가능한 도구 조회 중...');

    const result = await this.sendRequest('tools/list', {});
    const tools = result.tools || [];

    console.log(`  총 ${tools.length}개 도구 발견:`);
    for (const tool of tools) {
      console.log(`    - ${tool.name}: ${tool.description?.slice(0, 60)}...`);
    }
    return tools;
  }

  // ----------------------------------------------------------
  // 3단계: Android 디바이스 연결
  // ----------------------------------------------------------
  async connectDevice(deviceId) {
    console.log('[3/4] Android 디바이스 연결 중...');

    const args = {};
    if (deviceId) {
      args.deviceId = deviceId;
    }

    const result = await this.sendRequest('tools/call', {
      name: 'android_connect',
      arguments: args,
    });

    const textContent = result.content?.find((c) => c.type === 'text');
    console.log(`  ${textContent?.text || '연결 완료'}`);
    return result;
  }

  // ----------------------------------------------------------
  // 4단계: AI 액션 실행 (자연어 명령)
  // ----------------------------------------------------------
  async executeAction(toolName, args = {}) {
    console.log(`[4/4] 액션 실행: "${toolName}" ...`);

    const result = await this.sendRequest('tools/call', {
      name: toolName,
      arguments: args,
    });

    for (const item of result.content || []) {
      if (item.type === 'text') {
        console.log(`  결과: ${item.text}`);
      }
      if (item.type === 'image') {
        console.log(`  스크린샷 수신 (${item.mimeType}, ${item.data?.length} chars base64)`);
      }
    }

    return result;
  }

  // ----------------------------------------------------------
  // 스크린샷 촬영
  // ----------------------------------------------------------
  async takeScreenshot() {
    console.log('스크린샷 촬영 중...');

    const result = await this.sendRequest('tools/call', {
      name: 'take_screenshot',
      arguments: {},
    });

    const img = result.content?.find((c) => c.type === 'image');
    if (img) {
      console.log(`  스크린샷 수신 (${img.mimeType}, ${img.data?.length} chars base64)`);
    }
    return result;
  }

  // ----------------------------------------------------------
  // 디바이스 연결 해제
  // ----------------------------------------------------------
  async disconnect() {
    console.log('디바이스 연결 해제 중...');

    const result = await this.sendRequest('tools/call', {
      name: 'android_disconnect',
      arguments: {},
    });

    const textContent = result.content?.find((c) => c.type === 'text');
    console.log(`  ${textContent?.text || '해제 완료'}`);
    return result;
  }
}

// ============================================================
// 메인 실행
// ============================================================

async function main() {
  const client = new MidsceneMCPClient(BASE_URL);

  try {
    // 1. 세션 초기화
    await client.initialize();

    // 2. 도구 목록 조회
    await client.listTools();

    // 3. 디바이스 연결
    await client.connectDevice();

    // 4. "open setting app" 실행
    //    Android actionSpace에서 생성된 도구 이름 사용
    //    Tap, Input, Scroll 등은 agent.aiAction()을 통해 자연어로 처리됨
    await client.executeAction('Tap', {
      locate: { prompt: 'Settings app icon' },
    });

    // 또는 다른 액션 예시:
    // await client.executeAction('Scroll', { direction: 'down', scrollType: 'once' });
    // await client.executeAction('Input', { value: 'hello', locate: { prompt: 'search box' } });

    // 스크린샷 확인
    await client.takeScreenshot();

    // 연결 해제
    await client.disconnect();
  } catch (err) {
    console.error('오류 발생:', err.message);
    process.exit(1);
  }
}

main();
