// Smoke test for Humanize rules.js — run: bun test.mjs (or bun run test)
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./rules.js', import.meta.url), 'utf8');
const sandbox = { window: {} };
new Function('window', src)(sandbox.window);
const HR = sandbox.window.HumanizeRules;

// Chunking + MCP share the same engine loader used by serve.ts.
const sandbox2 = { window: {} };
for (const f of ['rules.js', 'prompt.js', 'chunking.js']) {
  new Function('window', readFileSync(new URL(`./${f}`, import.meta.url), 'utf8'))(sandbox2.window);
}
const HC = sandbox2.window.HumanizeChunking;
const { handleMessage } = await import('./mcp-server.mjs');

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${detail}`); }
}

// ---------------------------------------------------------------------------
console.log('# basic sanity');
check('rule count', HR.ruleCount >= 25, `got ${HR.ruleCount}`);

// ---------------------------------------------------------------------------
console.log('# detection on AI-style sample');
const sample = [
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

const before = HR.analyze(sample);
check('sample has findings', before.total > 0, JSON.stringify(before.findings.map(f => f.id)));
check('D-1 detected', before.findings.some(f => f.id === 'D-1'));
check('A-8 detected', before.findings.some(f => f.id === 'D-1' || f.id === 'A-8'));
const a8 = before.findings.find(f => f.id === 'A-8');
check('A-8 counts both 되어져 and 되어질', a8 && a8.count === 2, JSON.stringify(a8));
check('D-8 detected', before.findings.some(f => f.id === 'D-8'));
check('H-4 detected', before.findings.some(f => f.id === 'H-4'));

console.log('# polish behavior');
const res = HR.polish(sample);
const out = res.text;

check('A-8: 되어져 fixed', !out.includes('공개되어져야') && out.includes('공개돼야'), out.match(/공개\S*/)?.[0]);
check('A-8: 확산되어질 fixed', out.includes('확산될 것이다'), out.match(/확산\S*/)?.[0]);
check('A-3: 전반에 있어 fixed', out.includes('전반에서'), out.match(/전반\S*/)?.[0]);
check('D-8: 중요한 것은 fixed', out.includes('신뢰가 중요하다.'), out.match(/.{0,6}신뢰.{0,10}/)?.[0]);
check('D-8: 필요한 것은 fixed', out.includes('균형이 필요하다.'), out.match(/.{0,4}균형.{0,8}/)?.[0]);
// D-1 threshold: upstream trims only beyond 3 occurrences; sample has exactly 3 -> all kept.
check('D-1: 3 occurrences kept (threshold)', (out.match(/(^|[.!?]\s+)(결론적으로|그러므로|따라서|요약하면)/gm) || []).length === 3,
  String((out.match(/(^|[.!?]\s+)(결론적으로|그러므로|따라서|요약하면)/gm) || []).length));
const d1case = '따라서, A다. 그러므로, B다. 요약하면, C다. 결론적으로, D다.';
const d1out = HR.polish(d1case).text;
check('D-1: 4 occurrences trimmed to 2', (d1out.match(/(^|[.!?]\s+)(따라서|그러므로|요약하면|결론적으로)/gm) || []).length === 2, d1out);
check('H-4: keeps 2 즉', (out.match(/즉/g) || []).length === 2, String((out.match(/즉/g) || []).length));
check('D-3: lead-in removed', !out.includes('나눌 수 있다'), out.match(/나눌\S*/)?.[0]);
check('D-3: list content kept', out.includes('원칙 수립, 프로세스 정비, 교육 확산'));
check('C-11: 연결어미 쉼표 제거(3+ 클러스터)', !/[가-힣](?:고|며),\s*[가-힣]/.test(out));
const c11case = '밥을 먹고, 산책을 했다.';
check('C-11: 2개 미만은 보존', HR.polish(c11case).text === c11case, HR.polish(c11case).text);
check('B-1: repeated gloss removed (first kept)', out.includes('AI 거버넌스(AI Governance)') && (out.match(/AI Governance/g) || []).length === 1);
check('content anchor "AI 거버넌스" preserved', out.includes('AI 거버넌스'));
// Paragraph structure: deletions must not merge paragraphs.
const blanksIn = (sample.match(/\n\n+/g) || []).length;
const blanksOut = (out.match(/\n\n+/g) || []).length;
check('paragraph breaks preserved', blanksIn === blanksOut, `${blanksIn} -> ${blanksOut}`);

const after = HR.analyze(out);
check('findings reduced', after.total < before.total, `${before.total} -> ${after.total}`);
// Detect-only residuals (D-2 시사하는 바가 크다, I-2 주목할 점은, A-9 ~에 의해)
// are expected: they need sentence restructuring -> LLM mode territory.
const residualS1 = after.findings.filter(f => f.severity === 1).map(f => f.id);
check('fixed S1 rules are gone', !residualS1.includes('A-8') && !residualS1.includes('C-11'),
  JSON.stringify(after.findings.map(f => f.id)));
check('detect-only residuals remain flagged', residualS1.includes('D-2') && after.findings.some(f => f.id === 'I-2'),
  JSON.stringify(after.findings.map(f => f.id)));
check('E-2 does not flag plain 다-ending register', !after.findings.some(f => f.id === 'E-2'),
  JSON.stringify(after.findings.map(f => f.id)));
const rate = HR.changeRate(sample, out);
check('change rate plausible', rate > 0.03 && rate < 0.35, `rate=${rate.toFixed(3)}`);

// ---------------------------------------------------------------------------
console.log('# over-polish guards (must NOT change)');
const clean = '김철수 박사는 2024년 3월 5일 서울에서 "이 수치는 37.5%입니다"라고 밝혔다. LLM·GPU·API 시장은 2배 성장했다.';
const cleanOut = HR.polish(clean).text;
check('quotes/names/numbers/acronyms untouched', cleanOut === clean, cleanOut);

const colloquial = '그건 좀 아닌데요. 오늘 진짜 재밌었잖아요. 저도 몰랐거든요.';
check('colloquial register untouched', HR.polish(colloquial).text === colloquial);

const located = '그는 지금 부산에 있어요. 서울에 있어야 할 텐데.';
const locatedOut = HR.polish(located).text;
check('"에 있어요" not mangled', locatedOut.includes('부산에 있어요'), locatedOut);

const hedge = '이 약물은 효과가 있을 가능성이 있을 수 있다. 다만 환자마다 다를 수 있다.';
const hedgeOut = HR.polish(hedge).text;
check('double hedge left to LLM (G-2 detect only)', hedgeOut === hedge);

const changed = HR.analyze(located);
check('"부산에 있어요" not detected as A-3', !changed.findings.some(f => f.id === 'A-3'), JSON.stringify(changed.findings));

// ---------------------------------------------------------------------------
console.log('# changeRate / grade');
check('identical text -> 0', HR.changeRate('안녕하세요 세계', '안녕하세요 세계') === 0);
check('different text -> high', HR.changeRate('안녕하세요 세계', ' completely different text') > 0.5);
const gA = HR.grade({ s1: 0, s2: 1, total: 1 }, 0.15);
const gD = HR.grade({ s1: 4, s2: 0, total: 4 }, 0.1);
check('grade A path', gA.level === 'A', JSON.stringify(gA));
check('grade D path', gD.level === 'D', JSON.stringify(gD));

// ---------------------------------------------------------------------------
// Benchmark additions (2026-09) — IsaacEryn/humanizer-ko, devswha/patina,
// amondnet/yoonmoon, upstream v2.x drift.
console.log('# benchmark: upstream drift (A-8/A-19/A-10/D-1/D-8/D-14)');

const a8b = HR.analyze('그림이 보여지는 화면과 글이 쓰여지는 창이다.');
check('A-8 detects 보여지/쓰여지', a8b.findings.some(f => f.id === 'A-8'), JSON.stringify(a8b.findings));
const a8fix = HR.polish('보고서가 보여진다. 내용이 쓰여지는 중이다.');
check('A-8 fixes 보여진다→보인다', a8fix.text.includes('보인다') && a8fix.text.includes('쓰이는'), a8fix.text);
const a8fix2 = HR.polish('그림이 보여지는 화면과 글이 쓰여진 문서다.');
check('A-8 fixes 보여지는/쓰여진', a8fix2.text.includes('보이는') && a8fix2.text.includes('쓰인'), a8fix2.text);

const a19 = HR.analyze('이 브랜드에의 기대가 컸고, 사람들로부터의 신뢰가 무너졌다.');
check('A-19 detects 에의/으로부터의', a19.findings.some(f => f.id === 'A-19'), JSON.stringify(a19.findings));
check('A-19: 회의 is not 에의', !HR.analyze('오전 회의를 마쳤다.').findings.some(f => f.id === 'A-19'));
const a19fix = HR.polish('기존 사업에서의 경험과 성공으로의 전환, 사람들로부터의 신뢰, 이 브랜드에의 기대가 있다.');
check('A-19 drops doubled particles', a19fix.text.includes('사업에서 경험') && a19fix.text.includes('성공으로 전환')
  && a19fix.text.includes('사람들로부터 신뢰') && a19fix.text.includes('브랜드에 기대'), a19fix.text);
check('A-19 residual cleared after polish', !HR.analyze(a19fix.text).findings.some(f => f.id === 'A-19'),
  JSON.stringify(HR.analyze(a19fix.text).findings));
check('A-19 fix leaves 회의 untouched', HR.polish('오전 회의를 마쳤다.').text === '오전 회의를 마쳤다.');

const a10 = HR.analyze('우리는 할 수 있다. 그들도 할 수 있다. 누구나 할 수 있다. 결국 모두가 할 수 있다.');
check('A-10 fires at 4+ 할 수 있다', a10.findings.some(f => f.id === 'A-10'), JSON.stringify(a10.findings));
check('A-10 stays silent below 4', !HR.analyze('우리는 할 수 있다. 그들도 할 수 있다.').findings.some(f => f.id === 'A-10'));

const d1t = HR.analyze('이를 통해, 시장은 안정을 찾았다.');
check('D-1 detects 문두 이를 통해', d1t.findings.some(f => f.id === 'D-1'), JSON.stringify(d1t.findings));

const d8t = HR.analyze('문제는 비용이다.');
check('D-8: single 문제는 is human idiom (isaac §27)', !d8t.findings.some(f => f.id === 'D-8'), JSON.stringify(d8t.findings));
const d8t2 = HR.analyze('문제는 비용이다. 핵심은 속도다.');
check('D-8 fires at 2+ settling variants', d8t2.findings.some(f => f.id === 'D-8'), JSON.stringify(d8t2.findings));
const d8t3 = HR.analyze('정비 인력이 모자란다는 점이다. 배차가 늦어진다는 점이다.');
check('D-8 counts "~다는 점이다" settling form', d8t3.findings.some(f => f.id === 'D-8'), JSON.stringify(d8t3.findings));

const d14t = HR.analyze('AI가 시장을 잠식하고 있다.');
check('D-14 fires at 1 occurrence (upstream: human corpus 0)', d14t.findings.some(f => f.id === 'D-14'), JSON.stringify(d14t.findings));

// 2026-10 sync — im-not-ai v2.7 + isaac 1.2~1.5 (see references.json).
console.log('# benchmark 2026-10: H-1 / E-2 passive progressive / D-10 셈이다 / C-11 gate');
const h1a = HR.analyze('또한, 비용이 줄었다. 나아가, 속도가 빨라졌다. 아울러, 품질도 좋아졌다.');
check('H-1 fires at 3+ sentence-initial connectives in one paragraph', h1a.findings.some(f => f.id === 'H-1'), JSON.stringify(h1a.findings));
check('H-1 silent below 3 in a paragraph', !HR.analyze('또한, 비용이 줄었다. 나아가, 속도가 빨라졌다.').findings.some(f => f.id === 'H-1'));
check('H-1 is paragraph-scoped, not document-scoped',
  !HR.analyze('또한, 비용이 줄었다. 나아가, 속도가 빨라졌다.\n\n또한, 품질도 좋아졌다.').findings.some(f => f.id === 'H-1'),
  JSON.stringify(HR.analyze('또한, 비용이 줄었다. 나아가, 속도가 빨라졌다.\n\n또한, 품질도 좋아졌다.').findings.map(f => f.id)));
const e2pos = HR.analyze('경쟁이 심화되고 있다. 제품이 통합되고 있다. 서비스가 재편되고 있다.');
check('E-2 flags passive-progressive cluster (one paragraph 3+)', e2pos.findings.some(f => f.id === 'E-2'), JSON.stringify(e2pos.findings));
const e2act = HR.analyze('우리는 계획을 추진하고 있다. 팀은 기능을 확장하고 있다. 담당자는 보고서를 쓰고 있다.');
check('E-2 ignores active progressive (common in human writing)', !e2act.findings.some(f => f.id === 'E-2'), JSON.stringify(e2act.findings));
check('E-2 excludes 가지고 있다 (A-7 territory)',
  !HR.analyze('팀이 권한을 가지고 있다. 실무자가 예산을 가지고 있다. 관리자가 인력을 가지고 있다.').findings.some(f => f.id === 'E-2'));
check('D-10 includes 인 셈이다 variant', HR.analyze('이 프로젝트는 사실상 끝난 인 셈이다.\n지난 노력도 다시 시작한 인 셈이다.').findings.some(f => f.id === 'D-10'));
check('C-11 detect silent below 3 (aligned with fix threshold)',
  !HR.analyze('밥을 먹고, 산책을 했고, 책을 읽으며 하루를 마쳤다.').findings.some(f => f.id === 'C-11'));

console.log('# benchmark: J-4 markup leakage / J-5 thematic breaks');
const j4a = HR.analyze('결론은 다음과 같다.\n```');
check('J-4 detects orphan code fence', j4a.findings.some(f => f.id === 'J-4'), JSON.stringify(j4a.findings));
const j4b = HR.analyze('<think>중간 추론</think>정답은 42다.');
check('J-4 detects artifact tags', j4b.findings.some(f => f.id === 'J-4'), JSON.stringify(j4b.findings));
const j4c = HR.analyze('«P2 SUSPECT» 문단 표식이 남았다.');
check('J-4 detects «…» artifacts', j4c.findings.some(f => f.id === 'J-4'), JSON.stringify(j4c.findings));
const j4clean = HR.analyze('예시 코드다.\n```js\nconsole.log(1);\n```');
check('J-4 ignores closed code blocks', !j4clean.findings.some(f => f.id === 'J-4'), JSON.stringify(j4clean.findings));
const j5 = HR.analyze('---\n\n본문이다.\n\n---\n\n이어진다.\n\n---');
check('J-5 fires at 3+ horizontal rules', j5.findings.some(f => f.id === 'J-5'), JSON.stringify(j5.findings));
check('J-5 stays silent below 3', !HR.analyze('---\n\n본문이다.').findings.some(f => f.id === 'J-5'));

console.log('# benchmark: K category (chatbot residue)');
const k1 = HR.analyze('좋은 질문입니다! 도움이 되셨길 바랍니다. 계속할까요?');
check('K-1 detects sycophancy leftovers', k1.findings.some(f => f.id === 'K-1') && k1.findings.find(f => f.id === 'K-1').count >= 3, JSON.stringify(k1.findings));
const k2 = HR.analyze('지금부터 핵심 내용을 알아보겠습니다.');
check('K-2 detects preview sentence', k2.findings.some(f => f.id === 'K-2'), JSON.stringify(k2.findings));
check('K-2 ignores 살펴보자 (non-honorific)', !HR.analyze('사례를 살펴보자.').findings.some(f => f.id === 'K-2'));
check('K-3 silent at 1 fake-candor', !HR.analyze('솔직히 말해서 그건 아니다.').findings.some(f => f.id === 'K-3'));
const k3 = HR.analyze('솔직히 말해서 그건 아니다. 솔직히 말하자면 결과는 비슷하다.');
check('K-3 fires at 2+ fake-candor', k3.findings.some(f => f.id === 'K-3'), JSON.stringify(k3.findings));
const k4 = HR.analyze('앞으로의 행보가 기대된다.');
check('K-4 detects stock closing', k4.findings.some(f => f.id === 'K-4'), JSON.stringify(k4.findings));

console.log('# benchmark: E-3 / E-4 distribution rules');
const e3pos = HR.analyze([
  '데이터는 매일 쌓인다.', '분석은 꾸준히 필요하다.', '보고서는 매주 작성한다.',
  '회의는 매일 오전에 한다.', '피드백은 빠르게 반영한다.', '결과는 문서로 남긴다.',
  '개선은 매달 검토한다.', '목표는 분기마다 조정한다.'
].join(' '));
check('E-3 flags uniform plain-다 rhythm', e3pos.findings.some(f => f.id === 'E-3'), JSON.stringify(e3pos.findings));
const e3neg = HR.analyze('회의는 매일 오전에 한다. 이번 분기에는 제품 로드맵 전반과 조직 개편 방향을 함께 점검하는 자리로 활용했고, 다음 달에는 고객사 피드백을 반영한 세부 실행 계획이 발표될 예정이다. 준비는 계속된다. 목표는 분기마다 조정한다. 데이터는 매일 쌓인다. 결과는 문서로 남긴다. 개선은 매달 검토한다. 보고서는 매주 작성한다.');
check('E-3 stays silent on varied-length report', !e3neg.findings.some(f => f.id === 'E-3'), JSON.stringify(e3neg.findings));
const e4pos = HR.analyze(Array(40).fill('데이터 분석 결과를 보고서에 정리했다').join(' '));
check('E-4 flags low lexical diversity', e4pos.findings.some(f => f.id === 'E-4'), JSON.stringify(e4pos.findings));
const e4neg = HR.analyze(Array.from({ length: 120 }, (_, i) => `w${i} token${i}`).join(' and '));
check('E-4 stays silent on diverse vocabulary', !e4neg.findings.some(f => f.id === 'E-4'), JSON.stringify(e4neg.findings));

// ---------------------------------------------------------------------------
// Human-text false-positive suite — benchmark (IsaacEryn "사람 글의 증거",
// dotori fixtures): normal formal writing must not trigger the new rules.
console.log('# human-text false-positive suite');
const human = [
  '서울중앙지방법원에 따르면 이번 재판 결론은 지난 12일 나왔다.',
  '양측은 합의로 종결하기로 했다고 밝혔다.',
  '소송 비용은 각자 부담한다.',
  '원고 측 변호인은 "다만 항고 권리는 남아 있다"고 덧붙였다.',
  '피고 측은 유사 분쟁 예방 차원에서 내부 규정을 손볼 계획이다.',
  '업계 관계자들은 이번 종결이 후속 사건들에 영향을 줄 것으로 본다.',
  '관련 조항은 다음 분기 중 개정될 예정이다.',
  '세부 시행령은 아직 조율 중이다.'
].join('\n');
const humanRes = HR.analyze(human);
const newIds = ['A-10', 'H-1', 'J-4', 'J-5', 'K-1', 'K-2', 'K-3', 'K-4', 'E-2', 'E-3', 'E-4'];
const fired = humanRes.findings.filter(f => newIds.includes(f.id)).map(f => f.id);
check('new rules silent on human report', fired.length === 0, JSON.stringify(humanRes.findings));
check('human report overall clean', humanRes.total === 0, JSON.stringify(humanRes.findings));
check('polish leaves human report untouched', HR.polish(human).text === human);

// ---------------------------------------------------------------------------
// References registry (references.json) — keeps the source mapping from
// rotting when rules get renamed/removed. Network drift checks live in
// scripts/ref-check.mjs; this only validates the local mapping.
console.log('# references registry');
const refs = JSON.parse(readFileSync(new URL('./references.json', import.meta.url), 'utf8'));
const sourceIds = new Set(refs.sources.map(s => s.id));
const registryRuleIds = new Set([...src.matchAll(/id:\s*'([A-Z]-\d+)'/g)].map(m => m[1]));
check('registry has sources', refs.sources.length >= 5, String(refs.sources.length));
check('default_source exists', sourceIds.has(refs.default_source), refs.default_source);
for (const s of refs.sources) {
  for (const f of ['id', 'name', 'repo', 'url', 'role', 'license', 'key_files', 'adopted', 'last_checked']) {
    check(`source "${s.id}": ${f} present`, f in s);
  }
}
let mapped = 0;
for (const s of refs.sources) for (const a of s.adopted) for (const r of a.rules ?? []) {
  mapped++;
  check(`adopted rule "${r}" (${s.id}) exists in rules.js`, registryRuleIds.has(r));
}
// src sits on the line directly after the id line — anchor to the newline so
// the match cannot leak into the NEXT rule object.
const srcFieldRe = /id:\s*'([A-Z]-\d+)',[^\n]*\n\s*src:\s*(\[[^\]]*\])/g;
for (const m of src.matchAll(srcFieldRe)) {
  for (const s of JSON.parse(m[2].replace(/'/g, '"'))) {
    check(`rule ${m[1]} src "${s}" exists in registry`, sourceIds.has(s));
  }
}
check('adopted rules mapped', mapped >= 10, String(mapped));

// ---------------------------------------------------------------------------
// Chunking (chunking.js) — JS port of im-not-ai prepare_monolith_input.py +
// reassemble_chunks.py. Upstream constants: recommend ≥15,000 / target 7,000 /
// cap 9,000 / sentence fallback 4,000.
console.log('# chunking: lossless split + merge');

function filler(n, seed) {
  // Sentence-shaped filler: '. ' boundaries exist (sentence fallback works)
  // but no translation-ese patterns that rules.js would care about.
  const piece = `제${seed} 항목은 실측 결과를 다룬다. 수치는 매주 갱신된다. 담당자가 검토했다. `;
  let s = '';
  while (s.length < n) s += piece + `${s.length}자 지점. `;
  return s.slice(0, n).trimEnd();
}
function buildDoc() {
  const parts = [];
  for (let s = 1; s <= 5; s++) {
    parts.push(`## ${s}. 테스트 절`);
    for (let p = 0; p < 3; p++) parts.push(filler(420, s * 10 + p));
  }
  return parts.join('\n\n');
}

const doc = buildDoc();
const small = HC.plan(doc, { target: 1500, max: 2200 });
check('chunking: multiple body chunks with small target', small.chunks.filter(c => !c.passthrough).length >= 2,
  `got ${small.chunks.length}`);
check('chunking: lossless (concat === original)', small.chunks.map(c => c.text).join('') === doc);
check('chunking: every chunk has a context header', small.chunks.filter(c => !c.passthrough).every(c => c.header?.startsWith('[청크 컨텍스트]')));
check('chunking: no body chunk ends with a heading', small.chunks.filter(c => !c.passthrough).every(c => {
  const last = c.text.replace(/\s+$/, '').slice(c.text.replace(/\s+$/, '').lastIndexOf('\n') + 1);
  return !/^#{1,6}\s|^\d+\.\s|^\([가-힣0-9]+\)/.test(last);
}));
check('chunking: heading chunks start with heading', small.chunks.filter(c => !c.passthrough)[1]?.startsWithHeading === true);

// Merge round-trip identity: feeding the ORIGINAL chunk texts back must
// reproduce the original exactly (공백 복원 항등).
const roundTrip = HC.merge(doc, small, small.chunks.filter(c => !c.passthrough).map(c => c.text));
check('chunking: merge identity (원문 재투입 = 원문)', roundTrip.text === doc && roundTrip.warnings.length === 0,
  JSON.stringify(roundTrip.warnings));

// Ratio validation: halving a body chunk warns 유실, doubling warns 증식.
const bodyCount = small.chunks.filter(c => !c.passthrough).length;
const bodyTexts = small.chunks.filter(c => !c.passthrough).map(c => c.text);
const halved = HC.merge(doc, small, bodyTexts.map((t, i) => i === 0 ? t.slice(0, Math.floor(t.length * 0.4)) : t));
check('chunking: 유실 의심 warning at <0.5 ratio', halved.warnings.some(w => w.includes('유실 의심')), JSON.stringify(halved.warnings));
const grown = HC.merge(doc, small, bodyTexts.map((t, i) => i === 0 ? t + t + t : t));
check('chunking: 증식 의심 warning at >2.0 ratio', grown.warnings.some(w => w.includes('증식 의심')), JSON.stringify(grown.warnings));
let emptyThrew = false;
try { HC.merge(doc, small, bodyTexts.map((t, i) => i === 0 ? '' : t)); } catch { emptyThrew = true; }
check('chunking: empty rewritten body → hard error (유실 사고)', emptyThrew);
let countThrew = false;
try { HC.merge(doc, small, bodyTexts.slice(1)); } catch { countThrew = true; }
check('chunking: mismatched part count → error', countThrew);

// Footnote passthrough: trailing \d+) block is excluded from rewriting.
const fnDoc = buildDoc() + '\n\n1) 첫 번째 각주 — 출처 명시.\n2) 두 번째 각주 — 조사 방법.\n3) 세 번째 각주 — 보조 자료.';
const fnPlan = HC.plan(fnDoc, { target: 1500, max: 2200 });
const fnLast = fnPlan.chunks[fnPlan.chunks.length - 1];
check('chunking: trailing footnote block is passthrough', fnLast.passthrough === true, JSON.stringify(fnPlan.chunks.map(c => c.passthrough)));
check('chunking: passthrough chunk has no header', fnLast.header === null);
check('chunking: footnote chunk keeps whole block', fnLast.text.includes('1) 첫 번째 각주') && fnLast.text.includes('3) 세 번째 각주'));

// Below recommend threshold → single body chunk, not recommended.
const tiny = HC.plan('첫 문단이다.\n\n둘째 문단이다.');
check('chunking: short text not recommended, single chunk', tiny.recommended === false && tiny.chunks.length === 1, JSON.stringify({ rec: tiny.recommended, n: tiny.chunks.length }));

// 20k doc with default constants → recommended, ≥2 body chunks.
const big = buildDoc() + '\n\n' + buildDoc() + '\n\n' + filler(4000, 99);
const bigPlan = HC.plan(big);
check('chunking: 25k+ doc recommended with default constants', bigPlan.recommended === true && bigPlan.chunks.filter(c => !c.passthrough).length >= 2,
  `rec=${bigPlan.recommended} chunks=${bigPlan.chunks.length}`);

// Sentence fallback: one >4,000-char paragraph with boundaries splits fine.
const longPara = filler(5200, 77);
const paraPlan = HC.plan('머리말이다.\n\n' + longPara, { target: 2500, max: 4000 });
check('chunking: >4k paragraph splits at sentence boundaries', paraPlan.chunks.filter(c => !c.passthrough).length >= 2,
  `got ${paraPlan.chunks.length}`);
check('chunking: sentence split stays lossless', paraPlan.chunks.map(c => c.text).join('') === '머리말이다.\n\n' + longPara);

// Unsplittable run warning: >4k paragraph with NO sentence boundary.
const runDoc = '가나다라마바사아자차'.repeat(600); // 5,400자, 종결부호+공백 없음
const runPlan = HC.plan(runDoc);
check('chunking: unsplittable long run warns', runPlan.warnings.some(w => w.includes('초장 구간')), JSON.stringify(runPlan.warnings));

let lossThrew = false;
try {
  // Corrupt the plan so the tiling check must fail: spans with a GAP between
  // them do not concatenate back to the original.
  HC.merge('짧은 원문입니다.', {
    chunks: [
      { index: 1, total: 2, start: 0, end: 2, passthrough: false },
      { index: 2, total: 2, start: 6, end: 7, passthrough: false }
    ]
  }, ['가', '나']);
} catch { lossThrew = true; }
check('chunking: merge re-verifies losslessness against original', lossThrew);

// ---------------------------------------------------------------------------
// MCP server (mcp-server.mjs) — handler-level protocol tests.
console.log('# mcp: stdio JSON-RPC handlers');
const init = handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } } });
check('mcp: initialize echoes protocolVersion + serverInfo', init?.result?.protocolVersion === '2025-06-18' && init?.result?.serverInfo?.name === 'humanize', JSON.stringify(init));
check('mcp: notification stays silent', handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }) === null);
check('mcp: ping answers', handleMessage({ jsonrpc: '2.0', id: 2, method: 'ping' })?.result != null);
const tools = handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
check('mcp: tools/list exposes 5 tools', tools?.result?.tools?.length === 5 &&
  ['humanize_analyze', 'humanize_polish', 'humanize_prompt', 'humanize_chunk', 'humanize_merge']
    .every(n => tools.result.tools.some(t => t.name === n)), JSON.stringify(tools?.result?.tools?.map(t => t.name)));
const call = (id, name, args) => handleMessage({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const mcpAnalyze = call(4, 'humanize_analyze', { text: sample });
check('mcp: analyze returns findings JSON', JSON.parse(mcpAnalyze.result.content[0].text).findings.length > 0);
const mcpPolish = call(5, 'humanize_polish', { text: sample });
const polishOut = JSON.parse(mcpPolish.result.content[0].text);
check('mcp: polish returns text + grade + changeRate', typeof polishOut.text === 'string' && polishOut.grade?.level && typeof polishOut.changeRate === 'number', JSON.stringify(polishOut).slice(0, 120));
const mcpPrompt = call(6, 'humanize_prompt', { genre: 'column' });
check('mcp: prompt returns system prompt', JSON.parse(mcpPrompt.result.content[0].text).system.includes('윤문 전문가'));
const mcpChunk = call(7, 'humanize_chunk', { text: doc, target: 1500, max: 2200 });
check('mcp: chunk returns plan with headers', JSON.parse(mcpChunk.result.content[0].text).chunks.length >= 2);
const badMerge = call(8, 'humanize_merge', { original: doc, rewritten: ['하나'] });
check('mcp: domain error is isError result (not protocol error)', badMerge?.result?.isError === true, JSON.stringify(badMerge).slice(0, 160));
const badTool = call(9, 'humanize_nope', {});
check('mcp: unknown tool → -32602', badTool?.error?.code === -32602);
check('mcp: unknown method → -32601', handleMessage({ jsonrpc: '2.0', id: 10, method: 'x/y' })?.error?.code === -32601);
check('mcp: oversized text rejected as tool error', call(11, 'humanize_analyze', { text: '가'.repeat(30001) }).result.isError === true);

// ---------------------------------------------------------------------------
// Eval harness (lib/eval-core.mjs + eval/corpus.json) — offline prompt loop.
console.log('# eval: corpus + scoring + bootstrap few-shot');
const EC = await import('./lib/eval-core.mjs');
const evalCorpus = EC.loadCorpus(new URL('./eval/corpus.json', import.meta.url));
check('eval: corpus has >= 6 fixtures', evalCorpus.length >= 6);
check('eval: fixableIds exposed (D-1 fixable, K-1 not)',
  Array.isArray(HR.fixableIds) && HR.fixableIds.includes('D-1') && !HR.fixableIds.includes('K-1'),
  JSON.stringify(HR.fixableIds));
const corpusCheck = EC.validateCorpus(HR, evalCorpus);
check('eval: corpus expectations all fire', corpusCheck.ok, JSON.stringify(corpusCheck.problems));

// Offline baseline through the real scoring path — the fixed reference point.
const offlineRecs = evalCorpus.map(fx => EC.evaluateFixture(HR, fx, HR.polish(fx.text).text));
const summ = EC.summarizeRun(offlineRecs);
check('eval: summarize counts every fixture', summ.count === evalCorpus.length);
check('eval: offline baseline leaves hard cases (detect-only reality)', summ.hardCases.length > 0);
const colSettle = offlineRecs.find(r => r.id === 'col-settle');
check('eval: residuals classified fixable vs detect-only',
  colSettle.residualS1.some(f => f.id === 'D-1' && f.fixable === true) &&
  colSettle.residualS1.some(f => f.id === 'D-2' && f.fixable === false),
  JSON.stringify(colSettle.residualS1));

// Regression detection: a "polish" that injects a residue the original lacked.
const rhythmFx = evalCorpus.find(f => f.id === 'long-rhythm');
const regRec = EC.evaluateFixture(HR, rhythmFx, rhythmFx.text + '\n도움이 되셨기를 바랍니다.');
check('eval: injected signal flagged in newSignals (K-1)',
  regRec.newSignals.some(s => s.id === 'K-1' && s.severity === 1), JSON.stringify(regRec.newSignals));

// Bootstrap split: fixable residuals → few-shot demo pairs, detect-only → gaps.
const cands = EC.buildFewshotCandidates(HR, evalCorpus, offlineRecs);
check('eval: bootstrap builds demo pairs for fixable residuals',
  cands.candidates.length > 0 && cands.candidates.every(c => c.demo.input && typeof c.demo.output === 'string'));
check('eval: bootstrap candidate set == records with >=1 fixable residual',
  cands.candidates.length === offlineRecs.filter(r => r.residualS1.some(f => f.fixable)).length);
check('eval: bootstrap harvests regressions',
  EC.buildFewshotCandidates(HR, evalCorpus, [regRec]).regressions.length === 1);

// Diff: identical runs must be flat (grade pair, residual, aggregate).
const diff = EC.diffRuns(offlineRecs, offlineRecs);
check('eval: diff of identical runs is flat',
  diff.fixtures.every(f => f.grade.split('→')[0] === f.grade.split('→')[1] && f.s1Residual[0] === f.s1Residual[1]) &&
  diff.base.s1Residual === diff.candidate.s1Residual);

// ---------------------------------------------------------------------------

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
