#!/usr/bin/env bun
/**
 * bootstrap-fewshot — eval 런 기록에서 하드케이스를 수집해 few-shot 후보를
 * 만든다 (DSPy bootstrap 방식의 아이디어, 프레임워크·Python 없이).
 *
 *   bun scripts/eval.mjs --llm --out eval/run-a.json     # 1) 런을 저장하고
 *   bun scripts/bootstrap-fewshot.mjs --runs eval/run-a.json   # 2) 후보 추출
 *   bun scripts/bootstrap-fewshot.mjs --runs run-a.json run-b.json --out candidates.md
 *
 * 세 갈래로 분류한다:
 *   A. S1 잔존 + 엔진 자동 치환 존재 → (원문 → 규칙엔진 결과) 예시 쌍.
 *      검증된 결정적 치환이라 few-shot 데모로 신뢰할 수 있는 것만 여기 온다.
 *   B. 역주입 회귀 — 원문에 없던 S1 신호를 LLM이 심은 경우. few-shot이 아니라
 *      프롬프트 결함 보고다.
 *   C. 감지 전용 잔존 — 문맥 재작성이 필요해 엔진도 못 고치는 것. 룰북·프롬프트
 *      보강 과제(업스트림 벤치마킹 후보)다.
 *
 * 이 출력은 "후보"다. 프롬프트 반영은 references.json 큐레이션 절차
 * (REFERENCES.md)를 거쳐야 하며, 자동 주입되지 않는다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../lib/engine.mjs';
import { loadCorpus, buildFewshotCandidates } from '../lib/eval-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
function argValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
const outPath = argValue('--out');
const runFiles = (argValue('--runs') ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (runFiles.length === 0) {
  console.error('사용: bun scripts/bootstrap-fewshot.mjs --runs <런 JSON>[,<런 JSON>…] [--out FILE]');
  process.exit(1);
}

const { Rules } = loadEngine();
const corpus = loadCorpus(resolve(ROOT, 'eval/corpus.json'));

const records = [];
const seen = new Set();
for (const f of runFiles) {
  const run = JSON.parse(readFileSync(resolve(f), 'utf8'));
  if (!run.meta || !Array.isArray(run.fixtures)) {
    console.error(`건너뜀 (런 JSON이 아님): ${f}`);
    continue;
  }
  for (const rec of run.fixtures) {
    if (rec.error || seen.has(rec.id)) continue;
    seen.add(rec.id);
    records.push(rec);
  }
}

const cands = buildFewshotCandidates(Rules, corpus, records);
if (records.length === 0) {
  console.error('유효한 런 기록이 없습니다 — 먼저 bun scripts/eval.mjs --out <file>');
  process.exit(1);
}

const label = rec => `${rec.residual.map(f => `${f.id}×${f.count}${f.fixable ? '' : '(감지 전용)'}`).join(', ')}`;

let md = '';
md += `# Bootstrap few-shot 후보 — ${new Date().toISOString().slice(0, 10)}\n\n`;
md += `런: ${runFiles.join(', ')} (${records.length}편)\n\n`;
md += `> **이 파일은 자동 생성 후보다.** 점수는 규칙 엔진이라는 프록시 메트릭에서 나왔으므로\n`;
md += `> "엔진 통과 ≠ 좋은 윤문"이다. 예시 쌍을 프롬프트에 반영하려면 REFERENCES.md의\n`;
md += `> 큐레이션 절차(references.json 채택 기록)를 거친다. 자동 주입은 없다.\n\n`;

md += `## A. S1 잔존 — few-shot 예시 후보 (${cands.candidates.length}편)\n\n`;
md += `LLM 결과에 엔진으로 고칠 수 있는 S1이 남은 케이스. 예시 쌍은 규칙엔진 polish 결과다.\n\n`;
for (const c of cands.candidates) {
  md += `### ${c.id} — ${c.title}\n\n`;
  md += `잔존: ${label(c)}\n\n`;
  md += `<details><summary>예시 쌍 (원문 → 규칙엔진 결과)</summary>\n\n`;
  md += `**입력**\n\n\`\`\`\n${c.demo.input}\n\`\`\`\n\n`;
  md += `**출력**\n\n\`\`\`\n${c.demo.output}\n\`\`\`\n\n`;
  md += `</details>\n\n`;
}
if (cands.candidates.length === 0) md += `(없음)\n\n`;

md += `## B. 역주입 회귀 보고 (${cands.regressions.length}편)\n\n`;
md += `원문에는 없거나 더 적었던 S1 신호가 결과에 새로 생긴 케이스 — 프롬프트 결함 후보다.\n\n`;
for (const r of cands.regressions) {
  md += `### ${r.record.id} — ${r.record.title}\n\n`;
  md += `심어진 신호: ${r.record.newSignals.map(s => `${s.id}×${s.count}(원문 ${s.before})`).join(', ')}\n\n`;
}
if (cands.regressions.length === 0) md += `(없음)\n\n`;

md += `## C. 감지 전용 잔존 — 룰북 갭 후보 (${cands.gaps.length}편)\n\n`;
md += `문맥 재작성이 필요해 엔진도 고치지 못하는 패턴이 LLM 결과에 남은 케이스. 프롬프트 보강이나\n`;
md += `업스트림 벤치마킹(ref-check)으로 검토할 과제다.\n\n`;
for (const g of cands.gaps) {
  md += `### ${g.id} — ${g.title}\n\n`;
  md += `잔존: ${g.residual.map(f => `${f.id}×${f.count} ${f.name}`).join(', ')}\n\n`;
}
if (cands.gaps.length === 0) md += `(없음)\n`;

if (outPath) {
  writeFileSync(resolve(outPath), md, 'utf8');
  console.error(`후보 저장: ${outPath}`);
  console.error(`  A few-shot 후보 ${cands.candidates.length}편 · B 역주입 ${cands.regressions.length}편 · C 룰북 갭 ${cands.gaps.length}편`);
} else {
  console.log(md);
}
