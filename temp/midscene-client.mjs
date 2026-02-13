/**
 * Midscene Playground REST API Client
 *
 * Android Playground 서버의 REST API를 사용하여 자연어로 디바이스를 제어합니다.
 * 실행 중 단계별 진행 상황(Plan → Locate → Action)을 실시간으로 터미널에 표시합니다.
 *
 * 사전 조건:
 *   1. .env 파일에 MIDSCENE_MODEL_* 환경 변수 설정
 *   2. Android Playground 서버 실행:
 *      npx @midscene/android-playground
 *
 * 사용법:
 *   node midscene-client.mjs
 */

import fetch from 'node-fetch';

// ============================================================
// 설정
// ============================================================

const BASE_URL = 'http://localhost:5800';

// ============================================================
// Playground REST API 클라이언트
// ============================================================

class MidsceneClient {
  constructor(baseUrl, messages) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.currentRequestId = null;
    this._pollTimer = null;

    if (messages === undefined) {
      messages = []
    }
    this.messages = messages
  }

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
  // 진행 상황 폴링 + 출력
  // ----------------------------------------------------------

  async getTaskProgress(requestId) {
    try {
      return await this.request('GET', `/task-progress/${encodeURIComponent(requestId)}`);
    } catch {
      return {};
    }
  }

  startProgressPolling(requestId, printed) {
    this._pollTimer = setInterval(async () => {
      const progress = await this.getTaskProgress(requestId);
      this.logNewTasks(progress?.executionDump?.tasks, printed);
    }, 500);
  }

  stopProgressPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  logNewTasks(tasks, printed) {
    if (!tasks) return;
    for (const [i, task] of tasks.entries()) {
      const key = `${i}-${task.status}`;
      if (printed.has(key)) continue;
      printed.add(key);

      const type = task.subType || task.type;
      const desc = this.taskDescription(task);


      const msg = {
        type: 'system',
        content: `${type}${desc ? ' - ' + desc : ''}`,
        timestamp : new Date()
      }
      if (task.status === 'finished') {
        this.messages.push(msg)
      }

      console.log(msg)
    }
  }

  taskDescription(task) {
    if (task.type === 'Planning') {
      if (task.subType === 'Locate') {
        return extractLocate(task.param);
      }
      return task.output?.log || task.param?.userInstruction || '';
    }
    if (task.type === 'Insight') {
      const p = task.param;
      if (!p) return '';
      if (p.demand) return String(p.demand);
      if (p.assertion) return String(p.assertion);
      if (p.dataDemand) return typeof p.dataDemand === 'string' ? p.dataDemand : String(p.dataDemand.demand || '');
      return '';
    }
    if (task.type === 'Action Space') {
      const loc = extractLocate(task.param?.locate);
      const val = task.param?.value !== undefined ? String(task.param.value) : (task.thought || '');
      if (loc && val) return `${loc} - ${val}`;
      return loc || val || '';
    }
    return '';
  }

  // ----------------------------------------------------------
  // 핵심: 진행 상황 포함 실행
  // ----------------------------------------------------------

  async executeWithProgress(type, payload) {
    const requestId = Date.now().toString();
    this.currentRequestId = requestId;
    const printed = new Set();

    this.startProgressPolling(requestId, printed);

    try {
      const result = await this.request('POST', '/execute', {
        type,
        ...payload,
        requestId,
      });

      // 최종 dump에서 미출력 단계 보충
      this.logNewTasks(result.dump?.tasks, printed);

      if (result.error) {
        throw new Error(result.error);
      }
      return result;
    } finally {
      this.stopProgressPolling();
      this.currentRequestId = null;
    }
  }

  // ----------------------------------------------------------
  // 서버 상태 확인
  // ----------------------------------------------------------

  async checkStatus() {
    const result = await this.request('GET', '/status');
    console.log(`서버 상태: ${result.status}, ID: ${result.id}`);
    return result;
  }

  async screenshot() {
    const result = await this.request('GET', '/screenshot');
    if (result.screenshot) {
      console.log(`스크린샷 수신 (${result.screenshot.length} chars base64)`);
    }
    return result;
  }

  async cancel(requestId) {
    return this.request('POST', `/cancel/${encodeURIComponent(requestId)}`);
  }

  // ----------------------------------------------------------
  // AI 액션 메서드들
  // ----------------------------------------------------------

  async aiAct(prompt) {
    console.log(`aiAct: "${prompt}"`);
    return this.executeWithProgress('aiAct', { prompt });
  }

  async aiAssert(prompt) {
    console.log(`aiAssert: "${prompt}"`);
    const result = await this.executeWithProgress('aiAssert', { prompt });
    console.log(`  result: ${JSON.stringify(result.result)}`);
    return result;
  }

  async aiWaitFor(prompt, opts = {}) {
    console.log(`aiWaitFor: "${prompt}"`);
    return this.executeWithProgress('aiWaitFor', { prompt, params: opts });
  }
}

// ============================================================
// 헬퍼
// ============================================================

function extractLocate(locate) {
  if (!locate) return '';
  if (typeof locate === 'string') return locate;
  if (typeof locate.prompt === 'object' && locate.prompt?.prompt) return locate.prompt.prompt;
  if (typeof locate.prompt === 'string') return locate.prompt;
  if (typeof locate.description === 'string') return locate.description;
  return '';
}

// ============================================================
// 메인 실행
// ============================================================

async function main() {
  const client = new MidsceneClient(BASE_URL);

  try {
    await client.checkStatus();

    await client.aiAct('open settings app');

    // 사용 예시:
    // await client.aiTap('Wi-Fi toggle');
    // await client.aiInput('search field', 'bluetooth');
    // await client.aiScroll('settings list', 'down');
    // await client.aiLocate('battery icon');
    // await client.aiAssert('Settings app is open');
    // await client.aiQuery('what menu items are visible?');
    // await client.aiWaitFor('loading disappears');
    // await client.aiKeyboardPress('Enter');
  } catch (err) {
    console.error('오류:', err.message);
    process.exit(1);
  }
}

main();
