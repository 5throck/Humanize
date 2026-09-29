#!/usr/bin/env node
/**
 * ref-check — 출처 레지스트리(references.json) 점검 도구.
 *
 * 1. 검증: sources 스키마, rules.js 규칙의 src 필드 ↔ 출처 id 일치,
 *    adopted[].rules 매핑이 실제 존재하는 규칙 id인지 확인 (매핑 부패 방지).
 * 2. 드리프트: 각 출처 저장소의 최신 푸시일과 key_files의 마지막 커밋일을
 *    GitHub API로 조회해 last_checked 이후 변경이 있으면 알려준다.
 *
 * 사용:  bun scripts/ref-check.mjs          # 전체 (네트워크 필요)
 *        bun scripts/ref-check.mjs --local  # 검증만 (오프라인)
 *        (bun run ref-check / --local 도 동일. Node 22+로도 실행 가능)
 *
 * 업데이트 절차는 REFERENCES.md 참조. 레지스트리 자체가 SSOT다.
 */
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const registry = JSON.parse(readFileSync(new URL('references.json', ROOT), 'utf8'));
const rulesSrc = readFileSync(new URL('rules.js', ROOT), 'utf8');

let errors = 0;
function fail(msg) { errors++; console.error(`  ✕ ${msg}`); }
function ok(msg) { console.log(`  ok  ${msg}`); }

// --- 1. 레지스트리 스키마 ----------------------------------------------------
console.log('# registry schema');
const ids = new Set();
const ROLES = ['upstream', 'benchmark', 'reference'];
for (const s of registry.sources) {
  for (const field of ['id', 'name', 'repo', 'url', 'role', 'license', 'key_files', 'adopted', 'last_checked']) {
    if (!(field in s)) fail(`${s.id ?? '(id 없음)'}: 필드 누락 — ${field}`);
  }
  if (!ROLES.includes(s.role)) fail(`${s.id}: 알 수 없는 role "${s.role}" (${ROLES.join('/')})`);
  if (ids.has(s.id)) fail(`출처 id 중복: ${s.id}`);
  ids.add(s.id);
}
if (registry.default_source && !ids.has(registry.default_source)) {
  fail(`default_source "${registry.default_source}"가 sources에 없음`);
}
if (errors === 0) ok(`sources ${ids.size}개, 스키마 정상`);

// --- 2. 규칙 src 필드 ↔ 출처 id ----------------------------------------------
console.log('# rule src mapping');
const ruleIds = new Set([...rulesSrc.matchAll(/id:\s*'([A-Z]-\d+)'/g)].map(m => m[1]));
// src sits on the line directly after the id line — anchor to the newline so
// the match cannot leak into the NEXT rule object.
const srcRe = /id:\s*'([A-Z]-\d+)',[^\n]*\n\s*src:\s*(\[[^\]]*\])/g;
let withSrc = 0;
for (const m of rulesSrc.matchAll(srcRe)) {
  const [, ruleId, arr] = m;
  withSrc++;
  for (const s of JSON.parse(arr.replace(/'/g, '"'))) {
    if (!ids.has(s)) fail(`${ruleId}.src "${s}"가 references.json에 없음`);
  }
}
if (errors === 0) ok(`src 표기 규칙 ${withSrc}개 — 출처 id 전부 일치 (나머지 ${ruleIds.size - withSrc}개는 기본 출처 "${registry.default_source}")`);

// --- 3. adopted 규칙 매핑 유효성 ----------------------------------------------
console.log('# adopted rule mapping');
let adoptedRules = 0;
for (const s of registry.sources) {
  for (const a of s.adopted ?? []) {
    for (const r of a.rules ?? []) {
      adoptedRules++;
      if (!ruleIds.has(r)) fail(`${s.id}.adopted: 존재하지 않는 규칙 id "${r}" — rules.js에서 이름이 바뀌었거나 삭제됨`);
    }
  }
}
if (errors === 0) ok(`adopted 규칙 매핑 ${adoptedRules}개 — rules.js와 전부 일치`);

// --- 4. 업스트림 드리프트 (네트워크) ------------------------------------------
if (process.argv.includes('--local')) {
  console.log('# upstream drift — 건너뜀 (--local)');
} else {
  console.log('# upstream drift (GitHub API)');
  const gh = async (path) => {
    const r = await fetch(`https://api.github.com${path}`, {
      headers: { 'User-Agent': 'humanize ref-check', 'Accept': 'application/vnd.github+json' }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  const day = (iso) => (iso ?? '').slice(0, 10);
  const isAfter = (a, b) => a > b; // ISO 날짜 문자열 비교

  for (const s of registry.sources) {
    try {
      const repo = await gh(`/repos/${s.repo}`);
      const pushed = day(repo.pushed_at);
      let line = `  ${s.id.padEnd(24)} 푸시 ${pushed} ★${repo.stargazers_count}${repo.archived ? ' [보관됨]' : ''}`;
      const drift = [];
      if (isAfter(pushed, s.last_checked)) drift.push(`저장소 갱신 (${pushed} > 점검 ${s.last_checked})`);
      for (const f of s.key_files ?? []) {
        try {
          const commits = await gh(`/repos/${s.repo}/commits?path=${encodeURIComponent(f)}&per_page=1`);
          const fd = day(commits[0]?.commit?.committer?.date);
          line += `\n      ${f} → ${fd}`;
          if (isAfter(fd, s.last_checked)) drift.push(`${f} (${fd})`);
        } catch { line += `\n      ${f} → 조회 실패`; }
      }
      console.log(line);
      if (drift.length) {
        console.log(`      ⚠ 드리프트: ${drift.join(' · ')} — key_files을 다시 읽고 adopted/deferred 검토 후 last_checked를 갱신하세요.`);
      }
    } catch (e) {
      console.log(`  ${s.id.padEnd(24)} 조회 실패 (${e.message}) — 네트워크 또는 API rate limit`);
    }
  }
}

// --- 결과 ---------------------------------------------------------------------
console.log('');
if (errors > 0) {
  console.error(`${errors} ERROR(S) — references.json 또는 rules.js 매핑을 고치세요.`);
  process.exit(1);
}
console.log('VALIDATION PASS');
