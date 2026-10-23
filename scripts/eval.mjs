#!/usr/bin/env bun
/**
 * eval — 오프라인 평가 하네스 (규칙 엔진을 메트릭으로 쓰는 프롬프트 개선 루프).
 *
 *   bun scripts/eval.mjs                          # 규칙 엔진 기준점 (오프라인)
 *   bun scripts/eval.mjs --llm                    # LLM 모드 (bun serve.ts 실행 중)
 *   bun scripts/eval.mjs --llm --prompt var.md --out run-b.json
 *   bun scripts/eval.mjs --llm --compare run-a.json   # 기준 런과 비교
 *   bun scripts/eval.mjs --only col-settle,long-rhythm --llm
 *
 * LLM 호출은 이 스크립트가 공급자를 직접 두드리지 않는다 — 실행 중인
 * serve.ts의 /llm/chat/completions 프록시를 경유한다(키 주입·프로토콜 변환은
 * 서버 몫, 스크립트는 .env에 손도 대지 않는다). 서버가 없으면 오프라인 모드로
 * 돌리거나 `bun serve.ts`를 먼저 띄운다.
 *
 * 메트릭 한계(중요): 점수는 규칙 엔진이 내는 프록시 점수다. 엔진이 아는 47개
 * 패턴밖에 보지 못하므로 "엔진을 통과하지만 실제로는 나쁜 윤문"을 잡지 못한다.
 * 순위 매기기 보조 도구이지 자동 심판이 아니며, 최종 판단은 run JSON의 결과물
 * 원문을 사람이 읽고 내린다. 배경은 docs/adr/0006 참조.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../lib/engine.mjs';
import {
  loadCorpus, validateCorpus, evaluateFixture, summarizeRun, diffRuns, promptSha
} from '../lib/eval-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- args -------------------------------------------------------------------

const argv = process.argv.slice(2);
function argValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
const hasFlag = name => argv.includes(name);

const MODE_LLM = hasFlag('--llm');
const corpusPath = resolve(ROOT, argValue('--corpus') ?? 'eval/corpus.json');
const server = (argValue('--server') ?? 'http://127.0.0.1:8765').replace(/\/+$/, '');
const promptFile = argValue('--prompt');
const outFile = argValue('--out');
const compareFile = argValue('--compare');
const asJson = hasFlag('--json');
const onlyIds = (argValue('--only') ?? '').split(',').map(s => s.trim()).filter(Boolean);

// --- setup -------------------------------------------------------------------

const { Rules, Prompt } = loadEngine();
const corpusAll = loadCorpus(corpusPath);
const corpus = onlyIds.length ? corpusAll.filter(f => onlyIds.includes(f.id)) : corpusAll;
if (corpus.length === 0) {
  console.error('--only에 해당하는 픽스처가 없습니다:', onlyIds.join(', '));
  console.error('사용 가능:', corpusAll.map(f => f.id).join(', '));
  process.exit(1);
}

const invalid = validateCorpus(Rules, corpusAll);
if (!invalid.ok) {
  console.error('⚠ 코퍼스 기대 신호 미발화 — 픽스처가 규칙 변화로 썩었거나 엔진이 회귀했습니다:');
  for (const p of invalid.problems) console.error(`  ${p.fixture}: ${p.missing.join(', ')}`);
  console.error('(계속 진행하지만 참고하세요. bun test.mjs도 이 검사를 합니다.)');
}

let systemPromptText = null;
let systemPromptSource = 'engine';
if (promptFile) {
  systemPromptText = readFileSync(resolve(promptFile), 'utf8');
  systemPromptSource = resolve(promptFile);
}

// --- LLM via local server proxy ----------------------------------------------

async function resolveLlmConfig() {
  let resp;
  try {
    resp = await fetch(server + '/env-config');
  } catch {
    throw new Error(`로컬 서버(${server})에 연결할 수 없습니다 — LLM 모드는 bun serve.ts 실행 중일 때만 동작합니다. 규칙 엔진 기준점만 보려면 --llm 없이 실행하세요.`);
  }
  if (!resp.ok) throw new Error(`/env-config ${resp.status} — bun serve.ts가 실행 중인지 확인하세요`);
  const cfg = await resp.json();
  if (!cfg.keyConfigured) throw new Error('서버에 키가 없습니다. .env(LLM_API_KEY)를 채우고 serve.ts를 재시작하세요.');
  const baseUrl = cfg.baseUrl;
  if (!baseUrl) throw new Error('서버 .env에 공급자 Base URL이 확정되지 않았습니다. LLM_PROVIDER/LLM_BASE_URL을 확인하세요.');
  return { baseUrl, model: cfg.model || 'gpt-4.1-mini' };
}

async function llmPolish(llm, system, text) {
  const body = {
    model: llm.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: text }
    ]
  };
  // app.js와 같은 GLM 가드: thinking이 출력 예산을 태우지 않게.
  if (/^glm/i.test(llm.model) && /z\.ai|bigmodel\.cn/i.test(llm.baseUrl)) {
    body.max_tokens = Math.min(131072, Math.max(8192, text.length * 2));
    body.thinking = { type: 'disabled' };
  }
  const resp = await fetch(server + '/llm/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Target-URL': llm.baseUrl },
    body: JSON.stringify(body)
  });
  const respText = await resp.text();
  if (!resp.ok) throw new Error(`API 오류 ${resp.status}: ${respText.slice(0, 160)}`);
  let data;
  try { data = JSON.parse(respText); } catch { throw new Error('응답이 JSON이 아닙니다: ' + respText.slice(0, 120)); }
  const choice = data?.choices?.[0];
  let content = choice?.message?.content;
  if (Array.isArray(content)) content = content.map(p => p?.text ?? '').join('');
  if (!content && typeof choice?.text === 'string') content = choice.text; // legacy
  const out = String(content ?? '').trim();
  if (!out) throw new Error(`빈 응답 (finish_reason: ${choice?.finish_reason ?? '?'})`);
  return out.replace(/^```(?:markdown|md|text)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
}

// Transient provider failures (429/5xx, momentary gateway hiccups) shouldn't
// kill a long batch — back off and retry, but surface the error if it persists.
async function withRetry(fn, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      const wait = 15000 * i;
      process.stderr.write(` 재시도 ${i}/${attempts - 1}(${Math.round(wait / 1000)}s: ${String(e.message || e).slice(0, 80)})`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

// --- run ----------------------------------------------------------------------

async function main() {
  console.error(`# Humanize 평가 — ${MODE_LLM ? 'LLM 모드' : '규칙 기반(오프라인)'} · 코퍼스 ${corpus.length}편`);

  const fixtures = [];
  let llm = null;
  if (MODE_LLM) {
    llm = await resolveLlmConfig();
    console.error(`  경유: ${server} → ${llm.baseUrl} · 모델 ${llm.model}`);
  }

  for (let i = 0; i < corpus.length; i++) {
    const fx = corpus[i];
    const system = systemPromptText ?? Prompt.system(fx.genre);
    process.stderr.write(`  [${i + 1}/${corpus.length}] ${fx.id} …`);
    try {
      if (MODE_LLM) {
        const polished = await withRetry(() => llmPolish(llm, system, fx.text));
        fixtures.push(evaluateFixture(Rules, fx, polished));
      } else {
        const res = Rules.polish(fx.text);
        const rec = evaluateFixture(Rules, fx, res.text);
        rec.applied = res.applied; // 오프라인 기준점에서는 무엇이 자동 수정됐는지도 기록
        fixtures.push(rec);
      }
      process.stderr.write(' ok\n');
    } catch (e) {
      process.stderr.write(' 실패\n');
      fixtures.push({ id: fx.id, title: fx.title, genre: fx.genre, error: String(e.message || e) });
    }
  }

  const okRecords = fixtures.filter(r => !r.error);
  const summary = summarizeRun(fixtures);
  const run = {
    meta: {
      mode: MODE_LLM ? 'llm' : 'offline',
      date: new Date().toISOString(),
      server: MODE_LLM ? server : null,
      model: MODE_LLM ? llm.model : null,
      baseUrl: MODE_LLM ? llm.baseUrl : null,
      systemPrompt: MODE_LLM
        ? { source: systemPromptSource, sha256: promptSha(systemPromptText ?? '') }
        : null,
      corpus: corpusPath,
      corpusSize: corpusAll.length
    },
    summary,
    fixtures
  };

  if (outFile) {
    mkdirSync(dirname(resolve(outFile)), { recursive: true });
    writeFileSync(resolve(outFile), JSON.stringify(run, null, 2) + '\n', 'utf8');
    console.error(`  런 기록 저장: ${outFile}`);
  }

  if (asJson) {
    console.log(JSON.stringify(run, null, 2));
    return;
  }

  // --- report ------------------------------------------------------------------
  console.log('');
  console.log(`# 평가 결과 — ${run.meta.mode}${run.meta.model ? ' (' + run.meta.model + ')' : ''}`);
  if (compareFile) {
    const base = JSON.parse(readFileSync(resolve(compareFile), 'utf8'));
    if (!base.meta || !Array.isArray(base.fixtures)) throw new Error('--compare 파일이 런 JSON이 아닙니다: ' + compareFile);
    const d = diffRuns(base.fixtures, fixtures);
    console.log(`  기준: ${compareFile} (mode ${base.meta.mode})`);
    console.log('');
    console.log('  픽스처        등급      S1잔존     변경률        역주입(S1)');
    for (const row of d.fixtures) {
      const dr = (row.rate[1] - row.rate[0] >= 0 ? '+' : '') + Math.round((row.rate[1] - row.rate[0]) * 100) + '%p';
      console.log(
        `  ${row.id.padEnd(13)} ${row.grade.padEnd(9)} ${row.s1Residual[0]} → ${row.s1Residual[1]}`.padEnd(38) +
        `${Math.round(row.rate[0] * 100)}% → ${Math.round(row.rate[1] * 100)}% (${dr})`.padEnd(28) +
        `${row.newS1}${row.error ? '  오류: ' + row.error : ''}`
      );
    }
    console.log('');
    console.log(`  합계 S1 잔존: ${d.base.s1Residual} → ${d.candidate.s1Residual} · 역주입 회귀: ${d.base.regressions.length} → ${d.candidate.regressions.length} · 평균 변경률: ${Math.round(d.base.meanRate * 100)}% → ${Math.round(d.candidate.meanRate * 100)}%`);
    console.log(`  등급 분포: ${JSON.stringify(d.base.gradeDist)} → ${JSON.stringify(d.candidate.gradeDist)}`);
    console.log('');
    console.log('  참고: 프록시 점수다. 등급이 좋아졌어도 결과물 원문(런 JSON의 text)을 사람이 읽어 판단하세요.');
    return;
  }

  console.log('  픽스처        등급  신호(before→after)  S1잔존                    변경률');
  for (const r of fixtures) {
    if (r.error) {
      console.log(`  ${r.id.padEnd(13)} 오류 — ${r.error}`);
      continue;
    }
    const res = r.residualS1.length
      ? r.residualS1.map(f => `${f.id}×${f.count}${f.fixable ? '' : '*'}`).join(' ')
      : '—';
    console.log(
      `  ${r.id.padEnd(13)} ${r.grade.padEnd(5)} ${String(r.before.total).padStart(3)}→${String(r.after.total).padEnd(3)}`.padEnd(34) +
      `${res.padEnd(25)} ${Math.round(r.rate * 100)}%`
    );
  }
  console.log('');
  console.log(`  요약: 등급 ${JSON.stringify(summary.gradeDist)} · S1 잔존 ${summary.s1Residual}건 · 평균 변경률 ${Math.round(summary.meanRate * 100)}%`);
  if (summary.hardCases.length) console.log(`  하드케이스(S1 잔존): ${summary.hardCases.join(', ')}  (* = 감지 전용)`);
  if (summary.regressions.length) console.log(`  ⚠ 역주입 회귀(원문에 없던 S1 신호): ${summary.regressions.join(', ')}`);
  if (summary.overChange.length) console.log(`  ⚠ 변경률 30% 초과: ${summary.overChange.join(', ')}`);
  if (summary.failures.length) console.log(`  ⚠ 실행 실패: ${summary.failures.join(', ')}`);
  console.log('');
  console.log('  다음 단계: 하드케이스가 있으면 bun scripts/bootstrap-fewshot.mjs --runs <런 JSON>');
  if (!outFile) console.log('  (few-shot 후보를 뽑으려면 --out 으로 런 JSON을 저장하세요)');
}

main().catch(e => {
  console.error('평가 실패:', e.message || e);
  process.exit(1);
});
