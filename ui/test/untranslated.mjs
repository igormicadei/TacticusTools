/**
 * Finds user-visible English still hardcoded in the UI.
 *
 * A half-translated screen is the failure worth catching: it looks finished, so
 * nobody reports it. This reads the sources rather than the running app because
 * the strings that go missing are the ones behind a branch nobody clicked.
 *
 * Heuristics, not a parser — it looks for prose in the two places prose hides,
 * text between JSX tags and human-readable values of the attributes that get
 * rendered. It is deliberately noisy about things it cannot judge: better a
 * false positive to wave off than a missed sentence.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.tsx?$/.test(entry.name)) yield path;
  }
}

// Words that are the same in both languages, or are the game's own names, or
// are code rather than prose. Matching one of these is not a finding.
const IGNORE = [
  /^[A-Z_]+$/, // SCREAMING_CASE constants
  /^[a-z]+([A-Z][a-z]*)+$/, // camelCase identifiers
  /^[\d\s.,:%×/+-]+$/, // numbers and punctuation
  /^(TACTICUS TOOLS|Tacticus|API|JSON|CSV|URL|CORS|OK|ID)$/i,
  /^(px|rem|auto|none|flex|grid|true|false|null|undefined)$/,
  /^(var|calc|rgba?)\(/,
  /^https?:/,
  /^[\w.-]+\.(ts|tsx|mjs|js|json|css|html)$/,
];

const ignored = (text) => IGNORE.some((re) => re.test(text.trim()));

// Prose looks like prose: at least two letters, and either a space or a word
// long enough not to be an identifier fragment.
const isProse = (text) => {
  const trimmed = text.trim();
  if (trimmed.length < 3 || ignored(trimmed)) return false;
  if (!/[A-Za-z]{2}/.test(trimmed)) return false;
  return /\s/.test(trimmed) || /^[A-Z][a-z]{2,}$/.test(trimmed);
};

const findings = [];
for await (const file of walk(SRC)) {
  // The dictionaries are supposed to be full of English.
  if (/\/i18n\//.test(file)) continue;
  const source = await readFile(file, 'utf8');
  const lines = source.split('\n');

  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    // A line inside a block comment is documentation, not UI.
    if (/^\s*\*/.test(code) || /^\s*\/\*/.test(code)) return;

    // Text sitting between JSX tags.
    for (const m of code.matchAll(/>([^<>{}]+)</g)) {
      if (isProse(m[1])) findings.push({ file, line: i + 1, text: m[1].trim(), how: 'jsx-text' });
    }
    // Rendered attributes.
    for (const m of code.matchAll(/\b(title|placeholder|alt|aria-label|label)="([^"]+)"/g)) {
      if (isProse(m[2])) findings.push({ file, line: i + 1, text: m[2].trim(), how: `attr:${m[1]}` });
    }
  });
}

for (const f of findings) {
  console.log(`${relative(SRC, f.file)}:${f.line}  [${f.how}]  ${JSON.stringify(f.text).slice(0, 110)}`);
}
console.log(`\n${findings.length} possible untranslated string(s)`);
process.exit(findings.length === 0 ? 0 : 1);
