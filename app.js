(function () {
  'use strict';

  var MAX_CHARS = 30000;

  var els = {
    input: document.getElementById('input'),
    output: document.getElementById('output'),
    outMeta: document.getElementById('outMeta'),
    charCount: document.getElementById('charCount'),
    runBtn: document.getElementById('runBtn'),
    runBtnLabel: document.getElementById('runBtnLabel'),
    genre: document.getElementById('genre'),
    modeRules: document.getElementById('modeRules'),
    modeLlm: document.getElementById('modeLlm'),
    toolbarNote: document.getElementById('toolbarNote'),
    sampleBtn: document.getElementById('sampleBtn'),
    clearBtn: document.getElementById('clearBtn'),
    copyBtn: document.getElementById('copyBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    stats: document.getElementById('stats'),
    statBadges: document.getElementById('statBadges'),
    findingsWrap: document.getElementById('findingsWrap'),
    findingChips: document.getElementById('findingChips'),
    settingsBtn: document.getElementById('settingsBtn'),
    settingsDialog: document.getElementById('settingsDialog'),
    llmStatus: document.getElementById('llmStatus'),
    cfgOrigin: document.getElementById('cfgOrigin'),
    cfgSavedInfo: document.getElementById('cfgSavedInfo'),
    cfgBaseUrl: document.getElementById('cfgBaseUrl'),
    cfgApiKey: document.getElementById('cfgApiKey'),
    cfgModel: document.getElementById('cfgModel'),
    cfgTest: document.getElementById('cfgTest'),
    cfgDiagnose: document.getElementById('cfgDiagnose'),
    cfgTestResult: document.getElementById('cfgTestResult')
  };

  // ---------------------------------------------------------------------------
  // LLM config (localStorage) — MUST be defined before `state` below:
  // loadLlmConfig() runs at boot, and referencing an unassigned var here
  // silently yields {} defaults (the "baseUrl: undefined" bug).
  // ---------------------------------------------------------------------------

  var LLM_DEFAULTS = {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4.1-mini'
  };
  var LLM_STORE_KEY = 'humanize-llm-config';

  // Heal records saved with a literal "undefined"/"null" string (older bug).
  function cleanStr(v, fallback) {
    return (typeof v === 'string' && v && v !== 'undefined' && v !== 'null') ? v : fallback;
  }

  function loadLlmConfig() {
    var stored = {};
    try {
      var raw = localStorage.getItem(LLM_STORE_KEY);
      if (raw) stored = JSON.parse(raw) || {};
    } catch (e) { /* corrupt record or blocked storage — fall back to defaults */ }
    return {
      baseUrl: normalizeBaseUrl(cleanStr(stored.baseUrl, LLM_DEFAULTS.baseUrl)),
      apiKey: cleanStr(stored.apiKey, LLM_DEFAULTS.apiKey),
      model: cleanStr(stored.model, LLM_DEFAULTS.model)
    };
  }

  // Heal Base URLs saved by the old diagnose fill, which prefixed the page
  // origin onto the provider URL ("http://localhost:8765https://api.z.ai/…").
  // The real URL is the embedded one — official URLs are used verbatim
  // (chatRequest routes them via X-Target-URL), so drop the prefix.
  function normalizeBaseUrl(v) {
    var m = String(v || '').match(/^https?:\/\/[^/]+(https?:\/\/\S+)$/);
    return m ? m[1] : v;
  }

  function saveLlmConfig() {
    try {
      localStorage.setItem(LLM_STORE_KEY, JSON.stringify(state.llm));
    } catch (e) { /* private mode etc. — config just won't persist */ }
  }

  // ---------------------------------------------------------------------------
  // Endpoint helpers
  // ---------------------------------------------------------------------------

  // Known OpenAI-compatible roots per provider — used to hint at the correct
  // Base URL when a gateway answers 404 (path not found).
  var PROVIDER_HINTS = [
    { re: /api\.openai\.com/i, url: 'https://api.openai.com/v1' },
    { re: /openrouter\.ai/i, url: 'https://openrouter.ai/api/v1' },
    // Z.ai/BigModel keys are injected per host by serve.ts — hint the official URLs.
    { re: /api\.z\.ai/i, url: 'https://api.z.ai/api/coding/paas/v4' },
    { re: /bigmodel\.cn/i, url: 'https://open.bigmodel.cn/api/paas/v4' },
    { re: /dashscope\.aliyuncs\.com/i, url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    { re: /api\.deepseek\.com/i, url: 'https://api.deepseek.com' },
    { re: /api\.moonshot\.(cn|ai)/i, url: 'https://api.moonshot.cn/v1' },
    { re: /api\.groq\.com/i, url: 'https://api.groq.com/openai/v1' },
    { re: /api\.together\.(xyz|ai)/i, url: 'https://api.together.xyz/v1' },
    { re: /api\.mistral\.ai/i, url: 'https://api.mistral.ai/v1' },
    { re: /api\.x\.ai/i, url: 'https://api.x.ai/v1' },
    { re: /generativelanguage\.googleapis\.com/i, url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
    { re: /api\.anthropic\.com/i, url: 'https://api.anthropic.com/v1' },
    { re: /localhost:11434/i, url: 'http://localhost:11434/v1' },
    { re: /localhost:1234/i, url: 'http://localhost:1234/v1' }
  ];

  function providerHint(url) {
    for (var i = 0; i < PROVIDER_HINTS.length; i++) {
      if (PROVIDER_HINTS[i].re.test(url)) return PROVIDER_HINTS[i].url;
    }
    return null;
  }

  function pathNotFoundMessage(chatUrl) {
    var hint = providerHint(chatUrl);
    return '엔드포인트가 경로를 찾지 못했습니다(404). 호출한 주소: ' + chatUrl +
      '. Base URL은 /chat/completions 없이 API 루트여야 합니다' +
      (hint ? ' — 이 공급자는 보통 ' + hint : '') + '.';
  }

  // Resolve the chat endpoint for a configured Base URL. Official provider
  // URLs (https://api.z.ai/..., https://api.anthropic.com, ...) can be used
  // verbatim: the browser posts to the local /llm forwarder with the target
  // in X-Target-URL, and serve.ts performs the real call (CORS + protocol
  // translation + .env key injection). Same-origin /proxy/... URLs (legacy)
  // are still called directly.
  function chatRequest(baseUrl) {
    var b = String(baseUrl || '').replace(/\/+$/, '');
    if (b === location.origin || b.indexOf(location.origin + '/') === 0) {
      return { url: b + '/chat/completions', headers: {}, targetChatUrl: b + '/chat/completions' };
    }
    return {
      url: location.origin + '/llm/chat/completions',
      headers: { 'X-Target-URL': b },
      targetChatUrl: b + '/chat/completions'
    };
  }

  // Z.ai/bigmodel style auth failure — the request reached the gateway but
  // the key was rejected. Usually a key/endpoint pairing problem.
  function authFailureMessage(apiErrMsg) {
    return 'API가 키를 거부했습니다: ' + String(apiErrMsg).slice(0, 120) +
      ' — 확인할 것: ① 키 발급 플랫폼과 Base URL이 맞는지 (z.ai 국제 키 → api.z.ai, 빅모델(중국) 키 → open.bigmodel.cn, 코딩 플랜 키 → …/api/coding/paas/v4) ② 키 만료·재발급 여부 ③ 복사 누락·공백 없는지. ZCode 등 다른 도구에 저장된 토큰은 만료된 OAuth 토큰일 수 있으니 콘솔에서 발급한 API 키를 권장합니다.';
  }

  var state = {
    mode: 'rules', // 'rules' | 'llm'
    running: false,
    result: null, // polished text (for copy/download)
    llm: loadLlmConfig(),
    env: null // { keyConfigured, baseUrl?, model? } from serve.py /env-config
  };
  var SAMPLE_TEXT = [
    '결론적으로, AI 기술은 우리 산업 전반에 있어 매우 중요한 전환점에 서 있다.',
    '기업들은 방대한 데이터를 모으고, 분석하고, 그 결과를 시각화하는 데 이 기술을 활용하고 있다.',
    '즉, 데이터 기반 의사결정은 이제 선택이 아니다.',
    '',
    '중요한 것은 신뢰다.',
    'AI에 의해 생성된 콘텐츠는 투명하게 공개되어져야 하며, 이는 시사하는 바가 크다.',
    '주목할 점은, 이 변화가 단순한 도구의 등장을 넘어 조직 문화의 재편이라는 것이다.',
    '그러므로, 기업들은 AI 거버넌스(AI Governance)를 먼저 설계해야 한다.',
    '즉, 기술 도입에 앞서 원칙이 먼저다.',
    '',
    '크게 세 가지로 나눌 수 있다: 원칙 수립, 프로세스 정비, 교육 확산.',
    '원칙 수립은 조직의 가치를 명문화하는 작업이다.',
    '프로세스 정비는 검토 단계를 명확히 하는 작업이다.',
    '교육 확산은 구성원의 이해를 높이는 작업이다.',
    '',
    '요약하면, AI는 도구이며 그 활용의 무게는 우리에게 달려 있다.',
    '앞으로 AI는 우리 삶의 모든 영역으로 확산되어질 것이다.',
    '필요한 것은 균형이다.'
  ].join('\n');

  // ---------------------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------------------

  function setMode(mode) {
    state.mode = mode;
    els.modeRules.classList.toggle('active', mode === 'rules');
    els.modeLlm.classList.toggle('active', mode === 'llm');
    els.modeRules.setAttribute('aria-checked', String(mode === 'rules'));
    els.modeLlm.setAttribute('aria-checked', String(mode === 'llm'));
    els.toolbarNote.textContent = mode === 'rules'
      ? '규칙 기반 모드는 인터넷·API 키 없이 동작합니다. 문맥까지 다듬으려면 LLM 모드를 사용하세요.'
      : 'LLM 모드는 설정한 API로 원본 humanize-monolith 프롬프트를 실행합니다. 추론 모델(GLM-5.3 계열 등)은 1~3분 걸릴 수 있습니다.';
    updateLlmStatus();
  }

  // Toolbar chip that always shows whether the LLM key is actually loaded —
  // the "configured but app says no key" confusion almost always means the
  // settings were saved in a different browser profile/tab/origin than the
  // one running, so the truth must be visible next to the run button.
  function envKeyConfigured() {
    return !!(state.env && state.env.keyConfigured);
  }

  function updateLlmStatus() {
    var el = els.llmStatus;
    if (!el) return;
    if (state.mode !== 'llm') { el.hidden = true; return; }
    el.hidden = false;
    if (state.llm.apiKey) {
      el.textContent = '● 키 저장됨 · ' + (state.llm.model || '모델 미지정');
      el.className = 'llm-status ok';
    } else if (envKeyConfigured()) {
      el.textContent = '● 키 설정됨 (.env) · ' + (state.llm.model || '모델 미지정');
      el.className = 'llm-status ok';
    } else {
      el.textContent = '○ API 키 없음 — 클릭해서 설정';
      el.className = 'llm-status none';
    }
    el.title = '클릭하면 LLM 설정을 엽니다';
  }

  function openSettings() {
    els.cfgBaseUrl.value = state.llm.baseUrl || LLM_DEFAULTS.baseUrl;
    els.cfgApiKey.value = state.llm.apiKey || '';
    els.cfgModel.value = state.llm.model || LLM_DEFAULTS.model;
    els.cfgTestResult.textContent = '';
    if (els.cfgOrigin) {
      els.cfgOrigin.textContent = location.origin === 'null' ? 'file:// (이 파일)' : location.origin;
    }
    if (els.cfgSavedInfo) {
      if (state.llm.apiKey) {
        els.cfgSavedInfo.textContent = '현재 저장된 키: ••••' + state.llm.apiKey.slice(-4) + ' · 모델: ' + (state.llm.model || '(미지정)');
      } else if (envKeyConfigured()) {
        els.cfgSavedInfo.textContent = '키: .env 파일에서 서버가 주입합니다 (브라우저에 저장되지 않음) · 모델: ' + (state.llm.model || '(미지정)');
      } else {
        els.cfgSavedInfo.textContent = '현재 저장된 키가 없습니다.';
      }
    }
    els.settingsDialog.showModal();
  }

  function updateCharCount() {
    var len = els.input.value.length;
    els.charCount.textContent = len.toLocaleString('ko-KR') + '자';
    els.charCount.style.color = len > MAX_CHARS ? '#dc2626' : '';
  }

  function setRunning(running) {
    state.running = running;
    els.runBtn.disabled = running;
    els.runBtn.classList.toggle('is-running', running);
    els.runBtnLabel.textContent = running ? '윤문 중…' : '윤문하기';
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderOutput(text) {
    els.output.classList.remove('is-empty');
    els.output.innerHTML = '<div class="output-text"></div>';
    els.output.querySelector('.output-text').textContent = text;
    els.copyBtn.disabled = false;
    els.downloadBtn.disabled = false;
    state.result = text;
  }

  function renderStats(before, after, applied, rate, mode) {
    var badges = [];

    badges.push(badge('처리', mode === 'rules' ? '규칙 기반' : 'LLM', 'muted'));
    badges.push(badge('변경률', Math.round(rate * 1000) / 10 + '%',
      rate >= 0.5 ? 'bad' : rate >= 0.3 ? 'warn' : 'good'));
    badges.push(badge('AI 티 신호', before.total + '건 → ' + after.total + '건',
      after.total === 0 ? 'good' : after.total < before.total ? 'warn' : 'bad'));
    badges.push(badge('세부', 'S1 ' + before.s1 + '→' + after.s1 + ' · S2 ' + before.s2 + '→' + after.s2, 'muted'));

    if (mode === 'llm') {
      // Grade per upstream quick-rules self-scoring — meaningful for LLM output,
      // which is expected to clear detect-only residuals. Rule mode cannot
      // (by design), so it shows a reduction figure instead of a fake grade.
      var g = HumanizeRules.grade(after, rate);
      badges.push(badge('등급', g.level + '등급', g.level === 'A' ? 'good' : g.level === 'B' ? 'warn' : 'bad'));
    } else if (before.total > 0) {
      var drop = Math.round((1 - after.total / before.total) * 100);
      badges.push(badge('패턴 감소', drop + '%', drop >= 50 ? 'good' : drop > 0 ? 'warn' : 'bad'));
    }

    els.statBadges.innerHTML = badges.join('');

    // Applied fix list (rules mode) — chips of rule hits in the ORIGINAL text.
    var chips = [];
    before.findings.forEach(function (f) {
      chips.push(
        '<span class="chip sev' + f.severity + '" title="' + esc(f.name) + '">' +
        '<strong>' + f.id + '</strong> ' + esc(f.name) +
        ' <em>×' + f.count + '</em></span>'
      );
    });
    els.findingChips.innerHTML = chips.length
      ? chips.join('')
      : '<span class="chip ok">뚜렷한 AI 티 패턴이 탐지되지 않았습니다</span>';

    var fixedLine = applied && applied.length
      ? ' 자동 수정: ' + applied.map(function (a) { return a.id + ' ×' + a.count; }).join(', ') + '.'
      : '';
    var noFixNote = '';
    if (mode === 'rules' && (!applied || !applied.length) && after.total > 0) {
      noFixNote = ' 남은 신호는 임계 미달이거나 문맥 재작성이 필요한 패턴(감지 전용)이라 자동 수정 대상이 아닙니다 — 문맥 다듬기는 LLM 모드를 사용하세요.';
    }
    var gradeNote = '';
    if (mode === 'llm') {
      var g2 = HumanizeRules.grade(after, rate);
      if (g2.level === 'C' || g2.level === 'D') gradeNote = ' ' + g2.reason + '.';
    }
    els.outMeta.textContent = '원문 ' + before.total + '건 → 결과 ' + after.total + '건.' + fixedLine + noFixNote + gradeNote;

    els.stats.hidden = false;
  }

  function badge(label, value, tone) {
    return '<span class="stat-badge ' + tone + '"><em>' + esc(label) + '</em>' + esc(value) + '</span>';
  }

  function showError(msg) {
    els.stats.hidden = false;
    els.statBadges.innerHTML = '<span class="stat-badge bad"><em>오류</em>' + esc(msg) + '</span>';
    els.findingChips.innerHTML = '';
    els.outMeta.textContent = '';
  }

  // ---------------------------------------------------------------------------
  // Polish pipelines
  // ---------------------------------------------------------------------------

  function polishRules(text) {
    var before = HumanizeRules.analyze(text);
    var res = HumanizeRules.polish(text);
    var after = HumanizeRules.analyze(res.text);
    var rate = HumanizeRules.changeRate(text, res.text);
    renderOutput(res.text);
    renderStats(before, after, res.applied, rate, 'rules');
  }

  async function polishLlm(text) {
    var cfg = state.llm;
    if (!cfg.apiKey && !envKeyConfigured()) {
      var err = new Error('API 키가 없습니다. .env 파일(LLM_API_KEY)에 등록하거나 설정창에서 저장하세요. (다른 탭·다른 주소에서 저장한 설정은 여기에 적용되지 않습니다.)');
      err.noKey = true;
      throw err;
    }
    var baseUrl = cleanStr(cfg.baseUrl, LLM_DEFAULTS.baseUrl);
    var chat = chatRequest(baseUrl);
    var body = {
      model: cfg.model,
      messages: [
        { role: 'system', content: HumanizePrompt.system(els.genre.value) },
        { role: 'user', content: text }
      ]
    };
    // Reasoning models (o1/o3/o4, gpt-5*) reject the temperature parameter.
    if (!/(^|\/)(o[134](-|$)|gpt-5)/i.test(cfg.model)) body.temperature = 0.4;
    // Z.ai GLM reasons by default; its thinking can consume the whole output
    // budget (empty content, finish_reason "length"). For GLM on Zhipu-family
    // endpoints, disable thinking and size the output cap with the input.
    if (/^glm/i.test(cfg.model) && /z\.ai|bigmodel\.cn/i.test(baseUrl)) {
      body.max_tokens = Math.min(131072, Math.max(8192, text.length * 2));
      body.thinking = { type: 'disabled' };
    }
    // With no browser-side key, leave Authorization unset — serve.ts injects
    // the .env key server-side (the key value never reaches the browser).
    var headers = Object.assign({ 'Content-Type': 'application/json' }, chat.headers);
    if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
    var resp;
    try {
      resp = await fetch(chat.url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new Error('API에 연결할 수 없습니다. 대부분 공급자가 브라우저 직접 호출(CORS)을 차단하기 때문입니다(Z.ai·Anthropic·Gemini 등). ' +
        'bun serve.ts (또는 node serve.ts)로 실행 중인지 확인하세요. 공급자 공식 Base URL을 그대로 입력하면 이 서버가 호출을 대행합니다. — ' + (e.message || ''));
    }
    if (!resp.ok) {
      var errBody = await resp.text().catch(function () { return ''; });
      throw new Error('API 오류 ' + resp.status + ': ' + errBody.slice(0, 160));
    }

    // Parse robustly — gateways return many shapes: 200+error body, legacy
    // completions, content-as-parts array, or truncated reasoning output.
    var respText = '';
    var data = null;
    try {
      respText = await resp.text();
      data = JSON.parse(respText);
    } catch (e) {
      throw new Error('API 응답이 JSON이 아닙니다. Base URL 경로를 확인하세요 (…/v1). — ' + respText.slice(0, 120));
    }
    if (data && (data.error || data.success === false || (data.code && data.msg))) {
      // Covers both {error:{...}} and CN-gateway style {code,msg,success:false}.
      var apiErrMsg = (data.error && (data.error.message || data.error.msg)) ||
        data.msg || JSON.stringify(data.error || data);
      apiErrMsg = String(apiErrMsg).slice(0, 160);
      if (/NOT[_ ]?FOUND|(^|[^0-9])404([^0-9]|$)/i.test(apiErrMsg + ' ' + respText.slice(0, 200))) {
        throw new Error(pathNotFoundMessage(chat.targetChatUrl) + ' — 게이트웨이 응답: ' + apiErrMsg);
      }
      if (looksAuthFailure(apiErrMsg) || (resp.status === 401)) {
        throw new Error(authFailureMessage(apiErrMsg));
      }
      throw new Error('API가 오류를 반환했습니다: ' + apiErrMsg);
    }

    var choice = data && data.choices && data.choices[0];
    var content = '';
    if (choice) {
      var msg = choice.message || {};
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content.map(function (p) {
          return (p && typeof p.text === 'string') ? p.text : '';
        }).join('');
      }
      if (!content && typeof choice.text === 'string') content = choice.text; // legacy completions
    }
    if (!String(content).trim()) {
      if (/NOT[_ ]?FOUND|"code"\s*:\s*404/.test(respText)) {
        throw new Error(pathNotFoundMessage(chat.targetChatUrl) + ' — 응답: ' + respText.slice(0, 100));
      }
      var reason = choice ? (choice.finish_reason || '?') : 'choices 없음';
      var hint = reason === 'length'
        ? ' — 응답이 길이 제한으로 잘렸습니다. 모델이 추론에 출력 한도를 소모했을 수 있으니 원문을 나눠 시도하거나 다른 모델을 사용해 보세요. '
        : (reason === 'content_filter' ? ' — 응답이 콘텐츠 필터에 걸렸습니다. ' : ' ');
      throw new Error('응답에서 윤문 본문을 찾지 못했습니다 (finish_reason: ' + reason + ').' + hint +
        '응답 본문: ' + JSON.stringify(data).slice(0, 140));
    }
    var out = String(content).trim();

    // Strip a fenced wrapper if the model added one despite instructions.
    out = out.replace(/^```(?:markdown|md|text)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

    var before = HumanizeRules.analyze(text);
    var after = HumanizeRules.analyze(out);
    var rate = HumanizeRules.changeRate(text, out);
    renderOutput(out);
    renderStats(before, after, null, rate, 'llm');
  }

  async function run() {
    if (state.running) return;
    var text = els.input.value.trim();
    if (!text) {
      showError('원문을 입력하세요.');
      els.input.focus();
      return;
    }
    if (!/[가-힣]/.test(text)) {
      showError('한국어 텍스트만 처리할 수 있습니다.');
      return;
    }
    if (text.length > MAX_CHARS) {
      showError('입력이 ' + MAX_CHARS.toLocaleString('ko-KR') + '자를 초과합니다. 현재 ' + text.length.toLocaleString('ko-KR') + '자.');
      return;
    }

    setRunning(true);
    els.output.classList.add('is-empty');
    els.output.innerHTML = '<p class="output-placeholder">윤문 중입니다…</p>';
    try {
      if (state.mode === 'rules') polishRules(text);
      else await polishLlm(text);
    } catch (e) {
      showError(e.message || '알 수 없는 오류가 발생했습니다.');
      els.output.classList.add('is-empty');
      els.output.innerHTML = '<p class="output-placeholder">왼쪽에 원문을 넣고 <strong>윤문하기</strong>를 누르면<br />여기에 결과가 표시됩니다.</p>';
      if (e.noKey) {
        // The user's config and this tab disagree — surface the settings
        // dialog immediately so the mismatch is visible.
        openSettings();
      }
    } finally {
      setRunning(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Wire-up
  // ---------------------------------------------------------------------------

  els.runBtn.addEventListener('click', run);
  els.input.addEventListener('input', updateCharCount);
  els.modeRules.addEventListener('click', function () { setMode('rules'); });
  els.modeLlm.addEventListener('click', function () { setMode('llm'); });

  els.sampleBtn.addEventListener('click', function () {
    els.input.value = SAMPLE_TEXT;
    updateCharCount();
    els.input.focus();
  });

  els.clearBtn.addEventListener('click', function () {
    els.input.value = '';
    updateCharCount();
    els.input.focus();
  });

  els.copyBtn.addEventListener('click', function () {
    if (!state.result) return;
    navigator.clipboard.writeText(state.result).then(function () {
      var b = els.copyBtn;
      var orig = b.textContent;
      b.textContent = '복사됨';
      setTimeout(function () { b.textContent = orig; }, 1200);
    });
  });

  els.downloadBtn.addEventListener('click', function () {
    if (!state.result) return;
    var blob = new Blob([state.result], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'humanized-' + new Date().toISOString().slice(0, 10) + '.md';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // Settings dialog
  els.settingsBtn.addEventListener('click', openSettings);
  els.llmStatus.addEventListener('click', openSettings);

  // Key diagnosis: probe the entered key against every known provider family
  // (all via the local proxy — serve.ts translates Anthropic/Gemini to their
  // native protocols). A 401 means the key string itself is rejected; ANY
  // other response means the key passed auth.
  var DIAGNOSE_CANDIDATES = [
    { label: 'Z.ai 일반 (paas/v4)', baseUrl: 'https://api.z.ai/api/paas/v4', model: 'glm-5.3-flash' },
    { label: 'Z.ai 코딩 플랜 (coding/paas/v4)', baseUrl: 'https://api.z.ai/api/coding/paas/v4', model: 'glm-5.3-flash' },
    { label: '빅모델 일반 (중국)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3-flash' },
    { label: '빅모델 코딩 플랜 (중국)', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', model: 'glm-5.3-flash' },
    { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
    { label: 'Anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-4-5' },
    { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' },
    { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' }
  ];

  function looksAuthFailure(text) {
    return /token expired|token incorrect|invalid[_ ]api[_ ]key|api key is invalid|please pass a valid api key|authentication_error|unauthorized|(^|[^0-9])401([^0-9]|$)/i.test(text);
  }

  els.cfgDiagnose.addEventListener('click', async function () {
    var apiKey = els.cfgApiKey.value.trim();
    var out = els.cfgTestResult;
    out.style.color = '';
    if (!apiKey && !envKeyConfigured()) {
      out.textContent = '키를 먼저 입력하거나 .env에 LLM_API_KEY(또는 공급자별 키)를 설정하세요.';
      return;
    }
    var keyLabel = apiKey ? '브라우저 저장 키' : '.env 키(호스트별 주입)';
    out.textContent = '진단 중… (' + keyLabel + '로 ' + DIAGNOSE_CANDIDATES.length + '개 엔드포인트 순서대로 확인, 최대 수십 초)';
    var lines = [];
    var accepted = null, acceptRank = 99;
    for (var i = 0; i < DIAGNOSE_CANDIDATES.length; i++) {
      var c = DIAGNOSE_CANDIDATES[i];
      var line = c.label + ': ';
      var accept = function (rank) {
        if (!accepted || rank < acceptRank) { accepted = c.baseUrl; acceptRank = rank; }
      };
      try {
        var probeHeaders = Object.assign({ 'Content-Type': 'application/json' }, chatRequest(c.baseUrl).headers); // X-Target-URL for official URLs
        if (apiKey) probeHeaders['Authorization'] = 'Bearer ' + apiKey; // else serve.ts injects the .env key per host
        var resp = await fetch(location.origin + '/llm/chat/completions', {
          method: 'POST',
          headers: probeHeaders,
          body: JSON.stringify({ model: c.model, messages: [{ role: 'user', content: 'ping' }] })
        });
        var text = await resp.text();
        var data = null;
        try { data = JSON.parse(text); } catch (e) { /* non-JSON */ }
        if (resp.ok && data && data.choices && data.choices.length) {
          line += '✓ 키 승인 + 정상 응답';
          accept(1);
        } else if (resp.status === 401 || looksAuthFailure(text)) {
          line += '✕ 키 거부';
        } else if (resp.status === 429) {
          line += '△ 429(쿼터·속도 제한) — 인증 통과로 보이니 잔액·쿼터 확인';
          accept(2);
        } else if (resp.ok) {
          line += '△ 키는 승인된 듯하나 응답 형식 상이: ' + text.slice(0, 60);
          accept(2);
        } else {
          // 모델 미발견 등 인증 외 오류 = 키 자체는 통과했다는 신호.
          line += '△ 키 승인으로 보임 — HTTP ' + resp.status + ': ' + text.slice(0, 60);
          accept(3);
        }
      } catch (e) {
        line += '✕ 연결 실패 — serve.ts(bun)가 실행 중인지 확인하세요';
      }
      lines.push(line);
      // Progress display: completed lines + next probe in flight.
      out.textContent = lines.join('\n') + (i < DIAGNOSE_CANDIDATES.length - 1 ? '\n…' : '');
    }
    if (accepted) {
      // Official provider URLs are used verbatim — chatRequest sends them to
      // the local forwarder via X-Target-URL, no origin prefixing needed.
      els.cfgBaseUrl.value = accepted;
      lines.push('');
      lines.push('→ Base URL을 "' + els.cfgBaseUrl.value + '"(으)로 채웠습니다. [저장하고 닫기]를 누르세요.');
    } else {
      lines.push('');
      lines.push('→ 모든 엔드포인트가 키를 거부했습니다. 쓰시는 공급자 콘솔에서 새 키를 발급해 붙여넣으세요.');
    }
    out.style.color = accepted ? '#15803d' : '#dc2626';
    out.textContent = lines.join('\n');
  });

  els.cfgTest.addEventListener('click', async function () {
    var baseUrl = els.cfgBaseUrl.value.trim();
    var apiKey = els.cfgApiKey.value.trim();
    var model = els.cfgModel.value.trim();
    var chat = chatRequest(baseUrl);
    var targetChatUrl = chat.targetChatUrl;
    els.cfgTestResult.textContent = '확인 중…';
    try {
      var testHeaders = Object.assign({ 'Content-Type': 'application/json' }, chat.headers);
      if (apiKey) testHeaders['Authorization'] = 'Bearer ' + apiKey; // else serve.ts injects .env key
      var resp = await fetch(chat.url, {
        method: 'POST',
        headers: testHeaders,
        // No max_tokens/temperature here — reasoning models (o*, gpt-5*)
        // reject them and the ping costs only a handful of tokens anyway.
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: 'ping' }]
        })
      });
      var text = await resp.text();
      var data = null;
      try { data = JSON.parse(text); } catch (e) { /* non-JSON body */ }
      var hasChoices = data && data.choices && data.choices.length;
      var gatewayError = data && (data.error || data.success === false || (data.code && data.msg));
      if (resp.ok && hasChoices) {
        els.cfgTestResult.textContent = '✓ 연결 성공';
        els.cfgTestResult.style.color = '#15803d';
      } else if (/NOT[_ ]?FOUND|"code"\s*:\s*404|status.*404/.test(text) || (resp.status === 404)) {
        els.cfgTestResult.textContent = '✕ ' + pathNotFoundMessage(targetChatUrl);
        els.cfgTestResult.style.color = '#dc2626';
      } else if (resp.status === 401) {
        els.cfgTestResult.textContent = '✕ ' + authFailureMessage(text.slice(0, 100));
        els.cfgTestResult.style.color = '#dc2626';
      } else if (gatewayError) {
        var em = (data.error && (data.error.message || data.error.msg)) || data.msg || text.slice(0, 80);
        if (looksAuthFailure(String(em)) || resp.status === 401) {
          els.cfgTestResult.textContent = '✕ ' + authFailureMessage(em);
        } else {
          els.cfgTestResult.textContent = '✕ API 오류: ' + String(em).slice(0, 100);
        }
        els.cfgTestResult.style.color = '#dc2626';
      } else if (resp.ok) {
        els.cfgTestResult.textContent = '△ 응답은 왔지만 형식이 다릅니다: ' + text.slice(0, 80);
        els.cfgTestResult.style.color = '#b45309';
      } else {
        els.cfgTestResult.textContent = '✕ 응답 ' + resp.status + ' — URL·키·모델명을 확인하세요';
        els.cfgTestResult.style.color = '#dc2626';
      }
    } catch (e) {
      els.cfgTestResult.textContent = '✕ 연결 실패 — 공급자가 브라우저 호출(CORS)을 차단할 수 있습니다. bun serve.ts 실행 후 Base URL을 http://localhost:8765/proxy/<호스트> 형태로 설정하세요.';
      els.cfgTestResult.style.color = '#dc2626';
    }
  });

  els.settingsDialog.addEventListener('close', function () {
    state.llm.baseUrl = normalizeBaseUrl(cleanStr(els.cfgBaseUrl.value.trim(), LLM_DEFAULTS.baseUrl));
    state.llm.apiKey = cleanStr(els.cfgApiKey.value.trim(), LLM_DEFAULTS.apiKey);
    state.llm.model = cleanStr(els.cfgModel.value.trim(), LLM_DEFAULTS.model);
    saveLlmConfig();
    updateLlmStatus();
    // Mirror the save into the server's .env so it survives restarts and is
    // shared by every browser that opens this app. Best-effort — plain static
    // servers have no /env-save. An empty key field keeps the existing .env key.
    var payload = { baseUrl: state.llm.baseUrl, model: state.llm.model };
    if (state.llm.apiKey) payload.apiKey = state.llm.apiKey;
    fetch('/env-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error('env-save HTTP ' + r.status);
      return loadEnvConfig(); // re-sync .env-backed status (baseUrl/model/key notice)
    }).catch(function () { /* /env-save 없음(구버전·정적 서버) — 브라우저 저장만 유지 */ });
  });

  // Ctrl/Cmd+Enter runs.
  els.input.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run();
  });

  updateCharCount();
  setMode('rules');

  // Load server-side .env config (serve.ts). Values present in .env override
  // browser-stored settings on every boot; the key value itself never leaves
  // the server — the proxy injects it on outgoing requests. Re-run after
  // /env-save to refresh the .env-backed status text.
  function loadEnvConfig() {
    return fetch('/env-config', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('env-config HTTP ' + r.status);
      return r.json();
    }).then(function (env) {
      if (!env || typeof env !== 'object') return;
      state.env = { keyConfigured: !!env.keyConfigured };
      if (env.baseUrl) state.llm.baseUrl = env.baseUrl;
      if (env.model) state.llm.model = env.model;
      updateLlmStatus();
    }).catch(function () { /* file:// or plain static server — no /env-config endpoint */ });
  }
  loadEnvConfig();
})();
