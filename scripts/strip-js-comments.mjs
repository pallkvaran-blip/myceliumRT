// STRIP FULL-LINE `//` COMMENTS FROM THE GAME'S INLINE SCRIPT — for the release build only (make-web-zip).
//
// WHY (M15 verify round 2, the slow-link boot): index.html is ~3.0 MB and ~1.08 MB of it is full-line `//`
// comments — the "why" this file carries densely on purpose. On the wire (itch serves it gzip through
// Cloudflare) that is 910 KB -> ~470 KB, about 2.4 s at 1.5 Mbps on the first thing a player downloads, and
// 1.1 MB (~5.8 s) on a host that does not compress. The repo copy keeps every comment; only the zip's staged
// copy is stripped, AFTER the build's own anchored patches (the dev flag's anchor IS a comment).
//
// ONLY WHOLE LINES WHOSE FIRST NON-BLANK TEXT IS `//`, AND ONLY WHERE A REAL LEXER SAYS THAT IS CODE. A line
// starting `//` inside a template literal or a block comment is content, not a comment, so the script is lexed
// (strings, templates with `${}` nesting, block comments, regex literals with classes) and a line is dropped
// only when it starts in code. Trailing comments after code are left alone (63 KB, not worth the edge cases).
// Removing a whole comment line keeps the newline before it, so ASI and line structure are unchanged.
//
// IT REFUSES RATHER THAN GUESSING: an unterminated string, a newline inside a regex, or a lexer that ends
// anywhere but plain code throws, and the caller ships the unstripped file (make-web-zip fails the build).
// `verify` re-lexes the result (no full-line comment left in code, ends in code) and compiles it with
// node:vm, which parses without running.
import vm from 'node:vm';

const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);

// Lex `js`; `onLineStart(i)` is asked at the start of every line that begins in plain code and returns the index
// to resume from (to skip a line) or `i`. Returns the final state.
function lex(js, onLineStart) {
  const n = js.length;
  let i = 0, state = 'code', prev = '', word = '', depth = 0;
  const tpl = [];
  const isId = (c) => /[A-Za-z0-9_$]/.test(c);
  let atLineStart = true;
  while (i < n) {
    if (atLineStart && state === 'code' && onLineStart) { const j = onLineStart(i); if (j !== i) { i = j; continue; } }
    atLineStart = false;
    const c = js[i];
    if (state === 'code') {
      if (c === '\n') { atLineStart = true; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '/' && js[i + 1] === '/') { while (i < n && js[i] !== '\n') i++; continue; }
      if (c === '/' && js[i + 1] === '*') { const e = js.indexOf('*/', i + 2); if (e < 0) throw new Error('unterminated block comment at ' + i); i = e + 2; continue; }
      if (c === "'" || c === '"') {
        let k = i + 1;
        for (;;) { if (k >= n) throw new Error('unterminated string at ' + i); const d = js[k];
          if (d === '\\') { k += 2; continue; } if (d === '\n') throw new Error('newline in a string at ' + i); if (d === c) break; k++; }
        i = k + 1; prev = 'x'; word = ''; continue;
      }
      if (c === '`') { state = 'tpl'; i++; continue; }
      if (c === '/') {
        const regex = REGEX_AFTER.has(prev) || (prev === 'w' && REGEX_WORDS.has(word));
        if (regex) {
          let k = i + 1, cls = false;
          for (;;) { if (k >= n) throw new Error('unterminated regex at ' + i); const d = js[k];
            if (d === '\n') throw new Error('newline in a regex at ' + i);
            if (d === '\\') { k += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; k++; }
          k++; while (k < n && /[a-z]/i.test(js[k])) k++;
          i = k; prev = 'x'; word = ''; continue;
        }
        prev = '/'; word = ''; i++; continue;
      }
      if (c === '{') { depth++; prev = '{'; word = ''; i++; continue; }
      if (c === '}') {
        if (depth === 0 && tpl.length) { depth = tpl.pop(); state = 'tpl'; i++; continue; }
        depth = Math.max(0, depth - 1); prev = '}'; word = ''; i++; continue;
      }
      if (isId(c)) { let k = i; while (k < n && isId(js[k])) k++; word = js.slice(i, k); prev = /^[0-9]/.test(word) ? 'x' : 'w'; i = k; continue; }
      if (c === ')' || c === ']') { prev = 'x'; word = ''; i++; continue; }
      prev = c; word = ''; i++; continue;
    }
    // template literal
    if (c === '\\') { i += 2; continue; }
    if (c === '`') { state = 'code'; prev = 'x'; word = ''; i++; continue; }
    if (c === '$' && js[i + 1] === '{') { tpl.push(depth); depth = 0; state = 'code'; prev = '{'; word = ''; i += 2; continue; }
    i++;
  }
  if (state !== 'code' || tpl.length) throw new Error(`lexer ended in ${state} with ${tpl.length} open template(s)`);
  return true;
}

function fullLineCommentEnd(js, i) {
  let k = i; while (k < js.length && (js[k] === ' ' || js[k] === '\t')) k++;
  if (js[k] === '/' && js[k + 1] === '/') { const e = js.indexOf('\n', k); return e < 0 ? js.length : e + 1; }
  return i;
}

export function stripFullLineComments(js) {
  const parts = []; let from = 0, lines = 0, bytes = 0;
  lex(js, (i) => {
    const e = fullLineCommentEnd(js, i);
    if (e !== i) { parts.push(js.slice(from, i)); from = e; lines++; bytes += e - i; }
    return e;
  });
  parts.push(js.slice(from));
  return { out: parts.join(''), lines, bytes };
}

export function verifyStripped(js) {
  let left = 0;
  lex(js, (i) => { if (fullLineCommentEnd(js, i) !== i) left++; return i; });
  if (left) throw new Error(left + ' full-line comment(s) left in code after stripping');
  new vm.Script(js, { filename: 'index.html#script' });   // parse only: throws a SyntaxError if the strip broke anything
  return true;
}

// The whole page: the one inline <script> (no src) is stripped, everything else is left byte for byte.
export function stripHtmlScript(html) {
  const open = html.search(/<script>\s*\n/);
  if (open < 0) throw new Error('no inline <script> found');
  const start = html.indexOf('\n', open) + 1, end = html.lastIndexOf('</script>');
  if (end < start) throw new Error('no closing </script>');
  const js = html.slice(start, end);
  const r = stripFullLineComments(js);
  verifyStripped(r.out);
  return { html: html.slice(0, start) + r.out + html.slice(end), lines: r.lines, bytes: r.bytes };
}

// CLI: node scripts/strip-js-comments.mjs <in.html> [out.html] — prints what it removed; --check only verifies.
if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs');
  const src = fs.readFileSync(process.argv[2], 'utf8');
  const r = stripHtmlScript(src);
  console.log(`stripped ${r.lines} full-line comments, ${(r.bytes / 1048576).toFixed(2)} MB: ${(src.length / 1048576).toFixed(2)} -> ${(r.html.length / 1048576).toFixed(2)} MB`);
  if (process.argv[3]) fs.writeFileSync(process.argv[3], r.html);
}
