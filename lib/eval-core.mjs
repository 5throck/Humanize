// Pure evaluation logic for the offline eval harness (scripts/eval.mjs,
// scripts/bootstrap-fewshot.mjs). No IO, no CLI — scripts own those, this
// module owns the scoring/aggregation so test.mjs can pin the behavior.
//
// Design note: the rule engine is the METRIC here, deliberately. That makes
// the harness a proxy evaluator — it can only see the 47 patterns the engine
// knows. Consumers (README, bootstrap output) must state that limit; a prompt
// variant that games the engine without improving real polish would still
// score well. Human review of run records stays part of the loop.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

// eval/corpus.json shape: [{ id, title, genre, text, expect: [ruleId, ...] }]
export function loadCorpus(path) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('코퍼스가 비어 있거나 배열이 아닙니다: ' + path);
  }
  for (const fx of data) {
    for (const field of ['id', 'title', 'genre', 'text', 'expect']) {
      if (!(field in fx)) throw new Error(`픽스처 필드 누락 — ${fx.id ?? '(id 없음)'}: ${field}`);
    }
    if (!Array.isArray(fx.expect)) throw new Error(`${fx.id}: expect는 배열이어야 합니다`);
  }
  const ids = data.map(f => f.id);
  if (new Set(ids).size !== ids.length) throw new Error('코퍼스 id 중복');
  return data;
}

// expect ids are a floor, not the whole picture: extra fired rules are fine
// (fixtures carry several incidental signals). Missing ones mean the fixture
// rotted (rule thresholds moved) or the engine regressed — both worth failing
// CI on, which test.mjs does.
export function validateCorpus(Rules, corpus) {
  const problems = [];
  for (const fx of corpus) {
    const fired = new Set(Rules.analyze(fx.text).findings.map(f => f.id));
    const missing = fx.expect.filter(id => !fired.has(id));
    if (missing.length) problems.push({ fixture: fx.id, missing });
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function round3(n) { return Math.round(n * 1000) / 1000; }

// One fixture through one mode. `polishedText` is the candidate output —
// engine polish (offline mode) or LLM output (llm mode).
export function evaluateFixture(Rules, fixture, polishedText) {
  const before = Rules.analyze(fixture.text);
  const after = Rules.analyze(polishedText);
  const rate = round3(Rules.changeRate(fixture.text, polishedText));
  const grade = Rules.grade(after, rate);
  const fixable = new Set(Rules.fixableIds || []);
  const beforeById = new Map(before.findings.map(f => [f.id, f.count]));
  const residualS1 = after.findings
    .filter(f => f.severity === 1)
    .map(f => ({ id: f.id, name: f.name, count: f.count, fixable: fixable.has(f.id) }));
  // Signals the candidate injected or amplified vs the original (역주입).
  const newSignals = after.findings
    .filter(f => f.count > (beforeById.get(f.id) || 0))
    .map(f => ({ id: f.id, name: f.name, severity: f.severity, count: f.count, before: beforeById.get(f.id) || 0 }));
  return {
    id: fixture.id,
    title: fixture.title,
    genre: fixture.genre,
    before: { total: before.total, s1: before.s1, s2: before.s2 },
    after: { total: after.total, s1: after.s1, s2: after.s2 },
    rate,
    grade: grade.level,
    gradeReason: grade.reason,
    findingsAfter: after.findings.map(f => ({ id: f.id, count: f.count })),
    residualS1,
    newSignals,
    text: polishedText
  };
}

export function summarizeRun(records) {
  // Error records (LLM call failed) carry no metrics — count them as failures,
  // score the rest.
  const ok = records.filter(r => !r.error);
  const gradeDist = {};
  for (const r of ok) gradeDist[r.grade] = (gradeDist[r.grade] || 0) + 1;
  const s1Residual = ok.reduce((a, r) => a + r.residualS1.reduce((b, f) => b + f.count, 0), 0);
  const hardCases = ok.filter(r => r.residualS1.length > 0).map(r => r.id);
  // 역주입: S1 신호를 새로 심은(혹은 늘린) 결과만 회귀로 센다. S2 증감은
  // 문체 파라미터 흔들림 범위라 보고만 하고 회귀로 치지 않는다.
  const regressions = ok.filter(r => r.newSignals.some(s => s.severity === 1)).map(r => r.id);
  const overChange = ok.filter(r => r.rate > 0.3).map(r => r.id);
  const meanRate = ok.length ? round3(ok.reduce((a, r) => a + r.rate, 0) / ok.length) : 0;
  const failures = records.filter(r => r.error).map(r => r.id);
  return { count: records.length, gradeDist, s1Residual, hardCases, regressions, overChange, meanRate, failures };
}

// Baseline vs candidate run records, joined by fixture id. Deltas are the
// whole point of the harness: a prompt variant is "better" iff S1 residual
// and regressions drop without change-rate blowups.
export function diffRuns(baseRecords, candRecords) {
  const baseById = new Map(baseRecords.map(r => [r.id, r]));
  const rows = [];
  for (const c of candRecords) {
    const b = baseById.get(c.id);
    if (!b) continue;
    const s1r = r => (r.residualS1 || []).reduce((a, f) => a + f.count, 0);
    rows.push({
      id: c.id,
      grade: (b.grade || '?') + '→' + (c.grade || '?'),
      s1Residual: [s1r(b), s1r(c)],
      rate: [b.rate ?? 0, c.rate ?? 0],
      newS1: (c.newSignals || []).filter(s => s.severity === 1).length,
      error: c.error || null
    });
  }
  return { fixtures: rows, base: summarizeRun(baseRecords), candidate: summarizeRun(candRecords) };
}

// ---------------------------------------------------------------------------
// Bootstrap few-shot candidates (DSPy-style, minus the framework)
// ---------------------------------------------------------------------------

// Hard-case harvest from run records:
//  - candidates: LLM output still carries S1 the ENGINE can auto-fix → the
//    (원문 → engine polish) pair is a trustworthy demo for prompt few-shot.
//  - gaps: residuals only context can fix → detect-only patterns the LLM
//    missed; these feed the rulebook/promt curation, not few-shot.
//  - regressions: signals injected or amplified → prompt defect reports.
export function buildFewshotCandidates(Rules, corpus, records) {
  const byId = new Map(corpus.map(f => [f.id, f]));
  const out = { candidates: [], gaps: [], regressions: [] };
  for (const rec of records) {
    const fx = byId.get(rec.id);
    if (!fx || rec.error) continue;
    if (rec.newSignals.length > 0) out.regressions.push({ record: rec });
    const hasFixable = rec.residualS1.some(f => f.fixable);
    if (rec.residualS1.length > 0 && hasFixable) {
      out.candidates.push({
        id: rec.id,
        title: rec.title,
        genre: rec.genre,
        residual: rec.residualS1,
        demo: { input: fx.text, output: Rules.polish(fx.text).text }
      });
    } else if (rec.residualS1.length > 0) {
      out.gaps.push({ id: rec.id, title: rec.title, residual: rec.residualS1 });
    }
  }
  return out;
}

// Stable identity of a run's system prompt — run files must be comparable
// across prompt variants, and the hash is cheaper than shipping full text.
export function promptSha(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
}
