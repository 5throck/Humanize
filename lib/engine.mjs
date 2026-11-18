// Shared loader for the engine modules in engine/ (rules.js, prompt.js,
// chunking.js, lexicon-data.js, lexicon.js, fidelity.js). They are plain
// IIFEs that attach to `window`, so a bare sandbox object is enough to
// reuse them verbatim under Bun — same trick test.mjs uses. No build step,
// no duplicated rule source.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadEngine() {
  const sandbox = { window: {} };
  for (const file of ['rules.js', 'prompt.js', 'chunking.js', 'lexicon-data.js', 'lexicon.js', 'fidelity.js']) {
    const src = readFileSync(join(ROOT, 'engine', file), 'utf8');
    new Function('window', src)(sandbox.window);
  }
  const { HumanizeRules: Rules, HumanizePrompt: Prompt, HumanizeChunking: Chunking, HumanizeLexicon: Lexicon, HumanizeFidelity: Fidelity } = sandbox.window;
  if (!Rules || !Prompt || !Chunking || !Lexicon || !Fidelity) {
    throw new Error('엔진 로딩 실패 — engine/의 rules.js·prompt.js·chunking.js·lexicon*.js·fidelity.js를 확인하세요.');
  }
  return { Rules, Prompt, Chunking, Lexicon, Fidelity };
}
