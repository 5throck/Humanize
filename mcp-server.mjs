#!/usr/bin/env bun
/*
 * Humanize MCP server — zero-dependency Model Context Protocol over stdio.
 *
 * Exposes the deterministic Korean de-AI engine (rules.js + prompt.js +
 * chunking.js, loaded via lib/engine.mjs) as MCP tools. No LLM calls, no
 * network: chunk/merge give the HOST agent a lossless long-document
 * workflow it drives with its own model —
 *
 *   humanize_chunk(text)  → body chunks + per-chunk context headers
 *   (host rewrites each chunk with humanize_prompt's system prompt)
 *   humanize_merge(original, rewritten) → merged text + 유실/증식 validation
 *
 * Protocol: newline-delimited JSON-RPC 2.0 (MCP stdio transport), methods
 * initialize / notifications / ping / tools/list / tools/call. Everything
 * the server logs goes to stderr — stdout carries protocol frames only.
 *
 * Register (Claude Code):  claude mcp add humanize -- bun mcp-server.mjs
 * Generic stdio config:    { "command": "bun", "args": ["mcp-server.mjs"] }
 */
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { loadEngine } from './lib/engine.mjs';

const SERVER_INFO = { name: 'humanize', version: '1.0.0' };
// Mirrors app.js MAX_CHARS — the UI cannot send more either.
const MAX_CHARS = 30000;
// chunk/merge exist FOR long documents; a bigger ceiling is the point.
const MAX_CHUNK_CHARS = 200000;

const engine = loadEngine();

const textSchema = (description) => ({
  type: 'object',
  properties: { text: { type: 'string', description } },
  required: ['text'],
});

const TOOLS = [
  {
    name: 'humanize_analyze',
    description: '한국어 텍스트에서 AI 티 패턴(A~J, 47개 규칙)을 감지한다. LLM 호출 없음.',
    inputSchema: textSchema('분석할 한국어 텍스트 (최대 30,000자)'),
  },
  {
    name: 'humanize_polish',
    description: '한국어 텍스트의 AI 티를 규칙 기반으로 제거한다(자동 치환 가능한 규칙만). 결과에 적용 규칙·변경률·등급이 함께 온다. 문맥 수술이 필요한 감지 전용 패턴은 humanize_prompt 도구의 시스템 프롬프트로 처리한다.',
    inputSchema: textSchema('윤문할 한국어 텍스트 (최대 30,000자)'),
  },
  {
    name: 'humanize_prompt',
    description: 'LLM 모드용 시스템 프롬프트(원본 humanize-monolith 계열)를 반환한다. 장르별 5종(auto/column/report/blog/formal). 장문일 때는 humanize_chunk로 나눠 청크마다 이 프롬프트를 시스템으로 쓴다.',
    inputSchema: {
      type: 'object',
      properties: { genre: { type: 'string', enum: ['auto', 'column', 'report', 'blog', 'formal'], description: '글 장르 (기본 auto)' } },
    },
  },
  {
    name: 'humanize_chunk',
    description: '긴 문서를 손실 없는 청크로 나눈다(15,000자 이상 권장, 목표 7,000자). 각 청크에 LLM 앞에 붙일 [청크 컨텍스트] 헤더가 포함된다. passthrough 청크(말미 각주 블록)는 재작성 없이 humanize_merge에 그대로 두면 된다.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '분할할 한국어 문서 (최대 200,000자)' },
        target: { type: 'number', description: '청크 목표 문자 수 (기본 7000, 하한 2000 — 작게 만들면 문단 횡단 신호를 잃는다)' },
        max: { type: 'number', description: '청크 상한 문자 수 (기본 9000)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'humanize_merge',
    description: 'humanize_chunk로 나눈 문서의 청크별 윤문 결과를 병합·검증한다. rewritten는 본문 청크 순서(passthrough 제외)의 배열. 원문 절반 이하(유실 의심)·2배 초과(증식 의심) 청크를 경고로 알리고, 빈 결과는 오류로 중단한다.',
    inputSchema: {
      type: 'object',
      properties: {
        original: { type: 'string', description: 'humanize_chunk에 넣었던 원문' },
        rewritten: { type: 'array', items: { type: 'string' }, description: '본문 청크 순서의 윤문 결과' },
        target: { type: 'number', description: 'chunk 호출 때 쓴 target과 같은 값 (경계 재현용)' },
        max: { type: 'number', description: 'chunk 호출 때 쓴 max와 같은 값' },
      },
      required: ['original', 'rewritten'],
    },
  },
];

class ToolError extends Error {}

function requireText(v, cap, label = 'text') {
  if (typeof v !== 'string' || !v.trim()) throw new ToolError(`"${label}"(비어 있지 않은 문자열)가 필요합니다.`);
  if (v.length > cap) {
    throw new ToolError(`${label}가 ${cap.toLocaleString('ko-KR')}자를 초과합니다 (현재 ${v.length.toLocaleString('ko-KR')}자).`);
  }
  return v;
}

function chunkOpts(args) {
  const opts = {};
  if (args.target !== undefined) {
    if (typeof args.target !== 'number') throw new ToolError('"target"은 숫자여야 합니다.');
    opts.target = args.target;
  }
  if (args.max !== undefined) {
    if (typeof args.max !== 'number') throw new ToolError('"max"는 숫자여야 합니다.');
    opts.max = args.max;
  }
  return opts;
}

const TOOL_HANDLERS = {
  humanize_analyze(args) {
    return engine.Rules.analyze(requireText(args.text, MAX_CHARS));
  },
  humanize_polish(args) {
    const text = requireText(args.text, MAX_CHARS);
    const before = engine.Rules.analyze(text);
    const pol = engine.Rules.polish(text);
    const after = engine.Rules.analyze(pol.text);
    const rate = engine.Rules.changeRate(text, pol.text);
    return {
      text: pol.text,
      applied: pol.applied,
      before,
      after,
      changeRate: rate,
      grade: engine.Rules.grade(after, rate),
    };
  },
  humanize_prompt(args) {
    const genre = args.genre ?? 'auto';
    const allowed = ['auto', 'column', 'report', 'blog', 'formal'];
    if (typeof genre !== 'string' || !allowed.includes(genre)) {
      throw new ToolError(`"genre"는 ${allowed.join('|')} 중 하나여야 합니다.`);
    }
    return { genre, system: engine.Prompt.system(genre) };
  },
  humanize_chunk(args) {
    const text = requireText(args.text, MAX_CHUNK_CHARS);
    return engine.Chunking.plan(text, chunkOpts(args));
  },
  humanize_merge(args) {
    const original = requireText(args.original, MAX_CHUNK_CHARS, 'original');
    if (!Array.isArray(args.rewritten)) throw new ToolError('"rewritten"(본문 청크 순서의 배열)이 필요합니다.');
    // Deterministic plan → recomputation reproduces the caller's chunk
    // order; merge() re-verifies losslessness against the original anyway.
    const plan = engine.Chunking.plan(original, chunkOpts(args));
    const merged = engine.Chunking.merge(original, plan, args.rewritten);
    const after = engine.Rules.analyze(merged.text);
    const rate = engine.Rules.changeRate(original, merged.text);
    return {
      text: merged.text,
      warnings: merged.warnings,
      chunks: merged.chunks,
      after,
      changeRate: rate,
      grade: engine.Rules.grade(after, rate),
    };
  },
};

/** Handle one JSON-RPC message. Returns a response object, or null for
 *  notifications / anything that must stay silent. */
export function handleMessage(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  }
  const isNotification = msg.id === undefined || msg.id === null;
  try {
    switch (msg.method) {
      case 'initialize':
        // Echo the client's negotiated protocol version; the tools-only
        // surface we expose is stable across recent spec versions.
        return {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: String(msg.params?.protocolVersion ?? '2025-06-18'),
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        };
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null;
      case 'ping':
        return { jsonrpc: '2.0', id: msg.id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } };
      case 'tools/call': {
        const name = msg.params?.name;
        const handler = TOOL_HANDLERS[name];
        if (!handler) {
          return {
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32602, message: `알 수 없는 도구: ${name}` },
          };
        }
        try {
          const result = handler(msg.params?.arguments ?? {});
          return {
            jsonrpc: '2.0',
            id: msg.id,
            result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
          };
        } catch (e) {
          // Domain errors (유실 사고, oversized text, …) are tool RESULTS
          // with isError, not protocol errors — the host shows them to the
          // model as feedback.
          return {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              content: [{ type: 'text', text: String((e instanceof Error ? e : undefined)?.message ?? e) }],
              isError: true,
            },
          };
        }
      }
      default:
        if (isNotification) return null;
        return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
    }
  } catch (e) {
    if (isNotification) return null;
    return { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String((e instanceof Error ? e : undefined)?.message ?? e) } };
  }
}

// Direct execution only (`bun mcp-server.mjs`); importing for tests must
// not start a readline loop.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  process.stderr.write(`humanize mcp-server: tools ${TOOLS.map((t) => t.name).join(', ')}\n`);
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
      return;
    }
    const out = handleMessage(msg);
    if (out) process.stdout.write(JSON.stringify(out) + '\n');
  });
  rl.on('close', () => process.exit(0));
}
