/**
 * Midscene Playground REST API Client (Enhanced)
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

// ============================================================
// 설정
// ============================================================

const BASE_URL = 'http://localhost:5800';
const POLL_INTERVAL_MS = 500;

// ============================================================
// 진행 상황 표시 유틸리티
// ============================================================

/**
 * task.type/subType에서 표시할 단계 유형 문자열을 추출합니다.
 * (packages/core/src/agent/ui-utils.ts의 typeStr 로직 포팅)
 */
function typeStr(task) {
  return task.subType || task.type || 'Unknown';
}

/**
 * task.param에서 설명 문자열을 추출합니다.
 * (packages/core/src/agent/ui-utils.ts의 paramStr 로직 간소화 포팅)
 */
function paramStr(task) {
  // Planning 타입
  if (task.type === 'Planning') {
    if (task.subType === 'Locate') {
      return extractLocateParam(task.param);
    }
    // AI가 생성한 output.log 우선, 없으면 사용자 입력
    return task.output?.log || task.param?.userInstruction || '';
  }

  // Insight 타입 (aiQuery, aiAssert 등)
  if (task.type === 'Insight') {
    const p = task.param;
    if (!p) return '';
    if (p.demand) return typeof p.demand === 'string' ? p.demand : JSON.stringify(p.demand);
    if (p.assertion) return typeof p.assertion === 'string' ? p.assertion : JSON.stringify(p.assertion);
    if (p.dataDemand) {
      if (typeof p.dataDemand === 'string') return p.dataDemand;
      return typeof p.dataDemand.demand === 'string' ? p.dataDemand.demand : JSON.stringify(p.dataDemand);
    }
    return '';
  }

  // Action Space 타입 (Tap, Input, Scroll 등)
  if (task.type === 'Action Space') {
    const p = task.param;
    const locateStr = p?.locate ? extractLocateParam(p.locate) : '';

    let value = task.thought || '';
    if (typeof p?.timeMs === 'number') {
      value = `${p.timeMs}ms`;
    } else if (typeof p?.scrollType === 'string') {
      value = `${p.direction || 'down'}, ${p.scrollType}, ${p.distance || '?'}`;
    } else if (typeof p?.direction === 'string' && task.subType === 'PullGesture') {
      const parts = [`direction: ${p.direction}`];
      if (p.distance) parts.push(`distance: ${p.distance}`);
      if (p.duration) parts.push(`duration: ${p.duration}ms`);
      value = parts.join(', ');
    } else if (typeof p?.value !== 'undefined') {
      value = String(p.value);
    }

    if (locateStr && value) return `${locateStr} - ${value}`;
    return locateStr || value || '';
  }

  return '';
}

/**
 * locate 파라미터에서 설명 문자열을 추출합니다.
 */
function extractLocateParam(locate) {
  if (!locate) return '';
  if (typeof locate === 'string') return locate;
  if (typeof locate === 'object') {
    // 중첩 prompt.prompt (Planning Locate tasks)
    if (typeof locate.prompt === 'object' && locate.prompt?.prompt) {
      return locate.prompt.prompt;
    }
    if (typeof locate.prompt === 'string') return locate.prompt;
    if (typeof locate.description === 'string') return locate.description;
  }
  return '';
}

/**
 * 상태 아이콘을 반환합니다.
 */
function statusIcon(status) {
  switch (status) {
    case 'finished': return '\x1b[32m✓\x1b[0m';  // 녹색
    case 'failed':   return '\x1b[31m✗\x1b[0m';  // 빨간색
    case 'cancelled': return '\x1b[33m⊘\x1b[0m'; // 노란색
    case 'running':  return '\x1b[36m⏳\x1b[0m';  // 시안색
    case 'pending':  return '\x1b[90m○\x1b[0m';   // 회색
    default:         return '?';
  }
}

// ============================================================
// Playground REST API 클라이언트
// ============================================================

class MidsceneClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.currentRequestId = null;
    this._pollTimer = null;

    // Ctrl+C 취소 처리
    process.on('SIGINT', async () => {
      if (this.currentRequestId) {
        console.log('\n  취소 요청 중...');
        try {
          await this.cancel(this.currentRequestId);
          console.log('  실행이 취소되었습니다.');
        } catch {
          // 취소 실패해도 종료
        }
      }
      process.exit(0);
    });
  }

  // ----------------------------------------------------------
  // HTTP 요청 헬퍼
  // ----------------------------------------------------------

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
  // 진행 상황 폴링
  // ----------------------------------------------------------

  async getTaskProgress(requestId) {
    try {
      return await this.request('GET', `/task-progress/${encodeURIComponent(requestId)}`);
    } catch {
      return {};
    }
  }

  startProgressPolling(requestId, displayedTasks) {
    this._pollTimer = setInterval(async () => {
      const progress = await this.getTaskProgress(requestId);
      if (progress?.executionDump?.tasks) {
        this.printProgress(progress.executionDump.tasks, displayedTasks);
      }
    }, POLL_INTERVAL_MS);
  }

  stopProgressPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  // ----------------------------------------------------------
  // 터미널 진행 상황 출력 (추가 출력 방식)
  // ----------------------------------------------------------

  printProgress(tasks, displayedTasks) {
    for (const [i, task] of tasks.entries()) {
      const key = `${i}-${task.status}`;
      if (displayedTasks.has(key)) continue;
      displayedTasks.add(key);

      const icon = statusIcon(task.status);
      const type = typeStr(task);
      const desc = paramStr(task);
      const descStr = desc ? ` - ${desc}` : '';

      console.log(`  [${icon}] ${type}${descStr}`);
    }
  }

  // ----------------------------------------------------------
  // 결과 요약 출력
  // ----------------------------------------------------------

  printSummary(result) {
    const tasks = result.dump?.tasks;
    if (!tasks?.length) {
      console.log('  완료!');
      return;
    }

    const taskCount = tasks.length;
    const firstStart = tasks[0]?.timing?.start;
    const lastEnd = tasks[tasks.length - 1]?.timing?.end;
    let timeStr = '';
    if (firstStart && lastEnd) {
      const seconds = ((lastEnd - firstStart) / 1000).toFixed(1);
      timeStr = `, ${seconds}초`;
    }

    const failed = tasks.filter(t => t.status === 'failed').length;
    if (failed > 0) {
      console.log(`  완료 (${taskCount}단계${timeStr}, ${failed}개 실패)`);
    } else {
      console.log(`  완료! (${taskCount}단계${timeStr})`);
    }
  }

  // ----------------------------------------------------------
  // 진행 상황 포함 실행 (핵심 통합 메서드)
  // ----------------------------------------------------------

  async executeWithProgress(type, payload, label) {
    const requestId = Date.now().toString();
    this.currentRequestId = requestId;
    const displayedTasks = new Set();

    console.log(`${label || type}: "${payload.prompt || JSON.stringify(payload.params || {})}" ...`);

    // 폴링 시작
    this.startProgressPolling(requestId, displayedTasks);

    try {
      const result = await this.request('POST', '/execute', {
        type,
        ...payload,
        requestId,
      });

      // 최종 dump에서 미출력 단계 표시
      if (result.dump?.tasks) {
        this.printProgress(result.dump.tasks, displayedTasks);
      }

      if (result.error) {
        throw new Error(`실행 오류: ${result.error}`);
      }

      this.printSummary(result);
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
    console.log('서버 상태 확인 중...');
    const result = await this.request('GET', '/status');
    console.log(`  서버 상태: ${result.status}, ID: ${result.id}`);
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
  // 실행 취소
  // ----------------------------------------------------------

  async cancel(requestId) {
    return this.request('POST', `/cancel/${encodeURIComponent(requestId)}`);
  }

  // ----------------------------------------------------------
  // 사용 가능한 액션 조회
  // ----------------------------------------------------------

  async getActionSpace() {
    return this.request('POST', '/action-space', {});
  }

  // ===========================================================
  // AI 액션 메서드들
  // ===========================================================

  // 자동 계획 + 실행 (Plan → Locate → Action 자동 처리)
  async aiAct(prompt) {
    return this.executeWithProgress('aiAct', { prompt }, 'AI 액션');
  }

  // 요소 클릭
  async aiTap(prompt) {
    return this.executeWithProgress('aiTap', { prompt }, 'AI 탭');
  }

  // 요소 더블 클릭
  async aiDoubleClick(prompt) {
    return this.executeWithProgress('aiDoubleClick', { prompt }, 'AI 더블클릭');
  }

  // 마우스 오버
  async aiHover(prompt) {
    return this.executeWithProgress('aiHover', { prompt }, 'AI 호버');
  }

  // 우클릭
  async aiRightClick(prompt) {
    return this.executeWithProgress('aiRightClick', { prompt }, 'AI 우클릭');
  }

  // 텍스트 입력 (prompt: 입력할 대상 요소 설명, text: 입력할 텍스트)
  async aiInput(prompt, text) {
    return this.executeWithProgress('aiInput', { prompt, params: { value: text } }, 'AI 입력');
  }

  // 키보드 입력
  async aiKeyboardPress(key) {
    return this.executeWithProgress('aiKeyboardPress', { prompt: key }, 'AI 키 입력');
  }

  // 스크롤 (prompt: 스크롤할 대상, direction: 'up'|'down'|'left'|'right')
  async aiScroll(prompt, direction = 'down') {
    return this.executeWithProgress('aiScroll', { prompt, params: { direction } }, 'AI 스크롤');
  }

  // 요소 위치 찾기
  async aiLocate(prompt) {
    return this.executeWithProgress('aiLocate', { prompt }, 'AI 위치 찾기');
  }

  // 화면 상태 검증 (assertion)
  async aiAssert(prompt) {
    const result = await this.executeWithProgress('aiAssert', { prompt }, 'AI 검증');
    if (result.result !== undefined) {
      console.log(`  검증 결과: ${JSON.stringify(result.result)}`);
    }
    return result;
  }

  // 데이터 추출
  async aiQuery(prompt) {
    const result = await this.executeWithProgress('aiQuery', { prompt }, 'AI 쿼리');
    if (result.result !== undefined) {
      console.log(`  쿼리 결과: ${JSON.stringify(result.result)}`);
    }
    return result;
  }

  // Boolean 값 추출
  async aiBoolean(prompt) {
    const result = await this.executeWithProgress('aiBoolean', { prompt }, 'AI Boolean');
    if (result.result !== undefined) {
      console.log(`  결과: ${result.result}`);
    }
    return result;
  }

  // 숫자 값 추출
  async aiNumber(prompt) {
    const result = await this.executeWithProgress('aiNumber', { prompt }, 'AI Number');
    if (result.result !== undefined) {
      console.log(`  결과: ${result.result}`);
    }
    return result;
  }

  // 텍스트 값 추출
  async aiString(prompt) {
    const result = await this.executeWithProgress('aiString', { prompt }, 'AI String');
    if (result.result !== undefined) {
      console.log(`  결과: ${result.result}`);
    }
    return result;
  }

  // UI에 대한 질문
  async aiAsk(prompt) {
    const result = await this.executeWithProgress('aiAsk', { prompt }, 'AI 질문');
    if (result.result !== undefined) {
      console.log(`  답변: ${JSON.stringify(result.result)}`);
    }
    return result;
  }

  // 조건 대기
  async aiWaitFor(prompt, { timeoutMs = 30000, checkIntervalMs = 3000 } = {}) {
    return this.executeWithProgress('aiWaitFor', {
      prompt,
      params: { timeoutMs, checkIntervalMs },
    }, 'AI 대기');
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
    console.log('');

    // 2. 자연어로 명령 - AI가 알아서 처리!
    await client.aiAct('open settings app');

    // 추가 사용 예시:
    // await client.aiTap('Wi-Fi toggle');
    // await client.aiInput('search field', 'bluetooth');
    // await client.aiScroll('settings list', 'down');
    // await client.aiLocate('battery icon');
    // await client.aiAssert('Settings app is open');
    // await client.aiQuery('what menu items are visible?');
    // await client.aiWaitFor('loading spinner disappears');
    // await client.aiKeyboardPress('Enter');
    // await client.aiHover('notification icon');
  } catch (err) {
    console.error('\n오류 발생:', err.message);
    process.exit(1);
  }
}

main();
