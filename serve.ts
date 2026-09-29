/*
 * Humanize server (TypeScript) — static files + CORS proxy + .env config.
 * Run with:  bun serve.ts   (or: node serve.ts on Node >= 22)
 *
 * - GET  /env-config          -> LLM config from .env (never returns the key itself)
 * - POST /env-save            -> writes settings-dialog edits into .env and applies
 *                                them in place (loopback + same-origin requests only)
 * - POST /proxy/<host>/<path> -> forwards to https://<host>/<path>; for Anthropic and
 *   Gemini targets the OpenAI-shaped browser request is translated to the provider's
 *   native protocol (Messages API / generateContent) and the response back, so the
 *   browser always speaks OpenAI chat/completions.
 *
 * Provider selection (co-newbiz llm.ts convention, preset mode):
 *   LLM_PROVIDER = zai | zai-coding | openai | anthropic | gemini | deepseek |
 *                  bigmodel | openai-compatible | custom | none
 *   LLM_API_KEY  -> key for the selected provider (its specific name works too)
 *   LLM_MODEL    -> model id
 *   LLM_BASE_URL -> optional; each preset has the provider's official default
 * Selecting a provider wires the default Base URL + key automatically. When
 * LLM_PROVIDER is unset, keys are matched per request host instead.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname);

// Port/host resolution — CLI args > environment > defaults:
//   bun serve.ts --port 3000 | -p 3000 | 3000        (positional also works)
//   PORT=3000 bun serve.ts                           (env)
//   --host 0.0.0.0 / HOST=0.0.0.0                    (default: 127.0.0.1)
const argv = process.argv.slice(2);
function argValue(flag: string): string | null {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
const PORT_RAW = argValue("--port") ?? argValue("-p") ?? process.env.PORT ?? argv.find((a) => /^\d+$/.test(a)) ?? "8765";
const PORT = Number(PORT_RAW);
const HOST = argValue("--host") ?? process.env.HOST ?? "127.0.0.1";
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`오류: 포트 값이 올바르지 않습니다 — "${PORT_RAW}" (1~65535 사이의 숫자를 넣으세요)`);
  process.exit(1);
}
const TIMEOUT_MS = 180_000;
const ENV_FILE = path.join(ROOT, ".env");

type Provider = "openai-compatible" | "anthropic" | "gemini";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".md": "text/markdown",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// ---------------------------------------------------------------------------
// .env
// ---------------------------------------------------------------------------

function loadEnv(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return env;
  for (const raw of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    if (key) env[key] = value;
  }
  return env;
}

function firstEnv(env: Record<string, string>, names: string[]): string {
  for (const n of names) {
    const v = (env[n] ?? "").trim();
    if (v) return v;
  }
  return "";
}

let ENV = loadEnv(ENV_FILE);
let ENV_PROVIDER = (firstEnv(ENV, ["LLM_PROVIDER"]) || "").toLowerCase();
let ENV_BASE_URL = firstEnv(ENV, ["LLM_BASE_URL"]);
let ENV_MODEL = firstEnv(ENV, ["LLM_MODEL"]);
// Global fallback key; provider-specific keys win for their own hosts.
let ENV_GLOBAL_KEY = firstEnv(ENV, ["LLM_API_KEY"]);

/** Re-read .env and re-resolve provider selection (used by /env-save). */
function reloadEnvState(): void {
  ENV = loadEnv(ENV_FILE);
  ENV_PROVIDER = (firstEnv(ENV, ["LLM_PROVIDER"]) || "").toLowerCase();
  ENV_BASE_URL = firstEnv(ENV, ["LLM_BASE_URL"]);
  ENV_MODEL = firstEnv(ENV, ["LLM_MODEL"]);
  ENV_GLOBAL_KEY = firstEnv(ENV, ["LLM_API_KEY"]);
  SELECTED = resolveSelected();
}

/** Rewrite .env, replacing the listed keys in place and appending missing
 *  ones. Comments and unrelated lines are preserved. */
function upsertEnvFile(updates: Record<string, string>): void {
  const lines = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf-8").split(/\r?\n/) : [];
  const pending: Record<string, string> = { ...updates };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
    if (!m || !(m[2] in pending)) continue;
    lines[i] = m[1] + m[2] + m[3] + pending[m[2]];
    delete pending[m[2]];
  }
  for (const key of Object.keys(pending)) {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push(key + "=" + pending[key]);
  }
  fs.writeFileSync(ENV_FILE, lines.join("\n"), "utf-8");
}

/** Protocol a Base URL implies, judged from host/path (api.anthropic.com or
 *  any …/anthropic path → anthropic). */
function protocolForBaseUrl(baseUrl: string): Provider | null {
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (/(^|\.)api\.anthropic\.com$/i.test(u.hostname) || /\/anthropic(\/|$)/i.test(u.pathname)) return "anthropic";
    if (/(^|\.)generativelanguage\.googleapis\.com$/i.test(u.hostname)) return "gemini";
    return "openai-compatible";
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

interface ProviderDef {
  hostRe: RegExp;
  provider: Provider;
  name: string;
  keyNames: string[];
}

const PROVIDER_DEFS: ProviderDef[] = [
  { hostRe: /(^|\.)api\.anthropic\.com$/i, provider: "anthropic", name: "Anthropic", keyNames: ["ANTHROPIC_API_KEY"] },
  { hostRe: /(^|\.)generativelanguage\.googleapis\.com$/i, provider: "gemini", name: "Google Gemini", keyNames: ["GEMINI_API_KEY", "GOOGLE_API_KEY"] },
  { hostRe: /(^|\.)api\.openai\.com$/i, provider: "openai-compatible", name: "OpenAI", keyNames: ["OPENAI_API_KEY"] },
  { hostRe: /(^|\.)api\.z\.ai$/i, provider: "openai-compatible", name: "Z.ai", keyNames: ["ZAI_API_KEY"] },
  { hostRe: /(^|\.)open\.bigmodel\.cn$/i, provider: "openai-compatible", name: "BigModel (GLM)", keyNames: ["ZAI_API_KEY"] },
  { hostRe: /(^|\.)api\.deepseek\.com$/i, provider: "openai-compatible", name: "DeepSeek", keyNames: ["DEEPSEEK_API_KEY"] },
];

function detectProviderDef(host: string): ProviderDef | null {
  for (const def of PROVIDER_DEFS) if (def.hostRe.test(host)) return def;
  return null;
}

function configuredProviders(): string[] {
  const names: string[] = [];
  if (ENV_GLOBAL_KEY) names.push("LLM_API_KEY");
  for (const def of PROVIDER_DEFS) if (firstEnv(ENV, def.keyNames)) names.push(def.name);
  return names;
}

/** .env key for a target host: provider-specific first, then LLM_API_KEY. */
function envKeyForHost(host: string): string {
  const def = detectProviderDef(host);
  if (def) {
    const specific = firstEnv(ENV, def.keyNames);
    if (specific) return specific;
  }
  return ENV_GLOBAL_KEY;
}

/** Forced provider from LLM_PROVIDER (anthropic/gemini), else host detection. */
function providerForTarget(host: string): Provider {
  if (ENV_PROVIDER === "anthropic" || ENV_PROVIDER === "gemini") return ENV_PROVIDER;
  const def = detectProviderDef(host);
  return def ? def.provider : "openai-compatible";
}

// ---------------------------------------------------------------------------
// LLM_PROVIDER preset mode — selecting a provider wires up its default Base
// URL and its key automatically, so a working .env is just three lines:
//   LLM_PROVIDER=anthropic / LLM_API_KEY=... / LLM_MODEL=...
// ---------------------------------------------------------------------------

interface ProviderPreset {
  protocol: Provider;
  defaultBase: string;
  keyNames: string[];
  label: string;
}

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  // ── 일반 공급자 (4종) ──────────────────────────────────────────────
  "openai-compatible": { protocol: "openai-compatible", defaultBase: "https://api.openai.com/v1", keyNames: ["LLM_API_KEY", "OPENAI_API_KEY"], label: "OpenAI 호환" },
  "anthropic": { protocol: "anthropic", defaultBase: "https://api.anthropic.com", keyNames: ["LLM_API_KEY", "ANTHROPIC_API_KEY"], label: "Anthropic" },
  "gemini": { protocol: "gemini", defaultBase: "https://generativelanguage.googleapis.com/v1beta", keyNames: ["LLM_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"], label: "Google Gemini" },
  "custom": { protocol: "openai-compatible", defaultBase: "", keyNames: ["LLM_API_KEY"], label: "Custom" },
  // ── 편의 프리셋 (공급자 공식 주소를 한 번에) ─────────────────────────
  "zai": { protocol: "openai-compatible", defaultBase: "https://api.z.ai/api/paas/v4", keyNames: ["ZAI_API_KEY", "LLM_API_KEY"], label: "Z.ai" },
  "zai-coding": { protocol: "openai-compatible", defaultBase: "https://api.z.ai/api/coding/paas/v4", keyNames: ["ZAI_API_KEY", "LLM_API_KEY"], label: "Z.ai 코딩 플랜" },
  "openai": { protocol: "openai-compatible", defaultBase: "https://api.openai.com/v1", keyNames: ["OPENAI_API_KEY", "LLM_API_KEY"], label: "OpenAI" },
  "deepseek": { protocol: "openai-compatible", defaultBase: "https://api.deepseek.com", keyNames: ["DEEPSEEK_API_KEY", "LLM_API_KEY"], label: "DeepSeek" },
  "bigmodel": { protocol: "openai-compatible", defaultBase: "https://open.bigmodel.cn/api/paas/v4", keyNames: ["ZAI_API_KEY", "LLM_API_KEY"], label: "BigModel (GLM)" },
};

/**
 * Resolved selection. In "preset" mode the key and Base URL come from the
 * selected provider (LLM_BASE_URL may still override the Base URL); "none"
 * disables server-side key injection entirely (browser keys only); when
 * LLM_PROVIDER is unset, keys are matched per request host as before.
 */
type Selected = {
  mode: "preset" | "host" | "none";
  preset: ProviderPreset | null;
  key: string;
  base: string | null;
};

function resolveSelected(): Selected {
  const sel = ENV_PROVIDER;
  if (sel === "none") return { mode: "none", preset: null, key: "", base: null };
  const preset = sel ? PROVIDER_PRESETS[sel] : undefined;
  if (!preset) return { mode: "host", preset: null, key: "", base: null }; // unset or unknown → host detection
  return {
    mode: "preset",
    preset,
    key: firstEnv(ENV, [...preset.keyNames]),
    base: firstEnv(ENV, ["LLM_BASE_URL"]) || preset.defaultBase || null,
  };
}

let SELECTED: Selected = resolveSelected();

/** The key to inject for an outgoing request. */
function resolveEnvKey(host: string): string {
  if (SELECTED.mode === "preset") return SELECTED.key;
  if (SELECTED.mode === "none") return "";
  return envKeyForHost(host);
}

// ---------------------------------------------------------------------------
// OpenAI <-> native protocol translation (mirrors co-newbiz llm.ts)
// ---------------------------------------------------------------------------

interface OpenAiMessage {
  role: string;
  content: string;
}
interface OpenAiRequest {
  model?: string;
  messages?: OpenAiMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

function nativeTargetUrl(provider: Provider, target: URL, model: string): URL {
  const out = new URL(target.toString());
  // Drop the OpenAI verb the browser appended; the native path is rebuilt.
  out.pathname = out.pathname.replace(/\/chat\/completions\/?$/, "");
  if (provider === "anthropic") {
    if (!out.pathname.endsWith("/messages")) out.pathname = out.pathname.replace(/\/$/, "") + "/v1/messages";
  } else if (provider === "gemini") {
    out.pathname = out.pathname.replace(/\/$/, "") + "/models/" + encodeURIComponent(model) + ":generateContent";
  }
  return out;
}

function toNativeRequest(
  provider: Provider,
  target: URL,
  openai: OpenAiRequest,
  apiKey: string,
): { url: URL; headers: Record<string, string>; body: Record<string, unknown> } {
  const model = openai.model || "";
  const url = nativeTargetUrl(provider, target, model);
  const messages = openai.messages ?? [];
  if (provider === "anthropic") {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    // GLM (Z.ai) reasons by default, and its thinking can burn the whole
    // output budget before any text is written — polish requests came back
    // with empty content and stop_reason "max_tokens". Keep thinking off
    // (real Anthropic defaults to off as well) and scale the cap with the
    // input so long texts leave room for the polished output.
    const inputChars = messages.reduce((n, m) => n + m.content.length, 0);
    return {
      url,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model,
        max_tokens: openai.max_tokens ?? Math.min(131072, Math.max(8192, inputChars * 2)), // glm-5.3 output cap is 131072
        temperature: openai.temperature,
        thinking: { type: "disabled" },
        system: system || undefined,
        messages: messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
      },
    };
  }
  // gemini — key travels in the x-goog-api-key header, never the URL.
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  return {
    url,
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: {
      contents: messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: {
        temperature: openai.temperature,
        maxOutputTokens: openai.max_tokens ?? 8192,
      },
    },
  };
}

/** Wrap a native (anthropic/gemini) success body into an OpenAI chat shape. */
function fromNativeResponse(provider: Provider, json: Record<string, any>): Record<string, any> {
  let text = "";
  let finish = "stop";
  if (provider === "anthropic") {
    const content = json.content;
    if (Array.isArray(content)) text = content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("");
    finish = json.stop_reason === "max_tokens" ? "length" : "stop";
  } else {
    const parts = json.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) text = parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
    finish = json.candidates?.[0]?.finishReason === "MAX_TOKENS" ? "length" : "stop";
  }
  return { choices: [{ message: { role: "assistant", content: text }, finish_reason: finish }] };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function cors(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function sendJson(res: http.ServerResponse, status: number, obj: unknown): void {
  const data = Buffer.from(JSON.stringify(obj), "utf-8");
  cors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", String(data.length));
  res.end(data);
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, status, { proxy_error: message });
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Core forwarder: POST an OpenAI chat/completions request to `chatUrl`.
 * Anthropic/Gemini hosts get the request translated to their native protocol
 * (and the response back to OpenAI shape). Auth: the browser's Authorization
 * header wins; otherwise the .env key for that host is injected.
 */
async function forwardChat(req: http.IncomingMessage, res: http.ServerResponse, chatUrl: URL, browserAuth?: string): Promise<void> {
  const host = chatUrl.host;

  // Provider: explicit LLM_PROVIDER (anthropic/gemini) wins, else host detection.
  const provider = providerForTarget(host);
  const rawBody = await readBody(req);

  const headers: Record<string, string> = {
    "Content-Type": req.headers["content-type"] ?? "application/json",
    Accept: "application/json",
  };
  let openaiBody: OpenAiRequest = {};
  try {
    openaiBody = JSON.parse(rawBody.toString("utf-8") || "{}");
  } catch {
    openaiBody = {};
  }

  let requestUrl = chatUrl.toString();
  let requestBody = rawBody;

  if (provider === "anthropic" || provider === "gemini") {
    // Native protocol: rebuild URL/headers/body from the OpenAI-shaped request.
    const envKey = resolveEnvKey(host);
    const apiKey = browserAuth ? browserAuth.replace(/^Bearer\s+/i, "") : envKey;
    if (!apiKey) {
      sendError(res, 502, `no API key available for ${host} (set its key in .env or send Authorization)`);
      return;
    }
    const native = toNativeRequest(provider, chatUrl, openaiBody, apiKey);
    requestUrl = native.url.toString();
    Object.assign(headers, native.headers);
    delete headers["Authorization"];
    requestBody = Buffer.from(JSON.stringify(native.body), "utf-8");
  } else {
    if (browserAuth) headers["Authorization"] = browserAuth;
    else {
      const envKey = resolveEnvKey(host);
      if (envKey) headers["Authorization"] = "Bearer " + envKey;
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(requestUrl, {
      method: "POST",
      headers,
      body: requestBody,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    sendError(res, 502, String((e as Error)?.message ?? e));
    return;
  }

  const text = await upstream.text();
  const ctype = upstream.headers.get("content-type") ?? "application/json";
  if ((provider === "anthropic" || provider === "gemini") && ctype.includes("json")) {
    try {
      const json = JSON.parse(text) as Record<string, any>;
      if (!json.choices && !json.error) {
        sendJson(res, upstream.status, fromNativeResponse(provider, json));
        return;
      }
    } catch {
      /* fall through with the raw body */
    }
  }
  const data = Buffer.from(text, "utf-8");
  cors(res);
  res.statusCode = upstream.status;
  res.setHeader("Content-Type", ctype + "; charset=utf-8");
  res.setHeader("Content-Length", String(data.length));
  res.end(data);
}

/** POST /proxy/<host>/<path> — generic passthrough; the path is kept as-is. */
async function proxyPost(req: http.IncomingMessage, res: http.ServerResponse, targetPath: string): Promise<void> {
  const rest = targetPath.slice("/proxy/".length);
  const firstSeg = rest.split("/")[0] ?? "";
  const scheme = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(firstSeg) ? "http" : "https";
  const target = new URL(scheme + "://" + rest);
  await forwardChat(req, res, target, req.headers["authorization"]);
}

/**
 * POST /llm/chat/completions with `X-Target-URL: <provider Base URL>`.
 * Lets the browser configure the provider's OFFICIAL Base URL verbatim —
 * the local server performs the actual call (CORS) and appends
 * /chat/completions to the target base itself.
 */
async function llmPost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const base = String(req.headers["x-target-url"] ?? "").trim().replace(/\/+$/, "");
  if (!base) {
    sendError(res, 400, "X-Target-URL 헤더에 공급자 Base URL이 필요합니다 (예: https://api.z.ai/api/coding/paas/v4)");
    return;
  }
  let target: URL;
  try {
    target = new URL(base);
  } catch {
    sendError(res, 400, "잘못된 X-Target-URL: " + base);
    return;
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    sendError(res, 400, "X-Target-URL은 http/https여야 합니다: " + base);
    return;
  }
  const chatUrl = new URL(target.toString().replace(/\/+$/, "") + "/chat/completions");
  await forwardChat(req, res, chatUrl, req.headers["authorization"]);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      cors(res);
      res.statusCode = 204;
      res.end();
      return;
    }
    const pathName = (req.url ?? "/").split("?")[0];

    if (req.method === "GET" && pathName === "/env-config") {
      // The key value itself never leaves the server.
      const presetMode = SELECTED.mode === "preset" && SELECTED.preset;
      const resolvedBase =
        SELECTED.mode === "none" ? null : ENV_BASE_URL || (SELECTED.mode === "preset" ? SELECTED.base : null) || null;
      const keyConfigured =
        SELECTED.mode === "none"
          ? false
          : Boolean(SELECTED.key || ENV_GLOBAL_KEY || configuredProviders().length);
      sendJson(res, 200, {
        keyConfigured,
        provider: presetMode
          ? SELECTED.preset!.label
          : SELECTED.mode === "none"
            ? "none"
            : ENV_PROVIDER || "(호스트 자동 감지)",
        providers: configuredProviders(),
        ...(resolvedBase ? { baseUrl: resolvedBase } : {}),
        ...(ENV_MODEL ? { model: ENV_MODEL } : {}),
      });
      return;
    }

    if (req.method === "POST" && pathName === "/llm/chat/completions") {
      await llmPost(req, res);
      return;
    }

    if (req.method === "POST" && pathName === "/env-save") {
      // Writes settings-dialog edits into .env and applies them without a
      // restart. Guarded twice: loopback peers only, and a browser Origin
      // (present on every browser POST) must be this server — a drive-by POST
      // from some website must not plant its own Base URL here and harvest
      // the injected key on the next request.
      const remote = req.socket.remoteAddress ?? "";
      const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
      const origin = req.headers.origin;
      const sameOrigin =
        !origin || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
      if (!loopback) {
        sendError(res, 403, "env-save는 로컬(127.0.0.1) 연결에서만 허용됩니다.");
        return;
      }
      if (!sameOrigin) {
        sendError(res, 403, "env-save는 같은 출처(Origin)에서만 호출할 수 있습니다.");
        return;
      }
      let body: { baseUrl?: string; model?: string; apiKey?: string } = {};
      try {
        body = JSON.parse((await readBody(req)).toString("utf-8") || "{}");
      } catch {
        /* treated as empty — nothing to save */
      }
      const updates: Record<string, string> = {};
      const baseUrl = (body.baseUrl ?? "").trim();
      if (baseUrl) {
        const protocol = protocolForBaseUrl(baseUrl);
        if (!protocol) {
          sendError(res, 400, "올바른 http(s) Base URL이 아닙니다: " + baseUrl);
          return;
        }
        updates.LLM_BASE_URL = baseUrl;
        // Keep the protocol switch coherent: LLM_PROVIDER=anthropic with an
        // OpenAI-style Base URL (or the reverse) would translate requests to
        // the wrong wire format.
        if (SELECTED.mode === "preset" && SELECTED.preset && SELECTED.preset.protocol !== protocol) {
          updates.LLM_PROVIDER = protocol;
        }
      }
      const model = (body.model ?? "").trim();
      if (model) updates.LLM_MODEL = model;
      // An empty key field means "keep the existing key" — never clear it here.
      const apiKey = (body.apiKey ?? "").trim();
      if (apiKey) updates.LLM_API_KEY = apiKey;
      if (Object.keys(updates).length === 0) {
        sendJson(res, 200, { ok: true, applied: [] });
        return;
      }
      try {
        upsertEnvFile(updates);
      } catch (e) {
        sendError(res, 500, ".env 파일을 쓰지 못했습니다: " + String((e as Error)?.message ?? e));
        return;
      }
      reloadEnvState();
      console.log(`.env 갱신: ${Object.keys(updates).join(", ")}`);
      sendJson(res, 200, {
        ok: true,
        applied: Object.keys(updates),
        baseUrl: ENV_BASE_URL || null,
        model: ENV_MODEL || null,
        keyConfigured: Boolean(SELECTED.key || ENV_GLOBAL_KEY || configuredProviders().length),
      });
      return;
    }

    if (req.method === "POST" && pathName.startsWith("/proxy/")) {
      await proxyPost(req, res, pathName);
      return;
    }

    if (req.method === "GET") {
      let rel = pathName === "/" ? "/index.html" : pathName;
      const fp = path.normalize(path.join(ROOT, rel.replace(/^\//, "")));
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
        res.writeHead(404);
        res.end();
        return;
      }
      const data = fs.readFileSync(fp);
      const ctype = CONTENT_TYPES[path.extname(fp)] ?? "application/octet-stream";
      cors(res);
      res.statusCode = 200;
      res.setHeader("Content-Type", ctype + "; charset=utf-8");
      res.setHeader("Content-Length", String(data.length));
      res.end(data);
      return;
    }

    res.statusCode = 404;
    res.end();
  } catch (e) {
    if (!res.headersSent) sendError(res, 500, String((e as Error)?.message ?? e));
    else res.end();
  }
});

server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.log(`오류: 포트 ${PORT}가 이미 사용 중입니다. 기존 서버(serve.ts·http.server 등)를 먼저 종료하세요:`);
    console.log(`    lsof -nP -iTCP:${PORT} -sTCP:LISTEN   # 프로세스 확인`);
    console.log("    kill <PID>                            # 종료 후 다시 실행");
    console.log("다른 포트로 실행:  bun serve.ts --port 3000   (또는 PORT=3000 bun serve.ts)");
    process.exit(1);
  }
  console.error("server error:", e.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Humanize: http://localhost:${PORT}  (CORS proxy: /proxy/<host>/<path>)`);
  const provs = configuredProviders();
  let selDesc: string;
  if (SELECTED.mode === "preset" && SELECTED.preset) {
    selDesc = `${SELECTED.preset.label}${SELECTED.key ? "" : " (키 없음!)"} | base: ${SELECTED.base ?? "(미설정 — custom은 LLM_BASE_URL 필수)"}`;
    if (SELECTED.preset.label === "Custom" && !SELECTED.base) {
      console.log("경고: LLM_PROVIDER=custom 인데 LLM_BASE_URL이 없습니다. 쓰려는 엔드포인트의 API 루트를 설정하세요.");
    }
  } else if (SELECTED.mode === "none") {
    selDesc = "none — 서버 키 주입 비활성 (브라우저에 저장한 키만 사용)";
  } else {
    selDesc = "공급자 미선택 — Base URL 호스트로 키를 자동 감지합니다";
  }
  console.log(
    ".env: " +
      (provs.length ? `keys [${provs.join(", ")}]` : "no API key") +
      ` | 선택: ${selDesc}` +
      (ENV_MODEL ? ` | model: ${ENV_MODEL}` : ""),
  );
});
