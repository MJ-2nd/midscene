/**
 * Midscene Playground REST API Client
 *
 * Android Playground 서버의 REST API를 사용하여 자연어로 디바이스를 제어합니다.
 * agent.aiAct()를 통해 AI가 스크린샷 분석 → 요소 탐지 → 액션 실행을 자동 처리합니다.
 *
 * 사전 조건:
 *   1. .env 파일에 MIDSCENE_MODEL_* 환경 변수 설정
 *   2. Android Playground 서버 실행:
 *      npx @midscene/android-playground
 *
 * 사용법:
 *   node midscene-client.mjs
 */

// ============================================================
// 설정
// ============================================================

const BASE_URL = 'http://localhost:3000';

// ============================================================
// Playground REST API 클라이언트
// ============================================================

class MidsceneClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * REST API 요청을 보냅니다.
   */
  async request(method, path, body = null) {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(`${this.baseUrl}${path}`, options);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    return res.json();
  }

  // ----------------------------------------------------------
  // 서버 상태 확인
  // ----------------------------------------------------------
  async checkStatus() {
    console.log('[1/2] 서버 상태 확인 중...');
    const result = await this.request('GET', '/status');
    console.log(`  서버 상태: ${result.status}, ID: ${result.id}`);
    return result;
  }

  // ----------------------------------------------------------
  // 자연어 AI 액션 실행 (핵심 기능)
  // AI가 스크린샷을 분석하고 적절한 액션을 자동 수행
  // ----------------------------------------------------------
  async aiAct(prompt) {
    console.log(`[2/2] AI 액션: "${prompt}" ...`);

    const result = await this.request('POST', '/execute', {
      type: 'aiAct',
      prompt,
    });

    if (result.error) {
      throw new Error(`실행 오류: ${result.error}`);
    }

    console.log('  완료!');
    return result;
  }

  // ----------------------------------------------------------
  // 스크린샷 촬영
  // ----------------------------------------------------------
  async screenshot() {
    console.log('스크린샷 촬영 중...');
    const result = await this.request('GET', '/screenshot');
    if (result.screenshot) {
      console.log(`  스크린샷 수신 (${result.screenshot.length} chars base64)`);
    }
    return result;
  }

  // ----------------------------------------------------------
  // AI 어설션 (화면 상태 검증)
  // ----------------------------------------------------------
  async aiAssert(prompt) {
    console.log(`AI 검증: "${prompt}" ...`);
    const result = await this.request('POST', '/execute', {
      type: 'aiAssert',
      prompt,
    });
    if (result.error) {
      throw new Error(`검증 오류: ${result.error}`);
    }
    console.log(`  결과: ${JSON.stringify(result.result)}`);
    return result;
  }

  // ----------------------------------------------------------
  // AI 데이터 추출
  // ----------------------------------------------------------
  async aiQuery(prompt) {
    console.log(`AI 쿼리: "${prompt}" ...`);
    const result = await this.request('POST', '/execute', {
      type: 'aiQuery',
      prompt,
    });
    if (result.error) {
      throw new Error(`쿼리 오류: ${result.error}`);
    }
    console.log(`  결과: ${JSON.stringify(result.result)}`);
    return result;
  }
}

// ============================================================
// 메인 실행
// ============================================================

async function main() {
  const client = new MidsceneClient(BASE_URL);

  try {
    // 1. 서버 상태 확인
    await client.checkStatus();

    // 2. 자연어로 명령 - AI가 알아서 처리!
    await client.aiAct('open settings app');

    // 추가 예시:
    // await client.aiAct('scroll down');
    // await client.aiAct('tap on Wi-Fi');
    // await client.aiAct('go back');
    // await client.aiAssert('Settings app is open');
    // await client.aiQuery('what menu items are visible?');
  } catch (err) {
    console.error('오류 발생:', err.message);
    process.exit(1);
  }
}

main();
