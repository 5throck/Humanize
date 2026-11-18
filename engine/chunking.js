/*
 * HumanizeChunking — lossless long-text chunking for LLM mode.
 *
 * Faithful JS port of epoko77-ai/im-not-ai (MIT) chunking pipeline:
 *   - scripts/prepare_monolith_input.py  compute_chunk_spans / _pack_segment /
 *     _sentence_pieces / find_footnote_block_start / _render_chunk_header
 *   - scripts/reassemble_chunks.py       merge + per-chunk ratio validation
 *
 * Upstream rationale (kept verbatim in spirit):
 *   - Chunking exists because per-call rulebook/context reload was the token
 *     explosion ("폭발 원인은 콜마다 룰북·컨텍스트 재로드"); chunks are therefore
 *     LARGE (target 7,000 / cap 9,000). The web app's old 1,800-char chunk was
 *     flash-lite-specific and explicitly marked non-portable — do not shrink
 *     these constants for small models.
 *   - Chunks are OFFSET SPANS into the original string, never substrings:
 *     concatenating all spans must equal the original text exactly, which the
 *     lossless self-check enforces ("한 글자라도 어긋나면 fidelity 사고").
 *   - Cuts happen at the END of a blank-line run, so separators stay attached
 *     to the previous chunk's tail and each chunk starts at a paragraph start.
 *   - Heading glue: a chunk can never END with a heading line.
 *   - The trailing footnote block is passthrough: never sent to the LLM.
 *
 * Merge restores the original chunk's leading/trailing whitespace, so
 * feeding the original text back through merge reproduces it exactly
 * (왕복 항등 — the round-trip identity the upstream tests rely on).
 */
(function () {
  'use strict';

  // Constants — upstream im-not-ai v2.1 measured values.
  var CHUNK_RECOMMEND_MIN_CHARS = 15000; // chunk only makes sense above this
  var TARGET_CHUNK_CHARS = 7000;         // greedy packing target
  var MAX_CHUNK_CHARS = 9000;            // soft cap (warning when exceeded)
  // Sentence-boundary fallback trigger, kept separate from the cap on purpose:
  // also the "unsplittable long run" warning threshold (upstream keeps 4,000
  // for the loss-detection granularity of the reassembly ratio check).
  var SENT_SPLIT_TRIGGER_CHARS = 4000;
  var MIN_OVERRIDE_CHARS = 2000;         // floor for caller overrides

  var HEADING_LINE_RE = /^(?:#{1,6}\s|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\.|\d+\.\s|\d+\)\s|제\s*\d+\s*[장절편]|[가나다라마바사아자차카타파하]\.\s|\([0-9가-힣]+\))/;
  // Footnote definition lines. `\d+\)` overlaps the heading regex, but the
  // footnote check only applies to the contiguous block at EOF, which is
  // excluded from body chunking — no conflict (upstream note kept).
  var FOOTNOTE_LINE_RE = /^(?:\d+\)\s|\[\d+\]\s)/;
  var PARA_SEP_RE = /\n{2,}/g;
  // Sentence boundary: closing punctuation (+ quote-like closers) then spaces.
  // The cut lands at the END of the space run = start of the next sentence.
  var SENT_END_RE = /[.!?。！？…]['"'”’』」)\]]*\s+/g;

  function ChunkingError(message) {
    var e = new Error(message);
    e.name = 'ChunkingError';
    return e;
  }

  // Line spans INCLUDING the trailing newline — concatenation is exact.
  function lineSpans(text) {
    var spans = [], pos = 0, n = text.length;
    while (pos < n) {
      var nl = text.indexOf('\n', pos);
      if (nl === -1) { spans.push([pos, n]); break; }
      spans.push([pos, nl + 1]);
      pos = nl + 1;
    }
    return spans;
  }

  // Start offset of the footnote block at EOF, or null.
  // Walk lines backwards: blank lines pass, footnote lines extend the block,
  // anything else stops. At least one footnote line is required.
  function findFootnoteBlockStart(text) {
    var spans = lineSpans(text), start = null;
    for (var i = spans.length - 1; i >= 0; i--) {
      var line = text.slice(spans[i][0], spans[i][1]);
      if (!line.trim()) continue;
      if (FOOTNOTE_LINE_RE.test(line)) { start = spans[i][0]; continue; }
      break;
    }
    return start;
  }

  // Does [a, b) contain a real body line (not heading, not blank)?
  function hasSubstantive(body, a, b) {
    var lines = body.slice(a, b).split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() && !HEADING_LINE_RE.test(lines[i])) return true;
    }
    return false;
  }

  function endsWithHeading(text, start, end) {
    var region = text.slice(start, end).replace(/\s+$/, '');
    if (!region) return false;
    var lastLine = region.slice(region.lastIndexOf('\n') + 1);
    return HEADING_LINE_RE.test(lastLine);
  }

  // Split an over-cap segment greedily at sentence boundaries to ~target.
  // A segment with no boundary at all comes back whole (caller warns).
  function sentencePieces(text, start, end, target) {
    var seg = text.slice(start, end);
    SENT_END_RE.lastIndex = 0;
    var bounds = [], m;
    while ((m = SENT_END_RE.exec(seg)) !== null) {
      var b = start + m.index + m[0].length;
      if (b < end) bounds.push(b);
    }
    var pieces = [], pieceStart = start, prev = null;
    for (var i = 0; i < bounds.length; i++) {
      var b = bounds[i];
      if (b - pieceStart > target) {
        var cut = (prev !== null && prev > pieceStart) ? prev : b;
        pieces.push([pieceStart, cut]);
        pieceStart = cut;
        prev = b > cut ? b : null;
      } else {
        prev = b;
      }
    }
    if (end - pieceStart > target && prev !== null && prev > pieceStart) {
      pieces.push([pieceStart, prev]);
      pieceStart = prev;
    }
    pieces.push([pieceStart, end]);
    return pieces;
  }

  // Greedy paragraph packing of ONE segment (between forced heading cuts).
  function packSegment(text, segStart, segEnd, target, warnings) {
    // Paragraph units end at the END of the blank-line run, so each chunk
    // starts at a paragraph start and the separator stays with the previous
    // chunk's tail (lossless).
    var units = [], pos = segStart, m;
    // Paragraph units end at the END of the blank-line run, so each chunk
    // starts at a paragraph start and the separator stays with the previous
    // chunk's tail (lossless).
    var seg = text.slice(segStart, segEnd);
    PARA_SEP_RE.lastIndex = 0;
    while ((m = PARA_SEP_RE.exec(seg)) !== null) {
      var sepEnd = segStart + m.index + m[0].length;
      if (sepEnd >= segEnd) break;
      units.push([pos, sepEnd]);
      pos = sepEnd;
    }
    if (pos < segEnd) units.push([pos, segEnd]);

    var pieces = [];
    for (var i = 0; i < units.length; i++) {
      var us = units[i][0], ue = units[i][1];
      if (ue - us > SENT_SPLIT_TRIGGER_CHARS) {
        var subs = sentencePieces(text, us, ue, target);
        for (var j = 0; j < subs.length; j++) {
          var ss = subs[j][0], se = subs[j][1];
          // A run with no sentence boundary at all is a blind spot for the
          // merge ratio check — warn above the trigger regardless of cap.
          if (se - ss > SENT_SPLIT_TRIGGER_CHARS && !new RegExp(SENT_END_RE.source).test(text.slice(ss, se))) {
            warnings.push('문장 경계로 쪼갤 수 없는 초장 구간 ' + (se - ss) + '자 (offset ' + ss + ') — 경고 기준(' + SENT_SPLIT_TRIGGER_CHARS + ') 초과 허용, 검토 요망');
          }
        }
        pieces = pieces.concat(subs);
      } else {
        pieces.push([us, ue]);
      }
    }

    var chunks = [], curStart = null, curEnd = 0;
    for (var k = 0; k < pieces.length; k++) {
      var ps = pieces[k][0], pe = pieces[k][1];
      if (curStart === null) { curStart = ps; curEnd = pe; continue; }
      var would = (curEnd - curStart) + (pe - ps);
      // Heading glue: while the current chunk ends with a heading, keep
      // appending regardless of size — a chunk must never END with a heading.
      if (would > target && !endsWithHeading(text, curStart, curEnd)) {
        chunks.push([curStart, curEnd]);
        curStart = ps; curEnd = pe;
      } else {
        curEnd = pe;
      }
    }
    if (curStart !== null) chunks.push([curStart, curEnd]);
    return chunks;
  }

  // Split `text` into lossless chunk spans. Deterministic, zero LLM calls.
  // Returns { chunks: [{start, end, passthrough}], warnings }.
  function computeChunkSpans(text, target, maxChunk, warnings) {
    warnings = warnings || [];
    if (!text) return { chunks: [], warnings: warnings };

    var fnStart = findFootnoteBlockStart(text);
    var bodyEnd = fnStart === null ? text.length : fnStart;

    var spans = [];
    if (bodyEnd > 0) {
      var body = text.slice(0, bodyEnd);
      // Forced cuts BEFORE heading lines — but suppressed when nothing
      // substantive has appeared since the last cut (contiguous heading
      // runs), so no chunk can end with a heading.
      var cuts = [0];
      var lines = lineSpans(body);
      for (var i = 0; i < lines.length; i++) {
        var ls = lines[i][0];
        if (ls === 0) continue;
        if (HEADING_LINE_RE.test(body.slice(ls, lines[i][1])) && hasSubstantive(body, cuts[cuts.length - 1], ls)) {
          cuts.push(ls);
        }
      }
      cuts.push(bodyEnd);
      for (var c = 0; c < cuts.length - 1; c++) {
        var packed = packSegment(body, cuts[c], cuts[c + 1], target, warnings);
        for (var p = 0; p < packed.length; p++) {
          spans.push({ start: packed[p][0], end: packed[p][1], passthrough: false });
        }
      }
    }
    if (fnStart !== null) {
      spans.push({ start: fnStart, end: text.length, passthrough: true });
    }

    // Post-checks: soft size cap / trailing heading (degenerate doc ending
    // in a heading with no body after it).
    for (var s = 0; s < spans.length; s++) {
      var sp = spans[s], size = sp.end - sp.start;
      if (!sp.passthrough && size > maxChunk) {
        warnings.push('청크 ' + (s + 1) + ' 크기 ' + size + '자 — 상한(' + maxChunk + ') 초과');
      }
      if (!sp.passthrough && endsWithHeading(text, sp.start, sp.end)) {
        warnings.push('청크 ' + (s + 1) + '가 헤딩으로 끝남 — 뒤따르는 본문이 없는 문서 말미 헤딩');
      }
    }

    // Top-level invariant self-check: any single-character mismatch is a
    // fidelity accident → abort.
    var joined = '';
    for (var t = 0; t < spans.length; t++) joined += text.slice(spans[t].start, spans[t].end);
    if (joined !== text) {
      throw ChunkingError('lossless self-check failed: 청크 연결 결과가 원문과 불일치 (원문 ' + text.length + '자, 연결 ' + joined.length + '자)');
    }
    return { chunks: spans, warnings: warnings };
  }

  // Upstream synthetic header sent with EVERY body chunk (not passthrough).
  function chunkHeader(index, total, startsWithHeading) {
    var lines = [
      '[청크 컨텍스트] 이 텍스트는 한 문서를 나눈 청크 ' + index + '/' + total + '이다.',
      '- 문서 전체가 아니므로 서두·결말·전환 문구를 새로 만들지 말 것. 경계가 잘린 듯 보여도 그대로 둔다.'
    ];
    if (startsWithHeading) {
      lines.push('- 첫 줄은 제목/헤딩이다. 번호·기호·형식을 그대로 보존하고 본문 문장과 병합하지 말 것.');
    }
    lines.push('');
    return lines.join('\n');
  }

  function clampInt(v, lo, hi, fallback) {
    var n = parseInt(v, 10);
    if (isNaN(n)) n = fallback;
    return Math.max(lo, Math.min(hi, n));
  }

  function firstNonEmptyLine(s) {
    var lines = s.split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim()) return lines[i];
    }
    return '';
  }

  /**
   * plan(text, opts?) → { recommended, reason|null, target, max, chunks, warnings }
   *   chunk: { index, total, start, end, text, passthrough, startsWithHeading, header }
   * The `header` is what the CALLER prepends to the user message (null for
   * passthrough chunks, which are never sent to the LLM).
   */
  function plan(text, opts) {
    opts = opts || {};
    if (typeof text !== 'string' || !text.trim()) {
      throw ChunkingError('청킹할 텍스트가 비어 있습니다.');
    }
    // Upstream warns against small chunks for big models (paragraph-spanning
    // signals like 대구·리듬) — the floor exists to make accidental misuse
    // loud, not to endorse small chunks.
    var target = clampInt(opts.target, MIN_OVERRIDE_CHARS, 50000, TARGET_CHUNK_CHARS);
    var max = clampInt(opts.max, target, 100000, Math.max(MAX_CHUNK_CHARS, target));

    var warnings = [];
    var spans = computeChunkSpans(text, target, max, warnings).chunks;

    var bodyCount = 0;
    for (var i = 0; i < spans.length; i++) if (!spans[i].passthrough) bodyCount++;

    var recommended = text.length > CHUNK_RECOMMEND_MIN_CHARS && bodyCount >= 2;
    var reason = null;
    if (!recommended) {
      reason = text.length <= CHUNK_RECOMMEND_MIN_CHARS
        ? '입력 ' + text.length + '자 ≤ 청킹 권장 최소 ' + CHUNK_RECOMMEND_MIN_CHARS + '자 — 단일 콜 실증 범위'
        : '본문 청크 1개 — 분할 불필요';
    }

    var total = spans.length;
    var chunks = [];
    for (var j = 0; j < total; j++) {
      var sp = spans[j];
      var chunkText = text.slice(sp.start, sp.end);
      var startsWithHeading = HEADING_LINE_RE.test(firstNonEmptyLine(chunkText));
      chunks.push({
        index: j + 1,
        total: total,
        start: sp.start,
        end: sp.end,
        text: chunkText,
        passthrough: !!sp.passthrough,
        startsWithHeading: startsWithHeading,
        header: sp.passthrough ? null : chunkHeader(j + 1, total, startsWithHeading)
      });
    }
    return { recommended: recommended, reason: reason, target: target, max: max, chunks: chunks, warnings: warnings };
  }

  function leadingWs(s) { return s.slice(0, s.length - s.replace(/^\s+/, '').length); }
  function trailingWs(s) { var t = s.replace(/\s+$/, ''); return s.slice(t.length); }

  /**
   * merge(original, plan, parts) → { text, warnings, chunks }
   *   parts: rewritten texts for the BODY chunks only, in plan order —
   *   passthrough chunks (trailing footnotes) are taken from the original
   *   verbatim and skip the LLM entirely, so callers never place dummies
   *   for them. parts.length must equal the body-chunk count.
   *
   * Safety (upstream reassemble_chunks.py):
   *   - lossless re-verification of the plan against `original`
   *   - empty rewritten body → hard error (유실 사고)
   *   - whitespace restoration → round-trip identity holds
   *   - per-chunk char ratio: <0.5 유실 의심 / >2.0 증식 의심
   */
  function merge(original, planObj, parts) {
    var bodyCount = 0;
    for (var i = 0; i < planObj.chunks.length; i++) {
      if (!planObj.chunks[i].passthrough) bodyCount++;
    }
    if (!Array.isArray(parts) || parts.length !== bodyCount) {
      throw ChunkingError('윤문 결과 개수가 본문 청크 수와 다릅니다 (본문 ' + bodyCount + '개, 결과 ' + (parts && parts.length) + '개)');
    }
    var warnings = [], pieces = [], report = [], cursor = 0;
    for (var c = 0; c < planObj.chunks.length; c++) {
      var ch = planObj.chunks[c];
      var orig = original.slice(ch.start, ch.end);
      var idx = ch.index;
      if (ch.passthrough) {
        pieces.push(orig);
        report.push({ index: idx, passthrough: true, origChars: orig.length });
        continue;
      }
      var coreOrig = orig.trim();
      var coreNew = String(parts[cursor] == null ? '' : parts[cursor]).trim();
      cursor++;
      if (coreOrig && !coreNew) {
        throw ChunkingError('청크 ' + idx + ' 윤문 결과가 비어 있음 — 유실 사고');
      }
      if (!coreOrig) {
        pieces.push(orig);
        report.push({ index: idx, passthrough: false, origChars: 0, rewrittenChars: coreNew.length, ratio: 1 });
      } else {
        var piece = leadingWs(orig) + coreNew + trailingWs(orig);
        var ratio = coreNew.length / coreOrig.length;
        if (ratio < 0.5) {
          warnings.push('청크 ' + idx + ': 원문 ' + coreOrig.length + '자 → ' + coreNew.length + '자 (' + Math.round(ratio * 100) + '%) — 유실 의심');
        } else if (ratio > 2.0) {
          warnings.push('청크 ' + idx + ': 원문 ' + coreOrig.length + '자 → ' + coreNew.length + '자 (' + Math.round(ratio * 100) + '%) — 증식 의심');
        }
        pieces.push(piece);
        report.push({ index: idx, passthrough: false, origChars: coreOrig.length, rewrittenChars: coreNew.length, ratio: Math.round(ratio * 1000) / 1000 });
      }
    }
    // Merge-time lossless re-verification, mirroring the upstream guard: the
    // spans must still tile the original (plan was built for THIS text).
    var check = '';
    for (var k = 0; k < planObj.chunks.length; k++) {
      check += original.slice(planObj.chunks[k].start, planObj.chunks[k].end);
    }
    if (check !== original) {
      throw ChunkingError('청크 구간 연결이 원문과 불일치 — plan이 이 원문으로 만들어진 것이 아닙니다');
    }
    return { text: pieces.join(''), warnings: warnings, chunks: report };
  }

  window.HumanizeChunking = {
    plan: plan,
    merge: merge,
    chunkHeader: chunkHeader,
    constants: {
      RECOMMEND_MIN: CHUNK_RECOMMEND_MIN_CHARS,
      TARGET: TARGET_CHUNK_CHARS,
      MAX: MAX_CHUNK_CHARS,
      SENT_TRIGGER: SENT_SPLIT_TRIGGER_CHARS
    },
    ChunkingError: ChunkingError
  };
})();
