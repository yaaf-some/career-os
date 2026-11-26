/**
 * posting-guard.mjs — Integrity gate for fetched job postings.
 *
 * Pure, zero-dependency module ported from career-ops `posting-guard.mjs`
 * (originally MIT ported from MadsLorentzen/ai-job-search `tools/posting_guard.py`).
 *
 * Exports `guardPosting(text, mode?)` returning `{ cleanText, flags, integrity }`.
 */

// ---------------------------------------------------------------------------
// Unicode inventories
// ---------------------------------------------------------------------------

const TAG_CHARS = [...Array(0xE0080 - 0xE0000).keys()]
  .map((i) => String.fromCodePoint(0xe0000 + i))
  .join('');
const ZERO_WIDTH = '\u200B\u200C\u200D\u2060\u2061\u2062\u2063\u2064';
const BIDI = '\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069';
const BIDI_TAMPER = '\u202D\u202E\u2066\u2067\u2068\u2069'; // overrides + isolates
const FORMAT = '\u00AD\u2028\u2029'; // soft hyphen, line/paragraph separators
const BOM = '\uFEFF';

// The one legitimate use of tag characters: black flag + gb(eng|sct|wls) + cancel.
const FLAG_EMOJI_RE = /\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}/gu;

// ---------------------------------------------------------------------------
// Hidden-HTML detection
// ---------------------------------------------------------------------------

const VOID_TAGS = new Set([
  'br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col',
  'embed', 'source', 'track', 'wbr',
]);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'template']);
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'td',
  'th', 'tr', 'ul',
]);

const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X'
        ? parseInt(e.slice(2), 16)
        : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITY_MAP[e.toLowerCase()] ?? m;
  });
}

function styleHidden(style) {
  if (!style) return null;
  const s = decodeEntities(style).toLowerCase();
  if (/display\s*:\s*none/.test(s)) return 'display:none';
  if (/visibility\s*:\s*hidden/.test(s)) return 'visibility:hidden';
  if (/(^|[^-])opacity\s*:\s*0(\.0*)?\s*(;|$)/.test(s)) return 'opacity:0';
  if (/font-size\s*:\s*0(\.0+)?\s*(px|pt|em|rem)?\s*(;|$)/.test(s)) return 'font-size:0';
  if (/color\s*:\s*transparent/.test(s)) return 'color:transparent';
  if (/(clip|clip-path)\s*:\s*(inset\(100|circle\(0|rect\(0)/.test(s)) return 'clipped';
  if (/left\s*:\s*-\d{3,}px/.test(s) || /text-indent\s*:\s*-\d{3,}px/.test(s)) return 'off-canvas';
  if (/overflow\s*:\s*hidden/.test(s) && /(height|width|line-height)\s*:\s*0(\.0*)?(px|;|$)/.test(s)) {
    return 'zero-box + overflow:hidden';
  }
  return null;
}

const ATTR_RE = /([a-zA-Z_:][-\w:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;

function attrsHidden(attrs) {
  let hiddenAttr = false;
  let style = null;
  let ariaHidden = false;
  for (const m of attrs.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    const value = m[3] ?? m[4] ?? m[5] ?? '';
    if (name === 'hidden') hiddenAttr = true;
    else if (name === 'style') style = value;
    else if (name === 'aria-hidden' && value.trim().toLowerCase() === 'true') ariaHidden = true;
  }
  if (!hiddenAttr) {
    const bare = attrs.replace(ATTR_RE, ' ').toLowerCase();
    hiddenAttr = /(^|[\s"'/])hidden(?=[\s/>]|$)/.test(bare + ' ');
  }
  if (hiddenAttr) return 'hidden attribute';
  if (ariaHidden) return 'aria-hidden=true';
  if (style) return styleHidden(style);
  return null;
}

// ---------------------------------------------------------------------------
// Instruction-shaped lines (quoted, NEVER removed)
// ---------------------------------------------------------------------------

const INSTRUCTION_PATTERNS = [
  { re: /\bignore\b[^.\n]{0,40}\b(previous|prior|above|earlier)\b.*/i, label: 'ignore-prior-instructions' },
  { re: /\b(disregard|forget)\s+(all\s+)?(previous|prior|above|earlier|your)\b[^.\n]*/i, label: 'disregard-instructions' },
  { re: /\byou\s+are\b[^.\n]{0,50}\b(ai|assistant|llm|agent|model|chatbot)\b.*/i, label: 'you-are-an-AI' },
  { re: /\bas\s+an?\s+(ai|assistant|llm|language model)\b.*/i, label: 'as-an-AI' },
  { re: /^\s*(system|assistant)\s*[:\uFF1A]/i, label: 'fake-role-marker' },
  { re: /\b(do not|don't|dont)\b[^.\n]{0,25}\b(follow|obey|execute|reveal|disclose|summarize|summarise)\b/i, label: 'negative-instruction' },
  { re: /\bfollow\s+the\s+(instructions?|commands?)\s+(in|below|above|from)\b.*/i, label: 'follow-embedded-instructions' },
  { re: /\b(print|output|repeat|reveal)\b[^.\n]{0,30}\b(system\s*prompt|your\s+instructions?|the\s+instructions?)\b/i, label: 'prompt-exfil' },
  { re: /\b(?:api[_\s-]?(?:key|token)|secret|password|credentials)\b[^.\n]{0,40}\b(?:send|provide|enter|submit|share)\b|\b(?:send|provide|enter|submit|share)\b[^.\n]{0,40}\b(?:api[_\s-]?(?:key|token)|secret|password|credentials)\b/i, label: 'credential-harvest' },
  { re: /\b(call|invoke|run|execute)\b[^.\n]{0,40}\b(shell|terminal|command|rm\s+-rf|curl|wget)\b/i, label: 'command-injection' },
];

// ---------------------------------------------------------------------------
// Mixed-script look-alike words
// ---------------------------------------------------------------------------

const SCRIPT_RANGES = {
  cyrillic: /[\u0400-\u04FF]/,
  greek: /[\u0370-\u03FF]/,
  latin: /[A-Za-z\u00C0-\u024F]/,
};

function mixedScriptWords(text) {
  const found = [];
  const seen = new Set();
  for (const wordMatcher of text.matchAll(/[^\s\u200B\u200C\u200D<>|:;,()"'\x60]+/g)) {
    const word = wordMatcher[0];
    if (word.length < 2 || seen.has(word)) continue;
    if (!SCRIPT_RANGES.latin.test(word)) continue;
    for (const [name, re] of Object.entries(SCRIPT_RANGES)) {
      if (name === 'latin') continue;
      if (re.test(word)) {
        seen.add(word);
        found.push({ word, at: wordMatcher.index, kind: `latin+${name}` });
        break;
      }
    }
  }
  return found;
}

function excerptAt(text, idx) {
  const start = Math.max(0, idx - 40);
  return (start > 0 ? '…' : '') + text.slice(start, idx + 60).replace(/\s+/g, ' ') + '…';
}

function scanText(text, findings) {
  const parkedFlags = [];
  text = text.replace(FLAG_EMOJI_RE, (m) => {
    parkedFlags.push(m);
    return `\u0000FLAG${parkedFlags.length - 1}\u0000`;
  });
  const restoreFlags = (s) => s.replace(/\u0000FLAG(\d+)\u0000/g, (_m, i) => parkedFlags[Number(i)] ?? '');

  const removed = { zero_width: 0, bidi: 0, format: 0, bom: 0, tag: 0 };
  const tampering = [];
  let offset = 0;
  const clean = [...text].map((ch) => {
    const at = offset;
    offset += ch.length;
    const code = ch.codePointAt(0);
    if (TAG_CHARS.includes(ch)) { removed.tag++; return ' '; }
    if (BIDI_TAMPER.includes(ch)) {
      removed.bidi++;
      tampering.push({ kind: `bidi-control U+${code.toString(16).toUpperCase().padStart(4, '0')}`, context: excerptAt(text, at) });
      return '';
    }
    if (ZERO_WIDTH.includes(ch)) { removed.zero_width++; return ''; }
    if (FORMAT.includes(ch)) { removed.format++; return ch === '\u00AD' ? '' : ' '; }
    if (BOM === ch) { removed.bom++; return ''; }
    if (BIDI.includes(ch)) { removed.bidi++; return ''; }
    return ch;
  }).join('');

  for (const m of text.matchAll(new RegExp(`[\\p{L}][${ZERO_WIDTH}]+[\\p{L}]`, 'gu'))) {
    tampering.push({ kind: 'zero-width inside a word', context: excerptAt(text, m.index) });
  }

  const invisible = { counts: removed, tampering };

  const instruction_shaped = [];
  for (const line of clean.split(/\n+/)) {
    for (const { re, label } of INSTRUCTION_PATTERNS) {
      const m = line.match(re);
      if (m) {
        instruction_shaped.push({ label, excerpt: line.trim().slice(0, 200) });
        break;
      }
    }
  }

  const mixed_script = mixedScriptWords(clean);
  const urls = [...new Set([...clean.matchAll(/https?:\/\/[^\s<>")'\]]+/g)].map((m) => m[0]))];

  return {
    clean: restoreFlags(clean),
    findings: {
      invisible,
      instruction_shaped,
      mixed_script,
      visible_urls: urls,
      hidden_blocks: findings.hidden_blocks,
      hidden_urls: findings.hiddenUrls.filter((u) => !urls.some((v) => v.startsWith(u.slice(0, 40)))),
      tag_chars_removed: removed.tag,
    },
  };
}

function splitHtmlTags(markup) {
  const tokens = [];
  let textStart = 0;
  const lastGt = markup.lastIndexOf('>');
  for (let i = 0; i < markup.length; i++) {
    if (markup[i] !== '<') continue;
    if (i > lastGt) break;
    if (!/[a-zA-Z!?/]/.test(markup[i + 1] ?? '')) continue;
    let quote = null;
    let end = -1;
    for (let j = i + 1; j < markup.length; j++) {
      const c = markup[j];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '>') { end = j; break; }
    }
    if (end === -1) continue;
    if (i > textStart) tokens.push(markup.slice(textStart, i));
    tokens.push(markup.slice(i, end + 1));
    textStart = end + 1;
    i = end;
  }
  if (textStart < markup.length) tokens.push(markup.slice(textStart));
  return tokens;
}

function cleanHtml(markup, findings) {
  findings.hidden_blocks = [];
  findings.hiddenUrls = [];
  const collectedHidden = { text: '' };
  const pushHidden = (t) => { collectedHidden.text += t + '\n'; };
  const attachContent = (t) => {
    for (let i = findings.hidden_blocks.length - 1; i >= 0; i--) {
      if (!findings.hidden_blocks[i].content) {
        findings.hidden_blocks[i].content = t.replace(/\s+/g, ' ').trim().slice(0, 120);
        return;
      }
    }
  };

  markup = markup.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of SKIP_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
    markup = markup.replace(re, (m) => {
      const inner = m.replace(new RegExp(`<${tag}\\b[^>]*>|<\\/${tag}\\s*>`, 'gi'), ' ');
      pushHidden(inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 2000));
      return ' ';
    });
  }

  const tokens = splitHtmlTags(markup);
  let visible = '';
  const stack = [];
  const tagRe = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*)>$/;

  for (const token of tokens) {
    if (!token) continue;
    if (token[0] !== '<') {
      if (stack.some((e) => e.hidden)) { pushHidden(token.replace(/\s+/g, ' ')); attachContent(token); }
      else visible += token;
      continue;
    }
    const m = token.match(tagRe);
    if (!m) continue;
    const [, closing, rawName, rawAttrs] = m;
    const tag = rawName.toLowerCase();
    if (VOID_TAGS.has(tag)) {
      const hide = attrsHidden(rawAttrs);
      if (hide) {
        findings.hidden_blocks.push({ tag, reason: hide, excerpt: `<${tag} ${rawAttrs.trim().slice(0, 118)}` });
      }
      if (tag === 'br') visible += '\n';
      continue;
    }
    if (!closing) {
      const hide = attrsHidden(rawAttrs);
      stack.push({ tag, hidden: hide ?? null });
      if (hide) {
        findings.hidden_blocks.push({ tag, reason: hide, excerpt: `<${tag} ${rawAttrs.trim().slice(0, 118)}` });
      }
    } else {
      const block = BLOCK_TAGS.has(tag);
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      if (block) visible += '\n';
    }
  }

  for (const u of collectedHidden.text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    findings.hiddenUrls.push(u[0]);
  }

  return decodeEntities(visible)
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function hasTargetingSignals(f) {
  return (
    f.instruction_shaped.length > 0 ||
    f.invisible.tampering.length > 0 ||
    f.mixed_script.length > 0 ||
    f.tag_chars_removed > 0
  );
}

function verdict(f) {
  if (hasTargetingSignals(f)) {
    return '⚠ flagged — signals that may target an AI agent; review before use';
  }
  if (f.hidden_blocks.length > 0 || f.hidden_urls.length > 0) {
    return '✅ clean — hidden page furniture only (context, no targeting signals)';
  }
  return '✅ clean';
}

/**
 * Pure integrity gate for a job posting body or field.
 *
 * @param {string | null | undefined} text
 * @param {'html' | 'text' | null} [mode=null]
 * @returns {{
 *   cleanText: string,
 *   integrity: 'clean' | 'flagged',
 *   flags: {
 *     mode: 'html' | 'text',
 *     verdict: string,
 *     flagged: boolean,
 *     invisible: { counts: { zero_width: number, bidi: number, format: number, bom: number, tag: number }, tampering: Array<{ kind: string, context: string }> },
 *     instructionShaped: Array<{ label: string, excerpt: string }>,
 *     mixedScript: Array<{ word: string, at: number, kind: string }>,
 *     visibleUrls: string[],
 *     hiddenBlocks: Array<{ tag: string, reason: string, excerpt: string, content?: string }>,
 *     hiddenUrls: string[],
 *     tagCharsRemoved: number,
 *   },
 * }}
 */
export function guardPosting(text, mode = null) {
  const raw = typeof text === 'string' ? text : String(text ?? '');
  const findings = { hidden_blocks: [], hiddenUrls: [] };
  const resolved = mode ?? (/<\s*\/?\s*[a-z][a-z0-9-]*(?:\s[^>]*)?>/i.test(raw.slice(0, 2000)) ? 'html' : 'text');
  const visibleText = resolved === 'html' ? cleanHtml(raw, findings) : raw;
  const { clean, findings: f } = scanText(visibleText, findings);
  const flagged = hasTargetingSignals(f);

  return {
    cleanText: clean,
    integrity: flagged ? 'flagged' : 'clean',
    flags: {
      mode: resolved,
      verdict: verdict({ ...f, mode: resolved }),
      flagged,
      invisible: f.invisible,
      instructionShaped: f.instruction_shaped,
      mixedScript: f.mixed_script,
      visibleUrls: f.visible_urls,
      hiddenBlocks: f.hidden_blocks,
      hiddenUrls: f.hidden_urls,
      tagCharsRemoved: f.tag_chars_removed,
    },
  };
}
