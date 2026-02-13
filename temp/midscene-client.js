/**
 * Midscene Playground REST API Client (Browser 호환 버전)
 *
 * Android Playground 서버의 REST API를 사용하여 자연어로 디바이스를 제어합니다.
 * 실행 중 단계별 진행 상황(Plan → Locate → Action)을 실시간으로 표시합니다.
 */

// ============================================================
// Playground REST API 클라이언트
// ============================================================

class MidsceneClient {
  constructor(baseUrl, messages) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.currentRequestId = null;
    this._pollTimer = null;
    this.messages = messages || [];
  }

  // ----------------------------------------------------------
  // HTTP 요청
  // ----------------------------------------------------------

  async request(method, path, body) {
    var options = {
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    var res = await fetch(this.baseUrl + path, options);

    if (!res.ok) {
      var text = await res.text();
      throw new Error('HTTP ' + res.status + ': ' + text);
    }

    return res.json();
  }

  // ----------------------------------------------------------
  // 진행 상황 폴링 + 출력
  // ----------------------------------------------------------

  async getTaskProgress(requestId) {
    try {
      return await this.request('GET', '/task-progress/' + requestId);
    } catch (e) {
      return {};
    }
  }

  startProgressPolling(requestId, printed) {
    var self = this;
    this._pollTimer = setInterval(function () {
      self.getTaskProgress(requestId).then(function (progress) {
        var tasks = (progress && progress.executionDump)
          ? progress.executionDump.tasks
          : undefined;
        self.logNewTasks(tasks, printed);
      });
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
    for (var i = 0; i < tasks.length; i++) {
      var task = tasks[i];
      var key = i + '-' + task.status;
      if (printed.has(key)) continue;
      printed.add(key);

      var type = task.subType || task.type;
      var desc = this.taskDescription(task);

      var msg = {
        type: 'system',
        content: type + (desc ? ' - ' + desc : ''),
        timestamp: new Date()
      };
      if (task.status === 'finished') {
        this.messages.push(msg);
      }

      console.log(msg);
    }
  }

  taskDescription(task) {
    if (task.type === 'Planning') {
      if (task.subType === 'Locate') {
        return MidsceneClient._extractLocate(task.param);
      }
      var output = task.output;
      var param = task.param;
      return (output && output.log) || (param && param.userInstruction) || '';
    }
    if (task.type === 'Insight') {
      var p = task.param;
      if (!p) return '';
      if (p.demand) return String(p.demand);
      if (p.assertion) return String(p.assertion);
      if (p.dataDemand) {
        return typeof p.dataDemand === 'string'
          ? p.dataDemand
          : String((p.dataDemand && p.dataDemand.demand) || '');
      }
      return '';
    }
    if (task.type === 'Action Space') {
      var paramLocate = task.param ? task.param.locate : undefined;
      var loc = MidsceneClient._extractLocate(paramLocate);
      var val = (task.param && task.param.value !== undefined)
        ? String(task.param.value)
        : (task.thought || '');
      if (loc && val) return loc + ' - ' + val;
      return loc || val || '';
    }
    return '';
  }

  // ----------------------------------------------------------
  // 핵심: 진행 상황 포함 실행
  // ----------------------------------------------------------

  async executeWithProgress(type, payload) {
    var requestId = Date.now().toString();
    this.currentRequestId = requestId;
    var printed = new Set();

    this.startProgressPolling(requestId, printed);

    try {
      var body = Object.assign({ type: type, requestId: requestId }, payload);
      var result = await this.request('POST', '/execute', body);

      var dumpTasks = result.dump ? result.dump.tasks : undefined;
      this.logNewTasks(dumpTasks, printed);

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
    var result = await this.request('GET', '/status');
    console.log('서버 상태: ' + result.status + ', ID: ' + result.id);
    return result;
  }

  async screenshot() {
    var result = await this.request('GET', '/screenshot');
    if (result.screenshot) {
      console.log('스크린샷 수신 (' + result.screenshot.length + ' chars base64)');
    }
    return result;
  }

  async cancel(requestId) {
    return this.request('POST', '/cancel/' + requestId);
  }

  // ----------------------------------------------------------
  // AI 액션 메서드들
  // ----------------------------------------------------------

  async aiAct(prompt) {
    console.log('aiAct: "' + prompt + '"');
    return this.executeWithProgress('aiAct', { prompt: prompt });
  }

  async aiAssert(prompt) {
    console.log('aiAssert: "' + prompt + '"');
    var result = await this.executeWithProgress('aiAssert', { prompt: prompt });
    console.log('  result: ' + JSON.stringify(result.result));
    return result;
  }

  async aiWaitFor(prompt, opts) {
    if (opts === undefined) opts = {};
    console.log('aiWaitFor: "' + prompt + '"');
    return this.executeWithProgress('aiWaitFor', { prompt: prompt, params: opts });
  }

  // ----------------------------------------------------------
  // 헬퍼 (static)
  // ----------------------------------------------------------

  static _extractLocate(locate) {
    if (!locate) return '';
    if (typeof locate === 'string') return locate;
    if (typeof locate.prompt === 'object' && locate.prompt && locate.prompt.prompt) {
      return locate.prompt.prompt;
    }
    if (typeof locate.prompt === 'string') return locate.prompt;
    if (typeof locate.description === 'string') return locate.description;
    return '';
  }
}


module.exports = MidsceneClient