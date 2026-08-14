/**
 * What happens to a source before a provider ever sees it (Phase 6T/6U/6X/6W).
 *
 * Three jobs, all deterministic and all testable without a model:
 *
 *   1. **Chunk** on boundaries that mean something — a speaker turn, a
 *      heading, a fenced code block — never mid-sentence, and never silently.
 *   2. **Keep line numbers true.** Every chunk carries its offset in the whole
 *      source, so `L120-L145` in chunk 3 means line 120 of the original and not
 *      line 120 of the slice. A provenance anchor that resolves to the wrong
 *      place is worse than none.
 *   3. **Look for credentials** before anything leaves the machine, and warn.
 *      Never alter the stored original.
 */

/** A model call is bounded so one paste cannot become an unbounded request. */
export const MAX_SOURCE_CHARACTERS = 400_000;
/** Roughly 12k tokens at the documented 3.7 chars/token, well inside any window. */
export const CHUNK_TARGET_CHARACTERS = 45_000;

export interface SourceChunk {
  index: number;
  /** 1-based line number of this chunk's first line within the whole source. */
  lineOffset: number;
  text: string;
}

/**
 * Splits on the most meaningful boundary available.
 *
 * Preference order: a speaker turn, then a Markdown heading, then a blank line.
 * A fenced code block is never split — a prompt body cut in half stops being
 * the prompt, and 6M requires it verbatim.
 */
export function chunkSource(
  source: string,
  target = CHUNK_TARGET_CHARACTERS,
): SourceChunk[] {
  const lines = source.split('\n');
  if (source.length <= target) {
    return [{ index: 0, lineOffset: 1, text: source }];
  }

  const chunks: SourceChunk[] = [];
  let current: string[] = [];
  let startLine = 1;
  let inFence = false;

  const isTurn = (l: string) => /^\s*(user|human|assistant|claude|system)\s*:/i.test(l);
  const isHeading = (l: string) => /^#{1,6}\s/.test(l);

  const flush = (nextStart: number) => {
    if (current.length === 0) return;
    chunks.push({ index: chunks.length, lineOffset: startLine, text: current.join('\n') });
    current = [];
    startLine = nextStart;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^\s*```/.test(line)) inFence = !inFence;

    const size = current.reduce((n, l) => n + l.length + 1, 0);
    const boundary = !inFence && (isTurn(line) || isHeading(line) || line.trim() === '');
    if (size >= target && boundary) flush(i + 1);

    current.push(line);
  }
  flush(lines.length + 1);

  // A single logical unit larger than the target — one enormous code block —
  // stays whole. Splitting it would corrupt exactly the content chunking exists
  // to protect.
  return chunks.length > 0 ? chunks : [{ index: 0, lineOffset: 1, text: source }];
}

export interface SizeAssessment {
  characters: number;
  chunks: number;
  /** True when the source exceeds what one call may carry. */
  tooLarge: boolean;
  /** A sentence for the user, stating what will actually be processed. */
  message: string;
}

/**
 * Says what will happen, before it happens.
 *
 * Nothing is truncated silently. When a source is over the ceiling the
 * assessment says so and the caller refuses — the alternative, quietly
 * analysing the first 400,000 characters, would produce a review that looked
 * complete and was not.
 */
export function assessSource(source: string): SizeAssessment {
  const characters = source.length;
  if (characters > MAX_SOURCE_CHARACTERS) {
    return {
      characters,
      chunks: 0,
      tooLarge: true,
      message: `This source is ${characters.toLocaleString()} characters, over the ${MAX_SOURCE_CHARACTERS.toLocaleString()} limit for one analysis. Nothing has been sent. Split it, or file it manually — it will not be truncated behind your back.`,
    };
  }
  const chunks = chunkSource(source).length;
  return {
    characters,
    chunks,
    tooLarge: false,
    message:
      chunks === 1
        ? `${characters.toLocaleString()} characters will be analysed in one request.`
        : `${characters.toLocaleString()} characters will be analysed in ${chunks} requests, split on conversation turns and headings. Line references stay true to the original.`,
  };
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export interface SecretFinding {
  label: string;
  /** 1-based line in the whole source. */
  line: number;
  /** A few characters either side, with the secret itself masked. */
  excerpt: string;
}

/**
 * Patterns worth stopping a person for.
 *
 * This is a warning, not a filter, and the wording everywhere says so. Claiming
 * exhaustive secret detection would be the dangerous half of this feature:
 * someone would trust it and paste a credential it has never seen. The list is
 * the well-known shapes, and the message says "may contain".
 */
const PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'a private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'an AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'a GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/ },
  { label: 'a Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  // Anthropic first, and OpenAI's pattern excludes `ant-`: `sk-ant-…` matches
  // both shapes, and the loop stops at the first hit — so ordering alone was
  // enough to label an Anthropic key as OpenAI's. The warning is only useful
  // if it names the right thing.
  { label: 'an Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { label: 'an OpenAI key', re: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}\b/ },
  { label: 'a Supabase secret key', re: /\bsb_secret_[A-Za-z0-9_-]{10,}\b/ },
  { label: 'a ContextShelf ingestion token', re: /\bcs_live_[A-Za-z0-9_-]{20,}\b/ },
  { label: 'a JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { label: 'a bearer token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/i },
  {
    // No word boundaries: `_` is a word character, so `\bpassword\b` never
    // matched inside `DATABASE_PASSWORD=…` — which is the commonest shape of
    // all. Matching the substring catches prefixed and suffixed names too.
    label: 'a password or key assignment',
    re: /(password|passwd|secret|api[_-]?key|access[_-]?token|private[_-]?key)["']?\s*[:=]\s*["']?[^\s"']{8,}/i,
  },
];

const mask = (line: string): string =>
  line.length <= 24 ? '…' : `${line.slice(0, 12)}…${line.slice(-6)}`;

/**
 * Scans for credential shapes. Reads only; the stored source is never touched.
 */
export function findSecrets(source: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    for (const { label, re } of PATTERNS) {
      if (re.test(line)) {
        findings.push({ label, line: i + 1, excerpt: mask(line.trim()) });
        break; // one finding per line is enough to make the point
      }
    }
    if (findings.length >= 20) break;
  }
  return findings;
}

/** The sentence shown before sending. Deliberately not a promise. */
export function secretWarning(findings: SecretFinding[]): string | null {
  if (findings.length === 0) return null;
  const kinds = [...new Set(findings.map((f) => f.label))];
  return `This content may contain credentials — ${kinds.join(', ')} on ${
    findings.length === 1 ? `line ${findings[0]!.line}` : `${findings.length} lines`
  }. Detection is pattern-based and is not exhaustive. Analysing sends the selected source to the configured provider; the stored original is never altered either way.`;
}
