/*
 * HumanizeLexicon — lexical-layer hints (JS port of epoko77-ai/im-not-ai
 * v2.4.x scripts/lexical_layer.py, MIT License; data in lexicon-data.js).
 *
 * Why it exists (upstream rationale): apart from sentence-structure tells,
 * AI prose contains words Korean readers stumble on — "~의 렌즈로 보면",
 * "세 개의 축으로", "성공을 달성한다". The lexicon (blind-evaluated 148
 * candidates → 111 awkward + maintainer additions, v2.4.6 = 115 entries) is
 * **NOT batch-replaced**: the same word may be legitimate by genre/context,
 * and fixed replacements would become new stock phrases.
 *
 * What this does (hints path only):
 *   1. findHits(text, genre) — finds lexicon entries present in the text,
 *      excluding direct quotes (Do-NOT list) and per-genre skip lists,
 *      using each entry's BROAD detect regex for recall.
 *   2. hintBlock(hits) / hintBlockFor(text, genre) — renders the
 *      [어휘 점검] block the executor (LLM) reads: per found entry, the
 *      바꿀 때 / 둘 때 / 방식 guidance. Cost scales with found items only.
 *
 * Not ported here: the restore path (reverting sentences that gained a
 * restore=true headword) — it depends on upstream restore_modality.py's
 * sentence-alignment machinery. Our LLM prompt's self-check
 * (절차 3 ③ / 자체검증 ⑥ "새 티 주입 없음") covers the same failure mode;
 * recorded in references.json deferred.
 *
 * Upstream invariants kept: LLM calls = 0; the layer must never break the
 * polish run (graceful degrade to ""); exit semantics are advisory only.
 */
(function () {
  'use strict';

  var EXCLUDE_WINDOW = 12; // 정당 용법 제외 창: 매치 앞뒤 12자(매치 포함)
  var MAX_HINTS = 15;      // 블록 상한 — 발견이 많아도 프롬프트가 폭주하지 않게

  // 스킬 장르 키 → 사전 장르 (upstream GENRE_MAP; 우리 장르는 report만 매핑됨)
  var GENRE_MAP = { report: '보고서', abstract: '논문', paper: '논문' };
  var DEFAULT_GENRE = '일반';

  // 직접 인용 구간 — 인용 안의 낱말은 힌트에서 뺀다(인용 원형 보존).
  // 실측(v2.4.1): AI 티를 설명하는 글이 "잠금 해제한다" 같은 예문을 인용하자
  // 그 인용까지 힌트로 실려 실행자가 인용을 고칠 뻔했다.
  var QUOTE_RE = new RegExp(
    '"[^"\\n]{1,200}"|“[^”\\n]{1,200}”|‘[^’\\n]{1,200}’|「[^」\\n]{1,200}」|『[^』\\n]{1,200}』' +
    "|(?<![A-Za-z0-9])'[^'\\n]{1,200}'(?![A-Za-z0-9])"
  );

  function quoteSpans(text) {
    var spans = [], m, re = new RegExp(QUOTE_RE.source, 'g');
    while ((m = re.exec(text)) !== null) spans.push([m.index, m.index + m[0].length]);
    return spans;
  }

  function outsideQuotes(matches, spans) {
    return matches.filter(function (m) {
      for (var i = 0; i < spans.length; i++) {
        if (spans[i][0] <= m.index && m.index < spans[i][1]) return false;
      }
      return true;
    });
  }

  function loadLexicon() {
    var data = (typeof window !== 'undefined' ? window : globalThis).HumanizeLexiconData;
    if (!data || !data.entries) {
      throw new Error('HumanizeLexiconData가 로드되지 않았습니다 — lexicon-data.js를 먼저 읽으세요.');
    }
    if (!data._compiled) {
      data.entries.forEach(function (e) {
        // 복원용(좁고 정밀) — 결정적 변형에 쓴다(우리는 hints만 사용)
        e._re = new RegExp(e.regex, 'g');
        e._ex = e.regex_exclude ? new RegExp(e.regex_exclude) : null;
        // 힌트용(넓은 재현율) — 최종 판단은 실행자가 문맥으로 한다.
        if (e.regex_detect) {
          e._dre = new RegExp(e.regex_detect, 'g');
          e._dex = e.regex_detect_exclude ? new RegExp(e.regex_detect_exclude) : null;
        } else {
          e._dre = e._re;
          e._dex = e._ex;
        }
      });
      data._compiled = true;
    }
    return data;
  }

  function genreKey(genre) {
    var g = (genre || '').trim().toLowerCase();
    return GENRE_MAP[g] || DEFAULT_GENRE;
  }

  // One entry's matches in text (broad detect regex when detect=true).
  function matches(entry, text, detect) {
    var re = detect ? entry._dre : entry._re;
    var ex = detect ? entry._dex : entry._ex;
    re.lastIndex = 0;
    var out = [], m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (ex !== null) {
        var w = text.slice(Math.max(0, m.index - EXCLUDE_WINDOW), m.index + m[0].length + EXCLUDE_WINDOW);
        if (ex.test(w)) continue;
      }
      out.push({ index: m.index, text: m[0] });
      if (m[0].length === 0) re.lastIndex++; // safety, upstream skips empties too
    }
    return out;
  }

  // 원문에서 발견된 항목. 장르가 skip_genres에 있으면 제외하고,
  // 직접 인용 안의 낱말은 세지 않는다.
  function findHits(text, genre) {
    var lex = loadLexicon();
    var g = genreKey(genre);
    var spans = quoteSpans(text);
    var hits = [];
    lex.entries.forEach(function (e) {
      if ((e.skip_genres || []).indexOf(g) >= 0) return;
      var ms = outsideQuotes(matches(e, text, true), spans);
      if (!ms.length) return;
      hits.push({
        id: e.id, headword: e.headword, tier: e.tier, count: ms.length,
        examples: ms.slice(0, 2).map(function (m) { return m.text; }),
        change_when: (e.change_when || {})[g] || '',
        keep_when: (e.keep_when || {})[g] || '',
        how: (e.how || {})[g] || ''
      });
    });
    // 2점(change) 먼저, 같은 등급 안에서는 반복이 많은 순
    hits.sort(function (a, b) {
      if ((a.tier !== 'change') !== (b.tier !== 'change')) return a.tier === 'change' ? -1 : 1;
      return b.count - a.count;
    });
    return hits;
  }

  function renderHintBlock(hits, maxItems) {
    maxItems = maxItems || MAX_HINTS;
    if (!hits.length) return '';
    var lines = [
      '[어휘 점검]',
      '아래는 원문에서 발견된, 한국어 독자가 어색하게 느끼는 표현이다(독자 평가 기반). ' +
        '항목마다 문맥을 보고 판단한다 — 일괄 치환하지 않는다. \'둘 때\'에 해당하면 그대로 둔다. ' +
        '바꿀 때는 \'방식\'을 따르되 문장의 사실·주장 강도·서법은 그대로 두고, 이 목록의 다른 표현으로 바꾸지 않는다. ' +
        '[우선]은 쓰였으면 바꾸는 쪽을 먼저 검토하고, [조건부]는 반복되거나 장르에 맞지 않을 때만 바꾼다.'
    ];
    hits.slice(0, maxItems).forEach(function (h) {
      var tag = h.tier === 'change' ? '우선' : '조건부';
      var found = h.examples.map(function (x) { return '"' + x + '"'; }).join(' / ');
      var rep = h.count > 1 ? ' ×' + h.count : '';
      lines.push('- [' + tag + '] ' + h.headword + ' — 원문: ' + found + rep);
      if (h.change_when) lines.push('  바꿀 때: ' + h.change_when);
      if (h.keep_when) lines.push('  둘 때: ' + h.keep_when);
      if (h.how) lines.push('  방식: ' + h.how);
    });
    if (hits.length > maxItems) {
      lines.push('(그 밖에 ' + (hits.length - maxItems) + '개 항목은 생략 — 위 항목을 우선한다)');
    }
    lines.push('[어휘 점검 끝]');
    return lines.join('\n');
  }

  // prepare_monolith_input 용 진입점과 동일 역할: 사전이 없거나 깨져도 윤문을 막지 않는다.
  function hintBlockFor(text, genre) {
    try {
      return renderHintBlock(findHits(text, genre));
    } catch (e) {
      return '';
    }
  }

  window.HumanizeLexicon = {
    findHits: findHits,
    hintBlock: renderHintBlock,
    hintBlockFor: hintBlockFor,
    genreKey: genreKey,
    constants: { EXCLUDE_WINDOW: EXCLUDE_WINDOW, MAX_HINTS: MAX_HINTS, DEFAULT_GENRE: DEFAULT_GENRE }
  };
})();
