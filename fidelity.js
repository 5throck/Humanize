/*
 * HumanizeFidelity — semantic-fidelity check between an original text and its
 * polish result (JS port of byungjunjang/slop-rewrite check_fidelity.py,
 * MIT License; core rules F1/F2/F3/F7).
 *
 * Upstream design kept: document-level MULTISET comparison — sentences are
 * never paired. What it catches:
 *   - 지어낸 것 (S1-class, only things present ONLY in the result):
 *       수치 (new numbers; same value different unit = changed), 인용 (a
 *       quoted string that exists nowhere in the original body, compared
 *       whitespace-stripped as substrings), 자리표시자 ([사례 필요] etc.)
 *   - 사라진 것 (S2-class, report only — naturalness ranks above
 *       completeness, so a polished text MAY legitimately drop a sentence):
 *       수치, 인용, 부정 (negation count per family — 없다↔않다 rewording
 *       is expression, not meaning), 자리표시자, 링크, 각주
 *
 * Simplifications vs upstream (documented, deliberate):
 *   - F4 표제 / F5 문단 수 / F8 링크·표 / F9 각주 structural counts are
 *     reduced to bare counts for links/footnotes; heading/paragraph ratio
 *     gates are not ported (our chunking keeps structure; merge already
 *     reports change rate).
 *   - Composite amounts (1억 2,000만 → 120,000,000) are NOT canonically
 *     multiplied; number+unit pairs are compared as-is.
 *   - Segmentation is code-fence exemption only (no md/html segment types).
 * Polarity-flip JUDGMENT stays with the executor/prompt (upstream too:
 * "뜻이 뒤집혔는지는 이 검사기가 가리지 않는다").
 */
(function () {
  'use strict';

  // --- F1 수치·단위·날짜 -------------------------------------------------------
  var UNITS = ['%p', '%', '퍼센트', '개월', 'km', 'kg', 'GB', 'MB', 'KB', 'px', 'pt',
    '원', '천', '만', '억', '조', '건', '명', '개', '회', '일', '주', '년',
    '시', '분', '초', '배', '위', '등', '호', '쪽', 'm', 'g', '㎡', '평', '℃'];
  // 단위 뒤에 붙어도 단위로 인정하는 조사·접미사 — '12 원래'를 12원으로 읽지 않기 위한 경계.
  var JOSA = '은는이가을를에의으과와도만씩로나부까보밖정당짜째간여차반며랑엔란함';
  var NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
  var DATE_RE = /(?<![\d,.])(\d{4})\s?[.\-/년]\s?(\d{1,2})(?!\d)(?:\s?[.\-/월]\s?(\d{1,2})(?!\d))?/g;
  // 배수 단위 — 값에 곱해 정규화한다(3천 → 3000). 합성 수치(1억 2,000만)는
  // 첫 마디만 곱하고 나머지는 별개 수치로 보는 단순화를 택했다(upstream
  // canon_amount의 합성 마디 곱은 미포팅 — references.json deferred).
  var MULT = { '천': 1e3, '만': 1e4, '억': 1e8, '조': 1e12 };

  // --- F2 고유명사·인용 --------------------------------------------------------
  var LATIN_RE = /[A-Za-z][A-Za-z0-9.+\-]{1,}/g;
  var IDENT_RE = /[A-Z]-?\d+/g;
  var QUOTE_RES = [/「([^」]*)」/g, /『([^』]*)』/g, /"([^"\n]*)"/g, /“([^”]*)”/g, /‘([^’]*)’/g];

  // --- F3 부정 ------------------------------------------------------------------
  // 아니 계열은 통째로 부정이고 대조형(A가 아니라 B)만 뺀다 — upstream 주석 그대로.
  var NEG_ANI = '아니(?!라(?=[\\s,，、.!?…]|$)|고(?=[\\s,，、.!?…]|$))|아닌(?![\\s,，、.!?…]|$)|아닙|아님|아냐';
  var NEG_RES = {
    않: /않/g, 없: /없/g, 못: /못\s?하|못\s/g, 안: /안\s/g,
    아니: new RegExp(NEG_ANI, 'g'),
    미: /불가|미정|미확|미달|미비|미이행|미측정|미검토|미완/g
  };

  // --- F7 자리표시자 ------------------------------------------------------------
  var HOLE_RE = /\[(?:사례|숫자|출처|확인|근거|마무리)\s?필요[^\]]*\]|담당 미정|일정 미정|미정\(/g;

  // --- F8/F9 (카운트만) ----------------------------------------------------------
  var URL_RE = /https?:\/\/\S+/g;
  var FOOT_REF_RE = /\[\^([^\]\s]+)\](?!:)/g;

  // Fenced code blocks are exempt — numbers in code are not prose claims.
  function exemptCode(text) {
    return text.replace(/```[\s\S]*?```/g, ' ');
  }

  function multisetOf(items) {
    var m = Object.create(null);
    items.forEach(function (it) {
      var k = it.key;
      if (!m[k]) m[k] = [];
      m[k].push(it);
    });
    return m;
  }

  // 가장 긴 단위를 숫자 바로 뒤에서 찾고, 경계가 조사·비한글·끝이면 인정한다.
  function unitAt(text, end) {
    for (var i = 0; i < UNITS.length; i++) {
      var u = UNITS[i];
      if (text.indexOf(u, end) === end) {
        var next = text.charAt(end + u.length);
        if (!next || next < '가' || next > '힣' || JOSA.indexOf(next) >= 0 || next === '%') {
          return u;
        }
      }
    }
    return '';
  }

  function extractNumbers(text) {
    var out = [], m;
    NUM_RE.lastIndex = 0;
    while ((m = NUM_RE.exec(text)) !== null) {
      var raw = m[0];
      var val = raw.replace(/,/g, '');
      var unit = unitAt(text, m.index + raw.length);
      var rest = '';
      if (MULT[unit] !== undefined) {
        val = String(Number(val) * MULT[unit]);
        // 배수 단위 뒤 한 칸 공백을 건너 뒤따르는 단위(원·명·개…)까지 읽는다.
        var after = m.index + raw.length + unit.length;
        if (text.charAt(after) === ' ') after++;
        rest = unitAt(text, after);
        if (rest) NUM_RE.lastIndex = after + rest.length; // '3만 명'을 '3만'+'명'으로 재매칭하지 않게
      }
      out.push({ key: val + '|' + (rest || unit), label: raw + (unit || '') + (rest || ''), index: m.index });
    }
    return out;
  }

  function extractDates(text) {
    var out = [], m;
    DATE_RE.lastIndex = 0;
    while ((m = DATE_RE.exec(text)) !== null) {
      var label = m[0].replace(/\s+/g, '');
      out.push({ key: label, label: label, index: m.index });
    }
    return out;
  }

  function extractLatin(text) {
    var out = [], m;
    LATIN_RE.lastIndex = 0;
    while ((m = LATIN_RE.exec(text)) !== null) {
      if (IDENT_RE.test(m[0])) continue; // A-12 식 식별자는 수치 검사가 맡는다
      out.push({ key: m[0], label: m[0], index: m.index });
    }
    return out;
  }

  function extractQuotes(text) {
    var out = [];
    QUOTE_RES.forEach(function (re) {
      re.lastIndex = 0;
      var m;
      while ((m = re.exec(text)) !== null) {
        var body = m[1].replace(/\s+/g, '');
        if (body) out.push({ key: body, label: m[0], index: m.index });
      }
    });
    return out;
  }

  function extractNegations(text) {
    var counts = {};
    Object.keys(NEG_RES).forEach(function (fam) {
      NEG_RES[fam].lastIndex = 0;
      var n = 0;
      while (NEG_RES[fam].exec(text) !== null) n++;
      counts[fam] = n;
    });
    return counts;
  }

  function extractHoles(text) {
    var out = [], m;
    HOLE_RE.lastIndex = 0;
    while ((m = HOLE_RE.exec(text)) !== null) {
      out.push({ key: m[0], label: m[0], index: m.index });
    }
    return out;
  }

  function countMatches(text, re) {
    var m, reG = new RegExp(re.source, 'g'), n = 0;
    while ((m = reG.exec(text)) !== null) n++;
    return n;
  }

  // 인용 비교: 양쪽 공백을 다 지우고 부분 문자열로 본다 (upstream F2 규약).
  // 원문이 따옴표 없이 쓴 구절을 결과가 따옴표로 감싼 것은 있는 것으로 친다.
  function squash(text) { return text.replace(/\s+/g, ''); }

  /**
   * check(original, polished) → fidelity report.
   *   fabricated: {numbers, quotes, placeholders} — 결과에만 있는 것 (S1급)
   *   dropped:    {numbers, quotes, placeholders} — 사라진 것 (S2급 보고)
   *   unitChanged: [{from, to}] — 같은 값 다른 단위 (12% → 12%p)
   *   negations:  {orig, polished, perFamily:{orig, polished}} — 감소한 계열 확인용
   *   links, footnotes: {orig, polished} 카운트
   */
  function check(original, polished) {
    var o = exemptCode(String(original || '')), p = exemptCode(String(polished || ''));
    var report = {
      fabricated: { numbers: [], quotes: [], placeholders: [] },
      dropped: { numbers: [], quotes: [], placeholders: [] },
      unitChanged: [],
      negations: null,
      links: { orig: countMatches(o, URL_RE), polished: countMatches(p, URL_RE) },
      footnotes: { orig: countMatches(o, FOOT_REF_RE), polished: countMatches(p, FOOT_REF_RE) },
      clean: true
    };

    // F1 수치 — (값|단위) 다중집합 대조. 같은 값이 양쪽에 있으면 개수가 아닌
    // 단위 대조로 판정한다(upstream: 양쪽 단위를 다 읽었는데 다를 때만 변경).
    var numsO = extractNumbers(o), numsP = extractNumbers(p);
    var mO = multisetOf(numsO), mP = multisetOf(numsP);
    var values = {};
    Object.keys(mO).forEach(function (k) { values[k.split('|')[0]] = true; });
    Object.keys(mP).forEach(function (k) { values[k.split('|')[0]] = true; });
    Object.keys(values).forEach(function (val) {
      var oKeys = Object.keys(mO).filter(function (k) { return k.split('|')[0] === val; });
      var pKeys = Object.keys(mP).filter(function (k) { return k.split('|')[0] === val; });
      var oCount = oKeys.reduce(function (a, k) { return a + mO[k].length; }, 0);
      var pCount = pKeys.reduce(function (a, k) { return a + mP[k].length; }, 0);
      if (oCount > 0 && pCount > 0) {
        // 양쪽 모두 있는 값: 단위 구성이 달라졌으면 changed, 아니면 정상.
        var oUnits = oKeys.map(function (k) { return k.split('|')[1]; });
        var pUnits = pKeys.map(function (k) { return k.split('|')[1]; });
        var sameUnits = oUnits.length === pUnits.length && oUnits.every(function (u) { return pUnits.indexOf(u) >= 0; });
        if (!sameUnits && oUnits.every(function (u) { return u; }) && pUnits.every(function (u) { return u; })) {
          report.unitChanged.push({ from: mO[oKeys[0]][0].label, to: mP[pKeys[0]][0].label });
        }
        return;
      }
      if (pCount > 0) {
        report.fabricated.numbers.push({ label: mP[pKeys[0]][0].label, excerpt: excerpt(p, mP[pKeys[0]][0].index) });
      } else {
        report.dropped.numbers.push({ label: mO[oKeys[0]][0].label, excerpt: excerpt(o, mO[oKeys[0]][0].index) });
      }
    });
    // 날짜 — 다중집합 (단위 개념 없음)
    var dO = multisetOf(extractDates(o)), dP = multisetOf(extractDates(p));
    Object.keys(dP).forEach(function (k) { if (!dO[k]) report.fabricated.numbers.push({ label: dP[k][0].label, excerpt: excerpt(p, dP[k][0].index) }); });
    Object.keys(dO).forEach(function (k) { if (!dP[k]) report.dropped.numbers.push({ label: dO[k][0].label, excerpt: excerpt(o, dO[k][0].index) }); });

    // F2 인용 — upstream 규약: 결과의 인용 몸통은 원문(공백 제거) 어디엔가
    // 있어야 한다(원문이 따옴표 없이 쓴 구절이어도 된다). 원문 인용은 결과에
    // 그대로(raw 부분문자열) 남지 않으면 사라진 것으로 보고한다.
    var oSquash = squash(o);
    extractQuotes(o).forEach(function (q) {
      if (p.indexOf(q.key) < 0) report.dropped.quotes.push({ label: q.label, excerpt: excerpt(o, q.index) });
    });
    extractQuotes(p).forEach(function (q) {
      if (oSquash.indexOf(q.key) < 0) report.fabricated.quotes.push({ label: q.label, excerpt: excerpt(p, q.index) });
    });

    // F3 부정 — 계열별 카운트 (감소 = 사라진 부정 의심. 뜻 뒤집힘 판정은 실행자 몫)
    var negO = extractNegations(o), negP = extractNegations(p);
    var perFamily = {};
    Object.keys(NEG_RES).forEach(function (fam) {
      if (negP[fam] < negO[fam]) perFamily[fam] = { orig: negO[fam], polished: negP[fam] };
    });
    report.negations = { orig: negO, polished: negP, droppedFamilies: perFamily };

    // F7 자리표시자
    extractHoles(o).forEach(function (h) {
      if (p.indexOf(h.key) < 0) report.dropped.placeholders.push({ label: h.label });
    });
    extractHoles(p).forEach(function (h) {
      if (o.indexOf(h.key) < 0) report.fabricated.placeholders.push({ label: h.label });
    });

    // 고유명사·라틴 토큰 — 결과에만 있고 원문에 전혀 없는 토큰 (참고용)
    var latO = multisetOf(extractLatin(o));
    var newTokens = [];
    extractLatin(p).forEach(function (t) {
      if (!latO[t.key]) newTokens.push(t.label);
    });
    if (newTokens.length) report.fabricated.properNouns = newTokens.slice(0, 10);

    report.clean = report.fabricated.numbers.length === 0 &&
      report.fabricated.quotes.length === 0 &&
      report.fabricated.placeholders.length === 0 &&
      report.unitChanged.length === 0;
    return report;
  }

  function excerpt(text, at, width) {
    width = width || 24;
    if (at == null) return '';
    var a = Math.max(0, at - width / 2);
    return '…' + text.slice(a, at + width).replace(/\s+/g, ' ').trim() + '…';
  }

  window.HumanizeFidelity = {
    check: check,
    constants: { UNITS: UNITS }
  };
})();
