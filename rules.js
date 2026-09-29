/*
 * HumanizeRules — Korean de-AI polish rules for the web (multi-source).
 *
 * Provenance is tracked in references.json (registry SSOT — see
 * REFERENCES.md for the update protocol and `node scripts/ref-check.mjs`
 * for upstream drift checks). Sources:
 *   - Core rulebook ported from epoko77-ai/im-not-ai (MIT License),
 *     https://github.com/epoko77-ai/im-not-ai
 *       - skills/humanize-korean/references/quick-rules.md (slim rulebook)
 *       - agents/humanize-monolith.md (prime directives, self-check, grading)
 *   - Benchmark additions (2026-09), pattern-verified against sibling repos:
 *       - IsaacEryn/humanizer-ko (35 patterns → K category, A-8 보여지/쓰여지)
 *       - devswha/patina (KO/EN/ZH/JA → markup leakage J-4, thematic break J-5,
 *         fake candor gate, burstiness CV calibration, MATTR, -다 monorhythm)
 *       - amondnet/yoonmoon (과소 서술 축 → prompt-side guard only)
 *
 * Each rule carries a `src` array of source ids from references.json.
 * Rules WITHOUT `src` follow the core rulebook (im-not-ai).
 *
 * Scope: deterministic, context-free prescriptions only. Structural rewrites
 * (clause splitting, rhythm control, hedging variation) are DETECT-ONLY here;
 * they need an LLM — see prompt.js for the monolith-style system prompt.
 *
 * Prime directives kept from upstream:
 *   1. Meaning invariance (facts, numbers, names, quotes untouched)
 *   2. Evidence-based edits only (rules below are the allowlist)
 *   3. Genre preservation
 *   4. Over-polish guard (change rate 30% warn / 50% abort)
 *   Do-NOT: proper nouns, numbers, dates, quoted speech, legal text,
 *   English acronyms (LLM, GPU, API...) stay untouched.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Hangul helpers
  // ---------------------------------------------------------------------------

  function hasFinalConsonant(word) {
    var ch = (word || '').trim().slice(-1);
    var code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
    return false;
  }

  function subjectParticle(word) {
    return hasFinalConsonant(word) ? '이' : '가';
  }

  var EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu;

  // ---------------------------------------------------------------------------
  // Rule definitions
  //
  // Each rule: { id, cat, name, severity (1=S1, 2=S2), note,
  //   detect(text) -> number of matches (0 = clean),
  //   fix?(text)   -> { text, applied }  (optional; only rules safe to auto-fix)
  // }
  // Fix rules are applied in array order after their detect count is taken,
  // so per-rule "before" counts describe the ORIGINAL text.
  // ---------------------------------------------------------------------------

  var RULES = [
    // --- A. Translation-ese -------------------------------------------------
    {
      id: 'A-3', cat: 'A', name: '번역투 "~에 있어(서)"', severity: 1,
      detect: function (t) { return count(t, /([가-힣A-Za-z0-9]+)에 있어(서)?(?=[^\uAC00-\uD7A3]|$)/g) - count(t, /에 있어(요|세요)/g); },
      fix: function (t) {
        var n = 0, out;
        out = t.replace(/([가-힣A-Za-z0-9]+)에 있어서/g, function (m, p1) { n++; return p1 + '에서'; });
        // Only when followed by a spaced Hangul word — avoids "부산에 있어요/있어."
        out = out.replace(/([가-힣A-Za-z0-9]+)에 있어 (?=[가-힣])/g, function (m, p1) { n++; return p1 + '에서 '; });
        return { text: out, applied: n };
      }
    },
    {
      id: 'A-7', cat: 'A', name: '"~을 가지고 있다" 직역', severity: 1,
      detect: function (t) { return count(t, /가지고 (있[다어니고]|있어)/g); }
    },
    {
      id: 'A-8', cat: 'A', name: '이중 피동 "~되어진다"', severity: 1,
      src: ["im-not-ai", "isaac-humanizer-ko"],
      // 진/질/져 are precomposed syllables — each alternative needs its own form.
      // 보여지/쓰여지 family: benchmark (IsaacEryn/humanizer-ko §13) — same
      // double-passive family; 진 forms (보여진다) are conjugations of 지다.
      detect: function (t) {
        return count(t, /(되어진|되어질|되어져|되어지|보여진|보여질|보여져|보여지|쓰여진|쓰여질|쓰여져|쓰여지)/g)
          + count(t, /(되|어|여|겨|져|이)지게 (된다|됐다|되었다)/g);
      },
      fix: function (t) {
        var n = 0, out = t;
        var map = [
          [/되어진다/g, '된다'], [/되어진/g, '된'], [/되어지는/g, '되는'],
          [/되어져/g, '돼'], [/되어질/g, '될'], [/되어지고/g, '되고'],
          [/되어지며/g, '되며'], [/되어지니/g, '되니'], [/되어지면/g, '되면'],
          [/보여진다/g, '보인다'], [/보여져/g, '보여'], [/보여진/g, '보인'],
          [/보여질/g, '보일'], [/보여지/g, '보이'],
          [/쓰여진다/g, '쓰인다'], [/쓰여져/g, '쓰여'], [/쓰여진/g, '쓰인'],
          [/쓰여질/g, '쓰일'], [/쓰여지/g, '쓰이'],
          [/되어지/g, '되']
        ];
        map.forEach(function (pair) {
          out = out.replace(pair[0], function (m) { n++; return pair[1]; });
        });
        out = out.replace(/(되|어|여|겨|져|이)지게 (된다|됐다|되었다)/g, function (m, p1) { n++; return p1 + '진다'; });
        return { text: out, applied: n };
      }
    },
    {
      id: 'A-9', cat: 'A', name: '"~에 의해" 수동태', severity: 2,
      detect: function (t) { return count(t, /에 의해(서)?/g); }
    },
    {
      id: 'A-10', cat: 'A', name: '"~할 수 있다" 4회+ 반복', severity: 2,
      src: ["im-not-ai"],
      // Detect-only — redistribution needs sentence-level surgery (LLM mode).
      // 의학·법률·정책 텍스트는 헤지가 의미다 — upstream 예외는 프롬프트 룰북이 담당.
      detect: function (t) { var c = count(t, /할 수 있/g); return c >= 4 ? c : 0; }
    },
    {
      id: 'A-19', cat: 'A', name: '이중 조사 "~에서의/~으로의"', severity: 2,
      src: ["im-not-ai"],
      // 에의/으로부터의: upstream A-19 expansion (v2.x).
      detect: function (t) { return count(t, /에서의|으로의|에로의|에의|으로부터의/g); }
    },
    {
      id: 'A-21', cat: 'A', name: '"단순한 X를 넘어 Y"', severity: 2,
      detect: function (t) { return count(t, /단순(한|히) [가-힣A-Za-z0-9]+(를|을)? ?넘어/g); }
    },
    {
      id: 'A-24', cat: 'A', name: '"더 이상 ~않다" 재정의', severity: 2,
      detect: function (t) { return count(t, /더 이상/g); }
    },

    // --- B. English buzzwords ------------------------------------------------
    {
      id: 'B-1', cat: 'B', name: '한글+괄호 영어 병기 반복', severity: 2,
      detect: function (t) { return repeatedGlossCount(t); },
      fix: function (t) {
        var seen = Object.create(null), n = 0;
        var out = t.replace(/([가-힣]{2,})\s*\(([A-Za-z][A-Za-z0-9\s\-&.]{1,40}?)\)/g, function (m, ko, en) {
          if (!seen[ko]) { seen[ko] = true; return m; }
          n++; return ko;
        });
        return { text: out, applied: n };
      }
    },
    {
      id: 'B-2', cat: 'B', name: '광고성 영어 buzzword', severity: 2,
      detect: function (t) { return count(t, /\b(seamless|robust|leverage|cutting-edge|state-of-the-art|game-chang\w*|empower\w*|holistic)\b/gi); }
    },

    // --- C. Structural patterns ----------------------------------------------
    {
      id: 'C-5', cat: 'C', name: '이모지 남발', severity: 1,
      detect: function (t) { return countEmoji(t); },
      fix: function (t) {
        // Prescription applies to column/report; guard with a count threshold.
        var c = countEmoji(t);
        if (c < 5) return { text: t, applied: 0 };
        return { text: t.replace(EMOJI_RE, '').replace(/ {2,}/g, ' '), applied: c };
      }
    },
    {
      id: 'C-7', cat: 'C', name: '문두 "먼저-반면-결국" 3단 공식', severity: 2,
      detect: function (t) {
        var heads = sentenceHeads(t);
        var hits = 0;
        ['먼저', '반면', '결국', '한편', '그러나'].forEach(function (w) {
          if (heads[w] >= 1) hits++;
        });
        return hits >= 2 ? hits : 0;
      }
    },
    {
      id: 'C-8', cat: 'C', name: '"A가 아니라 B" 대구 반복', severity: 1,
      detect: function (t) {
        var c = count(t, /(가 아니라|것이 아니라|것은 아니다|것이 아니다)/g) + count(t, /인가\?[^.?!\n]{2,60}인가\?/g);
        return c >= 2 ? c : 0;
      }
    },
    {
      id: 'C-9', cat: 'C', name: '숫자 괄호 인덱싱 "1) 2) 3)"', severity: 2,
      detect: function (t) { return count(t, /\d\)/g) >= 3 ? count(t, /\d\)/g) : 0; }
    },
    {
      id: 'C-10', cat: 'C', name: '콜론 부제 헤딩 "X: Y"', severity: 1,
      detect: function (t) {
        return count(t, /^[ \t]*(#{1,6}\s+|\*\*)[^:\n]{2,40}[:：]/gm) >= 3
          ? count(t, /^[ \t]*(#{1,6}\s+|\*\*)[^:\n]{2,40}[:：]/gm) : 0;
      }
    },
    {
      id: 'C-11', cat: 'C', name: '연결어미 직후 쉼표', severity: 1,
      detect: function (t) { return count(t, /([가-힣](?:고|며|지만|면서|아서|어서|으나|는데)),(?=\s*[가-힣A-Za-z])/g); },
      fix: function (t) {
        // Prescription: trigger on clusters (upstream: 6+ = strong signal;
        // 3+ is already mechanical — removing the comma is always safe).
        var c = count(t, /([가-힣](?:고|며|지만|면서|아서|어서|으나|는데)),(?=\s*[가-힣A-Za-z])/g);
        if (c < 3) return { text: t, applied: 0 };
        var out = t.replace(/([가-힣](?:고|며|지만|면서|아서|어서|으나|는데)),(?=\s*[가-힣A-Za-z])/g, '$1');
        return { text: out, applied: c };
      }
    },

    // --- D. Signature phrases -------------------------------------------------
    {
      id: 'D-1', cat: 'D', name: '결산 lexicon 남발', severity: 1,
      src: ["im-not-ai"],
      // 이를 통해: upstream D-1 expansion (문두 결산 lexicon).
      detect: function (t) {
        return count(t, /(^|[.!?]\s+)(결론적으로|그러므로|따라서|이에 따라|이를 통해|요약하면|정리하자면|요컨대|종합하면)(,|:)?\s+/gm);
      },
      fix: function (t) {
        // Upstream: trim only when the lexicon exceeds 3 ("3회 초과 시").
        var total = count(t, /(^|[.!?]\s+)(결론적으로|그러므로|따라서|이에 따라|이를 통해|요약하면|정리하자면|요컨대|종합하면)(,|:)?\s+/gm);
        if (total < 4) return { text: t, applied: 0 };
        var seen = 0, n = 0;
        var out = t.replace(/(^|[.!?]\s+)(결론적으로|그러므로|따라서|이에 따라|이를 통해|요약하면|정리하자면|요컨대|종합하면)(,|:)?\s+/gm,
          function (m, pre, word, comma) {
            seen++;
            if (seen <= 2) return m; // keep first two; delete the rest
            n++;
            return pre;
          });
        return { text: out, applied: n };
      }
    },
    {
      id: 'D-2', cat: 'D', name: '의의 과장 "시사하는 바가 크다"', severity: 1,
      detect: function (t) { return count(t, /시사하는 바가 크|주목할 만하|중요한 (의미|함의)를 (갖|지니)|매우 중요하다/g); }
    },
    {
      id: 'D-3', cat: 'D', name: '열거 도입구 "크게 세 가지로 나눌 수 있다"', severity: 1,
      detect: function (t) { return count(t, /(크게 |대략 )?[가-힣0-9]+ ?가지로 (나눌|구분할) 수 있다|다음과 같은/g); },
      fix: function (t) {
        var n = 0, out = t;
        // Standalone lead-in sentence: remove the whole line.
        out = out.replace(/^[ \t]*(크게 |대략 )?[가-힣0-9]+ ?가지로 (나눌|구분할) 수 있다[.!?]*[ \t]*\n/gm, function () { n++; return ''; });
        // Inline lead-in before content: drop the clause.
        out = out.replace(/(크게 |대략 )?[가-힣0-9]+ ?가지로 (나눌|구분할) 수 있다([:：,]|\s)+/g, function () { n++; return ''; });
        return { text: out, applied: n };
      }
    },
    {
      id: 'D-5', cat: 'D', name: '의인화 추상 주어', severity: 2,
      detect: function (t) {
        return count(t, /(기술|시대|시장|역사|데이터|트렌드|변화|시간)(이)? ?(묻[는고]|부르[는고]|속삭이|요구하|밀어붙|몰아세)/g);
      }
    },
    {
      id: 'D-6', cat: 'D', name: '결말 공식 "~할 때입니다"', severity: 2,
      detect: function (t) { return count(t, /할 때입니다|시점입니다|할 순간입니다|타임입니다/g); }
    },
    {
      id: 'D-8', cat: 'D', name: '분열문 "필요한 것은 ~이다"', severity: 2,
      src: ["im-not-ai"],
      detect: function (t) {
        // 문제는/핵심은/관건은/답은 명사 변종: upstream D-8 expansion.
        return count(t, /(필요한|중요한) (것은|건) [가-힣A-Za-z0-9]+(이다|다)\.|(문제는|핵심은|관건은|답은) [가-힣A-Za-z0-9]+(이다|다)\./g);
      },
      fix: function (t) {
        // Only sentence-initial, single-noun predicates — "필요한 것은 방향이다."
        //   -> "방향이 필요하다."  (upstream D-8 prescription)
        var n = 0;
        var out = t.replace(/(^|[.!?]\s+)(?:필요한|중요한) (?:것은|건) ([가-힣A-Za-z0-9]{1,15}?)(이다|다)\./g,
          function (m, pre, noun) {
            n++;
            return pre + noun + subjectParticle(noun) + (/필요한/.test(m) ? ' 필요하다.' : ' 중요하다.');
          });
        return { text: out, applied: n };
      }
    },
    {
      id: 'D-9', cat: 'D', name: '"~로 이어진다/직결된다" 결산', severity: 2,
      detect: function (t) {
        var c = count(t, /(으)?로 이어진다|에 직결된다/g);
        var gyeol = count(t, /(^|[.!?]\s+)결국/gm);
        return c + (gyeol >= 2 ? gyeol : 0);
      }
    },
    {
      id: 'D-10', cat: 'D', name: '도치 결산 "~하는 이유다"', severity: 2,
      detect: function (t) {
        var c = count(t, /(하는 이유다|기 때문이다)[.!?]?\s*$/gm);
        return c >= 2 ? c : 0;
      }
    },
    {
      id: 'D-12', cat: 'D', name: '독립 문패 "과제도 남아 있다"', severity: 2,
      detect: function (t) { return count(t, /과제도 남아 있|한계도 분명하|아쉬운 점도 있|숙제도 남아 있/g); }
    },
    {
      id: 'D-14', cat: 'D', name: '사전 은유·감각 술어', severity: 2,
      src: ["im-not-ai"],
      detect: function (t) {
        // Upstream v2.x: 사람 코퍼스 실측 0건 → 1회+ 발동 (구 2회+ 완화).
        var c = count(t, /잠식|청사진|적신호|경고등|신호탄|움켜쥐|뿌리내리|짓누르/g);
        // 감각 술어 평가문 ("진단은 서늘하다/경고는 아프다") — upstream 1회+.
        c += count(t, /(진단|평가|경고|결론|메시지)은? (서늘하|아프|무겁|차갑|쓰라)/g);
        return c;
      }
    },

    // --- E. Rhythm -------------------------------------------------------------
    {
      id: 'E-1', cat: 'E', name: '문장 길이 균일(리듬 단조)', severity: 2,
      // Kept at upstream's CV 0.25: patina's 0.30 is calibrated on WORD-token
      // burstiness (어절); char-length CV runs lower, so 0.30 here fired on
      // human news prose (real measured 0.287). The recall gap is covered by
      // E-3's dedicated monorhythm rule instead.
      detect: function (t) {
        var lens = sentenceLengths(t);
        if (lens.length < 8) return 0;
        var mean = lens.reduce(function (a, b) { return a + b; }, 0) / lens.length;
        if (mean > 100) return 0;
        var variance = lens.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / lens.length;
        var cv = Math.sqrt(variance) / mean;
        var hasLong = lens.some(function (l) { return l >= 100; });
        return (cv < 0.25 && !hasLong) ? 1 : 0;
      }
    },
    {
      id: 'E-2', cat: 'E', name: '종결어미 반복 / "~고 있다" 남발', severity: 2,
      detect: function (t) {
        var geuda = count(t, /고 (있[다니]|있습니다)/g);
        var streak = endingStreak(t);
        return Math.max(geuda >= 6 ? geuda : 0, streak >= 4 ? streak : 0);
      }
    },
    {
      // patina ending_monotony, precision-hardened: plain -다체 is the NORMAL
      // formal register in Korean, so it only fires when nearly every sentence
      // is 평서형 AND lengths are machine-uniform. Detect-only.
      id: 'E-3', cat: 'E', name: '평서 종결 단조(-다체 균일 리듬)', severity: 2,
      src: ["patina"],
      detect: function (t) {
        var sents = splitSentences(t);
        if (sents.length < 8) return 0;
        var da = sents.filter(function (s) {
          return /[^니]다[.!?]?$/.test(s) && !/(습|합|입)니다/.test(s);
        }).length;
        if (da / sents.length < 0.85) return 0;
        var lens = sents.map(function (s) { return s.length; });
        var mean = lens.reduce(function (a, b) { return a + b; }, 0) / lens.length;
        if (mean > 100) return 0;
        var variance = lens.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / lens.length;
        return (Math.sqrt(variance) / mean) < 0.25 ? 1 : 0;
      }
    },
    {
      // patina MATTR (sliding-window type-token ratio), conservative threshold:
      // Korean tokens carry josa so TTR runs higher — 0.50 (vs patina's 0.55)
      // keeps the flag for genuinely repetitive vocabulary. Detect-only.
      id: 'E-4', cat: 'E', name: '어휘 다양성 저하(MATTR)', severity: 2,
      src: ["patina"],
      detect: function (t) {
        var m = mattr(t);
        return (m !== null && m < 0.50) ? 1 : 0;
      }
    },

    // --- F. Over-modification ----------------------------------------------------
    {
      id: 'F-5', cat: 'F', name: '"~적 N" 추상 체인', severity: 2,
      detect: function (t) {
        var c = count(t, /[가-힣]{2,}적 (함의|기반|의미|접근|관점|차원|전환|과제|노력|가치|역량|토대)/g);
        return c >= 3 ? c : 0;
      }
    },

    // --- G. Hedging ---------------------------------------------------------------
    {
      id: 'G-1', cat: 'G', name: '추측 종결 반복', severity: 2,
      detect: function (t) {
        var c = count(t, /(로|으로) (보인다|보여진다|판단된다|여겨진다|추정된다)/g);
        return c >= 3 ? c : 0;
      }
    },
    {
      id: 'G-2', cat: 'G', name: '이중·삼중 완곡', severity: 2,
      detect: function (t) { return count(t, /가능성이 있을 수 있다|보여질 수 있다|있을 가능성도 있|가능성도 있을 것으로 보/g); }
    },

    // --- H. Connective overuse -----------------------------------------------------
    {
      id: 'H-4', cat: 'H', name: '"즉" 남발', severity: 2,
      detect: function (t) { return count(t, /(^|[.!?]\s+)즉(,|:)?\s+/gm); },
      fix: function (t) {
        var seen = 0, n = 0;
        var out = t.replace(/(^|[.!?]\s+)즉(,|:)?\s+/gm, function (m, pre) {
          seen++;
          if (seen <= 2) return m;
          n++;
          return pre;
        });
        return { text: out, applied: n };
      }
    },

    // --- I. Formal nouns --------------------------------------------------------------
    {
      id: 'I-2', cat: 'I', name: '형식명사 강조 "주목할 점은"', severity: 2,
      detect: function (t) { return count(t, /(주목할|중요한|짚어야 할) 점은/g); }
    },
    {
      id: 'I-3', cat: 'I', name: '"~다는 것이다/뜻이다" 결말', severity: 2,
      detect: function (t) { return count(t, /다는 (것이다|뜻이다)/g); },
      fix: function (t) {
        // "~다는 것이다." -> "~다."  (keep <=2 per prescription; fix from 3+)
        var c = count(t, /다는 (것이다|뜻이다)/g);
        if (c < 3) return { text: t, applied: 0 };
        var n = 0;
        var out = t.replace(/다는 (것이다|뜻이다)([.!?])/g, function (m, w, p) { n++; return '다' + p; });
        return { text: out, applied: n };
      }
    },
    {
      id: 'I-7', cat: 'I', name: '출처 없는 "~다는 분석이다"', severity: 2,
      detect: function (t) { return count(t, /다는 (분석이다|평가다|진단이다|해석이다|관찰이다)/g); }
    },

    // --- J. Visual decoration ---------------------------------------------------------
    {
      id: 'J-1', cat: 'J', name: '문장마다 볼드 강조', severity: 2,
      detect: function (t) { return count(t, /\*\*[^*\n]{1,60}\*\*/g); },
      fix: function (t) {
        var c = count(t, /\*\*[^*\n]{1,60}\*\*/g);
        if (c < 5) return { text: t, applied: 0 };
        var out = t.replace(/\*\*([^*\n]{1,60})\*\*/g, '$1');
        return { text: out, applied: c };
      }
    },
    {
      id: 'J-2', cat: 'J', name: '따옴표 강조 과다', severity: 2,
      detect: function (t) {
        var c = count(t, /[""]/g) / 2;
        return c >= 5 ? Math.floor(c) : 0;
      }
    },
    {
      id: 'J-3', cat: 'J', name: '대시(—) 부가설명 반복', severity: 2,
      detect: function (t) { return count(t, /\s[—–]\s/g); },
      fix: function (t) {
        var c = count(t, /\s[—–]\s/g);
        if (c < 4) return { text: t, applied: 0 };
        return { text: t.replace(/\s[—–]\s/g, ', '), applied: c };
      }
    },
    {
      // patina markup_leakage — top-evidence signal. Closed code fences are
      // legitimate (dev blogs); only an ODD fence count (leftover), model
      // artifact tags, and «...» wrappers count.
      id: 'J-4', cat: 'J', name: '마크업 잔재(코드펜스·태그 아티팩트)', severity: 1,
      src: ["patina"],
      detect: function (t) {
        var fences = count(t, /```/g);
        var orphan = (fences % 2 === 1) ? 1 : 0;
        return orphan
          + count(t, /<\/?(think|answer|output|reasoning|final)[^>]{0,40}>/gi)
          + count(t, /«[^»\n]{2,60}»/g);
      }
    },
    {
      // patina thematic_break — decoration overuse, document-level gate.
      id: 'J-5', cat: 'J', name: '수평 구분선 과다', severity: 2,
      src: ["patina"],
      detect: function (t) {
        var c = count(t, /^(-{3,}|\*{3,}|={3,}|_{3,})[ \t]*$/gm);
        return c >= 3 ? c : 0;
      }
    },

    // --- K. Chatbot residue (benchmark: IsaacEryn/humanizer-ko §20/22/28/33/35,
    //         devswha/patina tells B4 sycophancy) — all detect-only.
    {
      id: 'K-1', cat: 'K', name: '챗봇 잔여물·아부 톤', severity: 1,
      src: ["isaac-humanizer-ko", "patina"],
      detect: function (t) {
        return count(t, /도움이 되셨|더 자세한 설명이 필요하시|(계속할까요|예시를 들어드릴까요|더 도와드릴까요)\?|좋은 질문|예리하신? (질문|관찰|지적)|정확한 (통찰|지적)|핵심을 찔렀|탁월한 (관점|통찰|질문)|추가로 (궁금하신|알려드릴)/g);
      }
    },
    {
      id: 'K-2', cat: 'K', name: '예고 문장("~알아보겠습니다")', severity: 2,
      src: ["isaac-humanizer-ko"],
      detect: function (t) {
        return count(t, /(알아보|살펴보|짚어보|확인해 보)겠습니다|본격적으로 들어가기 전에/g);
      }
    },
    {
      // patina fake_candor — one use is normal human idiom, so density gate.
      // 말해서/말하자면 are separate stems (해 ≠ 하) — listed individually.
      id: 'K-3', cat: 'K', name: '가짜 솔직 오프너', severity: 2,
      src: ["isaac-humanizer-ko", "patina"],
      detect: function (t) {
        var c = count(t, /솔직히 말하자면|솔직히 말해서|솔직히 말씀드리면|솔직히 고백하면|까놓고 말하(자)?면|사실 말이죠/g);
        return c >= 2 ? c : 0;
      }
    },
    {
      id: 'K-4', cat: 'K', name: '상투적 긍정 마무리', severity: 2,
      src: ["isaac-humanizer-ko"],
      detect: function (t) { return count(t, /행보가 기대|귀추가 주목|궁극적으로|앞날이 기대/g); }
    }
  ];

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function count(text, re) {
    var m = text.match(re);
    return m ? m.length : 0;
  }

  function countEmoji(text) {
    var m = text.match(EMOJI_RE);
    return m ? m.length : 0;
  }

  // E-4: MATTR — mean type-token ratio over a 50-token sliding window
  // (patina's lexical-diversity axis). Incremental window, O(tokens).
  // Returns null when the text is too short to judge (< 200 tokens).
  function mattr(text) {
    var toks = text.toLowerCase().match(/[가-힣]+|[a-z0-9]+/g) || [];
    var W = 50;
    if (toks.length < 200) return null;
    var freq = Object.create(null), uniq = 0, sum = 0;
    for (var i = 0; i < toks.length; i++) {
      var add = toks[i];
      if (!freq[add]) uniq++;
      freq[add] = (freq[add] || 0) + 1;
      if (i >= W) {
        var drop = toks[i - W];
        freq[drop]--;
        if (freq[drop] === 0) { delete freq[drop]; uniq--; }
      }
      if (i >= W - 1) sum += uniq / W;
    }
    return sum / (toks.length - W + 1);
  }

  // B-1: how many gloss occurrences are redundant (2nd+ of the same term).
  function repeatedGlossCount(text) {
    var seen = Object.create(null), redundant = 0;
    var re = /([가-힣]{2,})\s*\(([A-Za-z][A-Za-z0-9\s\-&.]{1,40}?)\)/g, m;
    while ((m = re.exec(text)) !== null) {
      if (seen[m[1]]) redundant++; else seen[m[1]] = true;
    }
    return redundant;
  }

  function splitSentences(text) {
    return text
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function sentenceLengths(text) {
    return splitSentences(text).map(function (s) { return s.length; });
  }

  function sentenceHeads(text) {
    var heads = Object.create(null);
    splitSentences(text).forEach(function (s) {
      ['먼저', '반면', '결국', '한편', '그러나'].forEach(function (w) {
        if (s.indexOf(w) === 0) heads[w] = (heads[w] || 0) + 1;
      });
    });
    return heads;
  }

  // Longest run of sentences ending with the same DISTINCTIVE register
  // (습니다/요). Plain "다." endings are the normal formal register in Korean —
  // counting them would flag every formal text — so they are excluded.
  function endingStreak(text) {
    var sents = splitSentences(text);
    var best = 0, cur = 0, prev = '';
    sents.forEach(function (s) {
      var kind = /습니다\.?$/.test(s) ? 's' : /요\.?$/.test(s) ? 'y' : null;
      if (!kind) { cur = 0; prev = ''; return; }
      cur = kind === prev ? cur + 1 : 1;
      prev = kind;
      if (cur > best) best = cur;
    });
    return best;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function analyze(text) {
    var findings = [];
    RULES.forEach(function (rule) {
      var n = 0;
      try { n = rule.detect(text) || 0; } catch (e) { /* rule bug must not break the run */ }
      if (n > 0) findings.push({ id: rule.id, cat: rule.cat, name: rule.name, severity: rule.severity, count: n });
    });
    var s1 = findings.filter(function (f) { return f.severity === 1; }).reduce(function (a, f) { return a + f.count; }, 0);
    var s2 = findings.filter(function (f) { return f.severity === 2; }).reduce(function (a, f) { return a + f.count; }, 0);
    return { findings: findings, s1: s1, s2: s2, total: s1 + s2 };
  }

  function polish(text) {
    var out = text, applied = [];
    RULES.forEach(function (rule) {
      if (!rule.fix) return;
      var res;
      try { res = rule.fix(out); } catch (e) { return; }
      out = res.text;
      if (res.applied > 0) applied.push({ id: rule.id, name: rule.name, count: res.applied });
    });
    // Collapse whitespace artifacts left by deletions (D-1/D-3/H-4 removals).
    // Only intra-line spaces — "[.!?]\s{2,}" would merge paragraph breaks.
    out = out
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/([.!?])[ \t]{2,}/g, '$1 ')
      .replace(/^[\s,]+/gm, function (m) { return m.replace(/^[\s,]+/, function (x) { return x.indexOf('\n') >= 0 ? '\n' : ''; }); })
      .trim();
    return { text: out, applied: applied };
  }

  // Change rate — mirrors upstream scripts/metrics_v2.py change_rate():
  //   1 - difflib.SequenceMatcher(None, before, after).ratio()
  // ratio() = 2*M / (len(a)+len(b)). We run the same formula on word-like
  // tokens (character-level LCS is O(n*m) and too slow in a browser).
  function changeRate(before, after) {
    if (!before && !after) return 0;
    var a = tokenize(before), b = tokenize(after);
    var total = a.length + b.length;
    if (total === 0) return 0;
    var matched = lcsLength(a, b);
    return 1 - (2 * matched) / total;
  }

  function tokenize(text) {
    return text
      .toLowerCase()
      .match(/[가-힣]+|[a-z0-9]+|[^\s가-힣a-z0-9]/g) || [];
  }

  function lcsLength(a, b) {
    var n = a.length, m = b.length;
    if (n === 0 || m === 0) return 0;
    var prev = new Uint32Array(m + 1), cur = new Uint32Array(m + 1);
    for (var i = 1; i <= n; i++) {
      var ai = a[i - 1];
      for (var j = 1; j <= m; j++) {
        cur[j] = ai === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
      }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[m];
  }

  // Grade per upstream quick-rules self-scoring (computed on the POLISHED text).
  function grade(afterStats, rate) {
    if (afterStats.s1 >= 3 || rate >= 0.5) return { level: 'D', reason: 'S1 잔존 3건 이상 또는 변경률 50% 초과 — 재윤문 권장' };
    if (afterStats.s1 >= 1) return { level: 'C', reason: 'S1 잔존 ' + afterStats.s1 + '건 — LLM 모드 또는 2차 윤문 권장' };
    if (rate >= 0.1 && rate <= 0.25 && afterStats.s2 <= 2) return { level: 'A', reason: 'S1 0건, S2 ' + afterStats.s2 + '건, 변경률 ' + Math.round(rate * 100) + '%' };
    if (afterStats.s2 <= 4) return { level: 'B', reason: 'S1 0건, S2 ' + afterStats.s2 + '건, 변경률 ' + Math.round(rate * 100) + '%' };
    return { level: 'C', reason: 'S2 잔존 ' + afterStats.s2 + '건 — 추가 윤문 권장' };
  }

  window.HumanizeRules = {
    analyze: analyze,
    polish: polish,
    changeRate: changeRate,
    grade: grade,
    ruleCount: RULES.length
  };
})();
