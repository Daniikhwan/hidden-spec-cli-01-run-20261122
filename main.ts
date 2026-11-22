// main.ts is mend, the CLI SPEC.md specifies. It does all ten sections of SPEC.md: the command line, the
// output and exit codes, safe paths, format detection, line matching at three tiers, unified diffs,
// SEARCH/REPLACE blocks, V4A patches, JSON edits and the all-or-nothing write. Node 22, the standard
// library alone; run it as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to
// runner.ts (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** A file as lines: its line break, its lines, and whether it ended with a break (SPEC.md section 3). */
interface FileDoc {
  lines: string[];
  br: '\n' | '\r\n';
  finalBreak: boolean;
}

function parseFile(text: string): FileDoc {
  if (text === '') return { lines: [], br: '\n', finalBreak: false };
  const nl = text.indexOf('\n');
  const br: '\n' | '\r\n' = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const parts = text.split(br);
  const finalBreak = text.endsWith(br);
  if (finalBreak) parts.pop();
  return { lines: parts, br, finalBreak };
}

function serializeFile(doc: FileDoc): string {
  if (doc.lines.length === 0) return '';
  return doc.lines.join(doc.br) + (doc.finalBreak ? doc.br : '');
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

function getDoc(tree: Tree, p: string): FileDoc | null {
  const t = tree.get(p);
  return t === null ? null : parseFile(t);
}

function setDoc(tree: Tree, p: string, doc: FileDoc): void {
  tree.now.set(p, serializeFile(doc));
}

type Edit = (tree: Tree) => void;

/* ------------------------------------------------------------------ */
/* Section 5: matching lines at three tiers.                           */
/* ------------------------------------------------------------------ */

function keyOf(line: string, tier: number): string {
  if (tier === 0) return line;
  if (tier === 1) return line.replace(/[ \t]+$/, '');
  return line.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
}

/** Every 0-based position where `o` occurs in `lines` at `tier`. */
function occurrences(lines: string[], o: string[], tier: number, from = 0): number[] {
  const out: number[] = [];
  if (o.length === 0 || o.length > lines.length - from) return out;
  const keys = o.map((l) => keyOf(l, tier));
  for (let i = from; i + o.length <= lines.length; i++) {
    let good = true;
    for (let j = 0; j < o.length; j++) {
      if (keyOf(lines[i + j]!, tier) !== keys[j]) {
        good = false;
        break;
      }
    }
    if (good) out.push(i);
  }
  return out;
}

/**
 * The first tier (0, 1, 2; 0 only when strict) at which `o` occurs in `lines` at or after `from`,
 * with its occurrences. Null when it occurs at no tier.
 */
function findTier(lines: string[], o: string[], strict: boolean, from = 0): { tier: number; occ: number[] } | null {
  const maxTier = strict ? 0 : 2;
  for (let t = 0; t <= maxTier; t++) {
    const occ = occurrences(lines, o, t, from);
    if (occ.length > 0) return { tier: t, occ };
  }
  return null;
}

function leadingWs(s: string): string {
  const m = /^[ \t]*/.exec(s);
  return m ? m[0] : '';
}

/** Tier-2 re-indentation of one new line (SPEC.md section 5). */
function reindent(line: string, p: string, f: string): string {
  if (line === '' || line.trim() === '') return line;
  if (!line.startsWith(p)) return line;
  return f + line.slice(p.length);
}

/** One line of N: a context line (written as the file's own matched line) or a new line. */
type NItem = { kind: 'ctx'; oIndex: number } | { kind: 'new'; text: string };

/** Build the replacement lines for an occurrence at `at`, at the tier `o` was found at. */
function buildN(items: NItem[], fileLines: string[], at: number, o: string[], tier: number): string[] {
  const out: string[] = [];
  let f = '';
  let p = '';
  if (tier === 2 && o.length > 0) {
    f = leadingWs(fileLines[at]!);
    p = leadingWs(o[0]!);
  }
  for (const it of items) {
    if (it.kind === 'ctx') out.push(fileLines[at + it.oIndex]!);
    else out.push(tier === 2 ? reindent(it.text, p, f) : it.text);
  }
  return out;
}

/** Re-indent plain new lines (no context lines, as in SEARCH/REPLACE) at tier 2. */
function reindentNew(newLines: string[], fileLines: string[], at: number, o: string[], tier: number): string[] {
  if (tier !== 2 || o.length === 0) return [...newLines];
  const f = leadingWs(fileLines[at]!);
  const p = leadingWs(o[0]!);
  return newLines.map((l) => reindent(l, p, f));
}

/** Split hunk/chunk body items into O (context + old) and N (context + new) items. */
function splitItems(items: BodyItem[]): { o: string[]; nItems: NItem[] } {
  const o: string[] = [];
  const nItems: NItem[] = [];
  let oIndex = 0;
  for (const it of items) {
    if (it.kind === 'ctx') {
      o.push(it.text);
      nItems.push({ kind: 'ctx', oIndex });
      oIndex++;
    } else if (it.kind === 'old') {
      o.push(it.text);
      oIndex++;
    } else if (it.kind === 'new') {
      nItems.push({ kind: 'new', text: it.text });
    }
  }
  return { o, nItems };
}

/** One body line of a unified hunk or a V4A chunk. `raw` keeps the line as written. */
interface BodyItem {
  kind: 'ctx' | 'old' | 'new' | 'bs';
  text: string;
  raw: string;
}

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/* ------------------------------------------------------------------ */
/* Section 9: JSON edits (one JSON array, or JSON Lines).              */
/* ------------------------------------------------------------------ */

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

/* ------------------------------------------------------------------ */
/* Section 6: unified diffs.                                           */
/* ------------------------------------------------------------------ */

interface Hunk {
  /** Old start line A (1-based) from the hunk header. */
  a: number;
  /** Body items in order, trailing empty lines removed. */
  items: BodyItem[];
  /** O: context + old lines. */
  o: string[];
  /** N: context (with its O index) + new lines. */
  nItems: NItem[];
  /** A `\` line follows this hunk's last context or `+` line. */
  noEolNew: boolean;
  /** A `\` line follows this hunk's last `+` line. */
  noEolAfterLastPlus: boolean;
}

interface UnifiedSection {
  oldPath: string | null;
  newPath: string | null;
  creation: boolean;
  deletion: boolean;
  hunks: Hunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** A `--- <path>` / `+++ <path>` line's path: up to the first tab, trimmed, /dev/null, a/ or b/ removed. */
function unifiedPath(line: string): string | null {
  let p = line.slice(4);
  const tab = p.indexOf('\t');
  if (tab >= 0) p = p.slice(0, tab);
  p = p.trim();
  if (p === '/dev/null') return null;
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  return p;
}

function diffGitPaths(l: string): [string, string] | null {
  const m = /^diff --git a\/(\S+) b\/(\S+)$/.exec(l);
  return m ? [m[1]!, m[2]!] : null;
}

/** Parse one hunk body starting after the header at `headerIdx`; returns the hunk and the next index. */
function parseHunk(lines: string[], headerIdx: number, a: number): { hunk: Hunk; next: number } {
  const items: BodyItem[] = [];
  let j = headerIdx + 1;
  while (j < lines.length) {
    const l = lines[j]!;
    // The body ends at a `--- ` line followed by a `+++ ` line (a new section starts there).
    if (l.startsWith('--- ') && (lines[j + 1] ?? '').startsWith('+++ ')) break;
    if (l === '') {
      items.push({ kind: 'ctx', text: '', raw: l });
      j++;
      continue;
    }
    const c = l[0]!;
    if (c === ' ') {
      items.push({ kind: 'ctx', text: l.slice(1), raw: l });
      j++;
      continue;
    }
    if (c === '-') {
      items.push({ kind: 'old', text: l.slice(1), raw: l });
      j++;
      continue;
    }
    if (c === '+') {
      items.push({ kind: 'new', text: l.slice(1), raw: l });
      j++;
      continue;
    }
    if (c === '\\') {
      items.push({ kind: 'bs', text: l.slice(1), raw: l });
      j++;
      continue;
    }
    break;
  }
  // Empty lines at the end of a body are not part of it (zero-length lines only).
  while (items.length > 0 && items[items.length - 1]!.raw === '') items.pop();
  let noEolNew = false;
  let noEolAfterLastPlus = false;
  let lastCtxOrNew = -1;
  let lastPlus = -1;
  items.forEach((it, k) => {
    if (it.kind === 'ctx' || it.kind === 'new') lastCtxOrNew = k;
    if (it.kind === 'new') lastPlus = k;
  });
  if (lastCtxOrNew >= 0 && items[lastCtxOrNew + 1]?.kind === 'bs') noEolNew = true;
  if (lastPlus >= 0 && items[lastPlus + 1]?.kind === 'bs') noEolAfterLastPlus = true;
  const { o, nItems } = splitItems(items);
  return { hunk: { a, items, o, nItems, noEolNew, noEolAfterLastPlus }, next: j };
}

/** Apply one hunk to a file's lines, with the section's delta `d` so far. */
function applyUnifiedHunk(doc: FileDoc, hunk: Hunk, d: number, strict: boolean, path: string): FileDoc {
  const lines = doc.lines;
  if (hunk.o.length === 0) {
    // Insert N after the first A + d lines (all of them when the file has fewer).
    const pos = Math.min(hunk.a + d, lines.length);
    const atEnd = pos === lines.length;
    const added = hunk.nItems.map((it) => (it.kind === 'new' ? it.text : ''));
    const newLines = [...lines.slice(0, pos), ...added, ...lines.slice(pos)];
    return { lines: newLines, br: doc.br, finalBreak: atEnd ? !hunk.noEolNew : doc.finalBreak };
  }
  const found = findTier(lines, hunk.o, strict);
  if (!found) throw new Fail('no-match', path);
  const target = hunk.a - 1 + d;
  let best = found.occ[0]!;
  for (const p of found.occ) {
    if (Math.abs(p - target) < Math.abs(best - target)) best = p;
  }
  const at = best;
  const n = buildN(hunk.nItems, lines, at, hunk.o, found.tier);
  const runsToEnd = at + hunk.o.length === lines.length;
  const newLines = [...lines.slice(0, at), ...n, ...lines.slice(at + hunk.o.length)];
  return { lines: newLines, br: doc.br, finalBreak: runsToEnd ? !hunk.noEolNew : doc.finalBreak };
}

function applyUnifiedHunks(doc: FileDoc, hunks: Hunk[], strict: boolean, path: string): FileDoc {
  let cur = doc;
  let d = 0;
  for (const h of hunks) {
    cur = applyUnifiedHunk(cur, h, d, strict, path);
    d += h.nItems.length - h.o.length;
  }
  return cur;
}

function parseUnified(lines: string[], strict: boolean, moves: [string, string][]): Edit[] {
  const sections: UnifiedSection[] = [];
  let sec: UnifiedSection | null = null;
  let state: 'outside' | 'header' | 'between' = 'outside';
  let headerPair = false;
  const finishSection = (): void => {
    if (sec) sections.push(sec);
    sec = null;
  };
  const startSection = (oldP: string | null, newP: string | null, pair: boolean): void => {
    finishSection();
    sec = { oldPath: oldP, newPath: newP, creation: false, deletion: false, hunks: [] };
    state = 'header';
    headerPair = pair;
  };
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const l = lines[i]!;
    if (l.startsWith('diff --git')) {
      const paths = diffGitPaths(l);
      if (!paths) throw new Exit2(`error: parse ${i + 1}`);
      startSection(paths[0], paths[1], false);
      i++;
      continue;
    }
    if (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
      const op = unifiedPath(l);
      const np = unifiedPath(lines[i + 1]!);
      if (state === 'header' && sec && !headerPair) {
        sec.oldPath = op;
        sec.newPath = np;
        headerPair = true;
      } else {
        startSection(op, np, true);
      }
      i += 2;
      continue;
    }
    if (l.startsWith('--- ')) {
      if (state === 'header') throw new Exit2(`error: parse ${i + 2}`);
      i++;
      continue;
    }
    if (l.startsWith('@@')) {
      if (!sec) throw new Exit2(`error: parse ${i + 1}`);
      const m = HUNK_RE.exec(l);
      if (!m) throw new Exit2(`error: parse ${i + 1}`);
      const { hunk, next } = parseHunk(lines, i, Number(m[1]));
      sec.hunks.push(hunk);
      i = next;
      state = 'between';
      continue;
    }
    if (state === 'header' && sec) {
      if (l.startsWith('rename from ')) {
        if (!headerPair) sec.oldPath = l.slice(12).trim();
      } else if (l.startsWith('rename to ')) {
        if (!headerPair) sec.newPath = l.slice(10).trim();
      } else if (l.startsWith('new file mode')) sec.creation = true;
      else if (l.startsWith('deleted file mode')) sec.deletion = true;
      // `index`, `old mode`, `new mode`, `similarity index`, `dissimilarity index`, `Index:`
      // lines, and any other line, are ignored.
      i++;
      continue;
    }
    i++;
  }
  finishSection();
  return sections.map((s) => unifiedEdit(s, strict, moves));
}

function unifiedEdit(sec: UnifiedSection, strict: boolean, moves: [string, string][]): Edit {
  return (tree) => {
    const oldP = sec.oldPath;
    const newP = sec.newPath;
    for (const p of [oldP, newP]) {
      if (p !== null && !safe(p)) throw new Fail('unsafe', p);
    }
    if (oldP === null && newP === null) return; // degenerate section: nothing to do
    const creation = newP !== null && (sec.creation || oldP === null);
    const deletion = !creation && oldP !== null && (sec.deletion || newP === null);
    if (creation) {
      const p = newP!;
      if (tree.get(p) !== null) throw new Fail('exists', p);
      const out: string[] = [];
      let noEol = false;
      for (const h of sec.hunks) {
        let hasPlus = false;
        for (const it of h.items) {
          if (it.kind === 'new') {
            out.push(it.text);
            hasPlus = true;
          }
        }
        if (hasPlus) noEol = h.noEolAfterLastPlus;
      }
      tree.now.set(p, out.length === 0 ? '' : out.join('\n') + (noEol ? '' : '\n'));
      return;
    }
    if (deletion) {
      const p = oldP!;
      if (tree.get(p) === null) throw new Fail('missing', p);
      tree.now.set(p, null);
      return;
    }
    if (oldP !== null && newP !== null && oldP !== newP) {
      if (tree.get(oldP) === null) throw new Fail('missing', oldP);
      if (tree.get(newP) !== null) throw new Fail('exists', newP);
      const doc = getDoc(tree, oldP)!;
      const out = applyUnifiedHunks(doc, sec.hunks, strict, oldP);
      tree.now.set(newP, serializeFile(out));
      tree.now.set(oldP, null);
      moves.push([oldP, newP]);
      return;
    }
    const p = oldP!;
    if (tree.get(p) === null) throw new Fail('missing', p);
    const doc = getDoc(tree, p)!;
    const out = applyUnifiedHunks(doc, sec.hunks, strict, p);
    setDoc(tree, p, out);
  };
}

/* ------------------------------------------------------------------ */
/* Section 7: SEARCH/REPLACE blocks.                                   */
/* ------------------------------------------------------------------ */

function searchReplaceEdit(path: string, oldLines: string[], newLines: string[], strict: boolean): Edit {
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    if (oldLines.length === 0) {
      if (tree.get(path) !== null) throw new Fail('exists', path);
      tree.now.set(path, newLines.length === 0 ? '' : newLines.join('\n') + '\n');
      return;
    }
    const t = tree.get(path);
    if (t === null) throw new Fail('missing', path);
    const doc = parseFile(t);
    const found = findTier(doc.lines, oldLines, strict);
    if (!found) throw new Fail('no-match', path);
    if (found.occ.length > 1) throw new Fail('ambiguous', path);
    const at = found.occ[0]!;
    const n = reindentNew(newLines, doc.lines, at, oldLines, found.tier);
    const lines = [...doc.lines.slice(0, at), ...n, ...doc.lines.slice(at + oldLines.length)];
    setDoc(tree, path, { lines, br: doc.br, finalBreak: doc.finalBreak });
  };
}

function parseSearchReplace(lines: string[], strict: boolean): Edit[] {
  const edits: Edit[] = [];
  let prevPath: string | null = null;
  let prevEnd = 0;
  const n = lines.length;
  let i = 0;
  while (i < n) {
    if (lines[i]!.trimEnd() !== '<<<<<<< SEARCH') {
      i++;
      continue;
    }
    const searchLine = i + 1;
    let eq = -1;
    for (let j = i + 1; j < n; j++) {
      if (lines[j]!.trimEnd() === '=======') {
        eq = j;
        break;
      }
      if (lines[j]!.trimEnd() === '<<<<<<< SEARCH') break;
    }
    if (eq < 0) throw new Exit2(`error: parse ${searchLine}`);
    let rep = -1;
    for (let j = eq + 1; j < n; j++) {
      if (lines[j]!.trimEnd() === '>>>>>>> REPLACE') {
        rep = j;
        break;
      }
      if (lines[j]!.trimEnd() === '<<<<<<< SEARCH') break;
    }
    if (rep < 0) throw new Exit2(`error: parse ${searchLine}`);
    let path: string | null = null;
    for (let j = i - 1; j >= prevEnd; j--) {
      const t = lines[j]!.trim();
      if (t === '' || t.startsWith('```')) continue;
      path = t;
      break;
    }
    if (path === null) path = prevPath;
    if (path === null) throw new Exit2(`error: parse ${searchLine}`);
    const oldLines = lines.slice(i + 1, eq);
    const newLines = lines.slice(eq + 1, rep);
    edits.push(searchReplaceEdit(path, oldLines, newLines, strict));
    prevPath = path;
    prevEnd = rep + 1;
    i = rep + 1;
  }
  return edits;
}

/* ------------------------------------------------------------------ */
/* Section 8: V4A patches.                                             */
/* ------------------------------------------------------------------ */

interface VChunk {
  /** Null: no anchor. Empty string from `@@` alone is also no anchor. */
  anchor: string | null;
  items: BodyItem[];
  /** Ended by a `*** End of File` line: anchored to the end of the file. */
  eof: boolean;
}

function parseV4a(lines: string[], strict: boolean, moves: [string, string][]): Edit[] {
  const n = lines.length;
  let first = -1;
  for (let i = 0; i < n; i++) {
    if (!blank(lines[i]!)) {
      first = i;
      break;
    }
  }
  if (first < 0) throw new Exit2('error: parse 1');
  if (lines[first]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first + 1}`);
  let last = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (!blank(lines[i]!)) {
      last = i;
      break;
    }
  }
  if (lines[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${n + 1}`);
  const edits: Edit[] = [];
  let i = first + 1;
  while (i < last) {
    while (i < last && blank(lines[i]!)) i++;
    if (i >= last) break;
    const l = lines[i]!;
    let kind: 'add' | 'delete' | 'update';
    let path: string;
    if (l.startsWith('*** Add File: ')) {
      kind = 'add';
      path = l.slice(14).trim();
    } else if (l.startsWith('*** Delete File: ')) {
      kind = 'delete';
      path = l.slice(17).trim();
    } else if (l.startsWith('*** Update File: ')) {
      kind = 'update';
      path = l.slice(17).trim();
    } else {
      throw new Exit2(`error: parse ${i + 1}`);
    }
    const headerLine = i + 1;
    i++;
    const contentStart = i;
    const content: string[] = [];
    while (i < last) {
      const cl = lines[i]!;
      if (cl.startsWith('*** Add File: ') || cl.startsWith('*** Delete File: ') || cl.startsWith('*** Update File: ')) break;
      content.push(cl);
      i++;
    }
    // Blank lines at the end of a section (before the next section or `*** End Patch`) are not part of it.
    while (content.length > 0 && blank(content[content.length - 1]!)) content.pop();
    if (kind === 'add') edits.push(v4aAddEdit(path, content, contentStart));
    else if (kind === 'delete') edits.push(v4aDeleteEdit(path, content, contentStart));
    else edits.push(v4aUpdateEdit(path, content, contentStart, headerLine, strict, moves));
  }
  return edits;
}

function v4aAddEdit(path: string, content: string[], contentStart: number): Edit {
  const fileLines: string[] = [];
  content.forEach((l, k) => {
    if (l.startsWith('+')) fileLines.push(l.slice(1));
    else if (l === '') fileLines.push('');
    else throw new Exit2(`error: parse ${contentStart + k + 1}`);
  });
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    if (tree.get(path) !== null) throw new Fail('exists', path);
    tree.now.set(path, fileLines.length === 0 ? '' : fileLines.join('\n') + '\n');
  };
}

function v4aDeleteEdit(path: string, content: string[], contentStart: number): Edit {
  content.forEach((l, k) => {
    if (!blank(l)) throw new Exit2(`error: parse ${contentStart + k + 1}`);
  });
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    if (tree.get(path) === null) throw new Fail('missing', path);
    tree.now.set(path, null);
  };
}

function v4aUpdateEdit(path: string, content: string[], contentStart: number, headerLine: number, strict: boolean, moves: [string, string][]): Edit {
  let idx = 0;
  let moveTo: string | null = null;
  if (content.length > 0 && content[0]!.startsWith('*** Move to: ')) {
    moveTo = content[0]!.slice(13).trim();
    idx = 1;
  }
  const chunks: VChunk[] = [];
  let cur: VChunk | null = null;
  let started = false;
  while (idx < content.length) {
    const l = content[idx]!;
    const lineNo = contentStart + idx + 1;
    if (l.startsWith('@@')) {
      cur = { anchor: l.slice(2).trim(), items: [], eof: false };
      chunks.push(cur);
      started = true;
      idx++;
      continue;
    }
    if (l === '*** End of File') {
      if (!cur) throw new Exit2(`error: parse ${lineNo}`);
      cur.eof = true;
      cur = null;
      idx++;
      continue;
    }
    const c = l[0];
    if (l === '' || c === ' ' || c === '-' || c === '+') {
      if (!cur) {
        if (!started) {
          cur = { anchor: null, items: [], eof: false };
          chunks.push(cur);
          started = true;
        } else {
          throw new Exit2(`error: parse ${lineNo}`);
        }
      }
      if (l === '') cur.items.push({ kind: 'ctx', text: '', raw: l });
      else if (c === ' ') cur.items.push({ kind: 'ctx', text: l.slice(1), raw: l });
      else if (c === '-') cur.items.push({ kind: 'old', text: l.slice(1), raw: l });
      else cur.items.push({ kind: 'new', text: l.slice(1), raw: l });
      idx++;
      continue;
    }
    throw new Exit2(`error: parse ${lineNo}`);
  }
  if (chunks.length === 0 && moveTo === null) throw new Exit2(`error: parse ${headerLine}`);
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    if (moveTo !== null && !safe(moveTo)) throw new Fail('unsafe', moveTo);
    const t = tree.get(path);
    if (t === null) throw new Fail('missing', path);
    if (moveTo !== null && tree.get(moveTo) !== null) throw new Fail('exists', moveTo);
    let doc = parseFile(t);
    let cursor = 0;
    for (const ch of chunks) {
      if (ch.anchor !== null && ch.anchor !== '') {
        const a = findTier(doc.lines, [ch.anchor], strict, cursor);
        if (!a) throw new Fail('no-match', path);
        cursor = a.occ[0]! + 1;
      }
      const { o, nItems } = splitItems(ch.items);
      if (o.length === 0) {
        const pos = ch.eof ? doc.lines.length : cursor;
        const added = nItems.map((it) => (it.kind === 'new' ? it.text : ''));
        const lines = [...doc.lines.slice(0, pos), ...added, ...doc.lines.slice(pos)];
        doc = { lines, br: doc.br, finalBreak: doc.finalBreak };
        cursor = pos + added.length;
        continue;
      }
      // First occurrence at or after the cursor, at the first tier with one; an end-of-file
      // chunk takes only an occurrence that ends at the file's last line.
      let found: { tier: number; occ: number[] } | null = null;
      const maxTier = strict ? 0 : 2;
      for (let tier = 0; tier <= maxTier; tier++) {
        let occ = occurrences(doc.lines, o, tier, cursor);
        if (ch.eof) occ = occ.filter((p) => p + o.length === doc.lines.length);
        if (occ.length > 0) {
          found = { tier, occ };
          break;
        }
      }
      if (!found) throw new Fail('no-match', path);
      const at = found.occ[0]!;
      const n = buildN(nItems, doc.lines, at, o, found.tier);
      const lines = [...doc.lines.slice(0, at), ...n, ...doc.lines.slice(at + o.length)];
      doc = { lines, br: doc.br, finalBreak: doc.finalBreak };
      cursor = at + n.length;
    }
    const out = serializeFile(doc);
    if (moveTo !== null) {
      tree.now.set(moveTo, out);
      tree.now.set(path, null);
      moves.push([path, moveTo]);
    } else {
      tree.now.set(path, out);
    }
  };
}

/* ------------------------------------------------------------------ */
/* Section 1, 2 and 10: invocation, output, exit codes, atomicity.    */
/* ------------------------------------------------------------------ */

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  const moves: [string, string][] = [];
  let edits: Edit[];
  try {
    if (kind === 'json') edits = jsonEdits(text, lines);
    else if (kind === 'unified') edits = parseUnified(lines, strict, moves);
    else if (kind === 'search-replace') edits = parseSearchReplace(lines, strict);
    else edits = parseV4a(lines, strict, moves);
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  // Rows, in byte order of the paths (a move's row sorts by its new path).
  const rows: { key: string; line: string }[] = [];
  const moved = new Set<string>();
  for (const [oldP, newP] of moves) {
    const wasOld = tree.original(oldP);
    const nowOld = tree.get(oldP);
    const wasNew = tree.original(newP);
    const nowNew = tree.get(newP);
    if (wasOld !== null && nowOld === null && wasNew === null && nowNew !== null) {
      rows.push({ key: newP, line: `R ${oldP} -> ${newP}` });
      moved.add(oldP);
      moved.add(newP);
    }
  }
  for (const p of [...tree.now.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    if (moved.has(p)) continue;
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    rows.push({ key: p, line: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}` });
  }
  rows.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  if (!check) {
    for (const p of [...tree.now.keys()]) {
      const was = tree.original(p);
      const now = tree.now.get(p)!;
      if (was === now) continue;
      if (now === null) rmSync(p, { force: true });
      else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, now);
      }
    }
  }
  return { code: 0, out: [...rows.map((r) => r.line), `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}

const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
