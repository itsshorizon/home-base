#!/usr/bin/env node
// Validates data/guides/*.json, writes data/guides/index.json, and updates the guide section of sw.js.
//
//   node scripts/guides-index.js                      validate + write index.json + rewrite sw.js PRECACHE
//   node scripts/guides-index.js --dir <path>         use another folder (sw.js is left alone)
//   node scripts/guides-index.js --dir <path> --dry-run   validate and print only; nothing is written
//
// No dependencies. Exit code 1 when any guide has a problem (the problems are listed).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GUIDE_CATEGORY_KEYS, BLOCK_TYPES } from '../js/guides.js';
import { KINDS } from '../js/categories.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIR = path.join(ROOT, 'data', 'guides');
export const SW_START = '// GUIDES:START';
export const SW_END = '// GUIDES:END';

const isStr = (v) => typeof v === 'string' && v.trim() !== '';

// Returns { errors: [...], warnings: [...] } for one parsed guide. `fileId` is the filename without .json.
export function validateGuide(g, fileId) {
  const errors = [];
  const warnings = [];
  if (!g || typeof g !== 'object' || Array.isArray(g)) return { errors: ['not a JSON object'], warnings };
  if (g.id !== fileId) errors.push(`id "${g.id}" does not match the filename "${fileId}.json"`);
  if (!isStr(g.title)) errors.push('missing title');
  if (!GUIDE_CATEGORY_KEYS.includes(g.category)) errors.push(`unknown category "${g.category}" (use ${GUIDE_CATEGORY_KEYS.join(', ')})`);
  if (!Array.isArray(g.sources) || g.sources.length < 1) errors.push('needs at least one source');
  else g.sources.forEach((s, i) => { if (!s || !isStr(s.title) || !isStr(s.url)) errors.push(`sources[${i}] needs a title and a url`); });
  if (!Array.isArray(g.blocks) || g.blocks.length < 3) errors.push('needs at least 3 blocks');
  else {
    g.blocks.forEach((b, i) => {
      if (!b || typeof b !== 'object' || !BLOCK_TYPES.includes(b.type)) {
        errors.push(`blocks[${i}] has unknown type "${b && b.type}" (known: ${BLOCK_TYPES.join(', ')})`);
        return;
      }
      if (b.type === 'source' && !(Array.isArray(g.sources) && g.sources[Number(b.n) - 1])) warnings.push(`blocks[${i}] source n=${b.n} points at no source`);
      if (b.type === 'calc' && b.calc !== 'bleach') warnings.push(`blocks[${i}] unknown calculator "${b.calc}"`);
      if (['steps', 'list', 'checklist'].includes(b.type) && !Array.isArray(b.items)) errors.push(`blocks[${i}] (${b.type}) needs an items array`);
      if (['p', 'h', 'warning', 'tip'].includes(b.type) && !isStr(b.text)) errors.push(`blocks[${i}] (${b.type}) needs text`);
      if (b.type === 'table' && (!Array.isArray(b.rows) || !Array.isArray(b.headers))) errors.push(`blocks[${i}] (table) needs headers and rows arrays`);
    });
  }
  if (!isStr(g.summary)) warnings.push('missing summary');
  if (g.kinds !== undefined && !Array.isArray(g.kinds)) errors.push('kinds must be an array');
  else for (const k of g.kinds || []) if (!KINDS[k]) warnings.push(`kind "${k}" is not an inventory kind, so no "How to use" link will appear`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(g.checkedAt || ''))) warnings.push('checkedAt should look like 2026-10-31');
  for (const f of ['emergency', 'medical']) if (g[f] !== undefined && typeof g[f] !== 'boolean') warnings.push(`${f} should be true or false`);
  return { errors, warnings };
}

export function indexEntry(g) {
  return {
    id: g.id, title: g.title, category: g.category, summary: g.summary || '',
    emergency: g.emergency === true, medical: g.medical === true, kinds: Array.isArray(g.kinds) ? g.kinds : [],
  };
}

// Category order (water, food, ...), then title.
export function sortEntries(entries) {
  const rank = (e) => GUIDE_CATEGORY_KEYS.indexOf(e.category);
  return [...entries].sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}

// Replace everything between the GUIDES:START / GUIDES:END marker lines with one quoted path per line.
export function rewritePrecache(swText, paths) {
  const lines = swText.split('\n');
  const a = lines.findIndex((l) => l.trim() === SW_START);
  const b = lines.findIndex((l) => l.trim() === SW_END);
  if (a === -1 || b === -1 || b < a) throw new Error(`sw.js is missing the ${SW_START} / ${SW_END} marker lines`);
  const indent = lines[a].match(/^\s*/)[0];
  const body = paths.map((p) => `${indent}'${p}',`);
  return [...lines.slice(0, a + 1), ...body, ...lines.slice(b)].join('\n');
}

// Reads and checks a folder. Never writes. Returns { entries, problems: [{file, errors}], warnings: [{file, warnings}] }.
export function checkDir(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { entries: [], problems: [{ file: dir, errors: ['folder does not exist'] }], warnings: [] };
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  const entries = [];
  const problems = [];
  const warnings = [];
  for (const f of files) {
    const id = f.slice(0, -5);
    let g;
    try { g = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) {
      problems.push({ file: f, errors: [`invalid JSON: ${e.message}`] });
      continue;
    }
    const r = validateGuide(g, id);
    if (r.errors.length) problems.push({ file: f, errors: r.errors });
    else entries.push(indexEntry(g));
    if (r.warnings.length) warnings.push({ file: f, warnings: r.warnings });
  }
  if (!files.length) problems.push({ file: dir, errors: ['no guide files found'] });
  return { entries: sortEntries(entries), problems, warnings };
}

export function main(argv, log = console.log) {
  const args = argv.slice();
  const dryRun = args.includes('--dry-run');
  let dir = DEFAULT_DIR;
  let customDir = false;
  const di = args.indexOf('--dir');
  if (di !== -1) {
    if (!args[di + 1]) { log('--dir needs a folder path'); return 2; }
    dir = path.resolve(args[di + 1]);
    customDir = path.resolve(dir) !== DEFAULT_DIR;
  }
  const { entries, problems, warnings } = checkDir(dir);
  for (const w of warnings) log(`warning ${w.file}: ${w.warnings.join('; ')}`);
  if (problems.length) {
    log(`\n${problems.length} problem file${problems.length === 1 ? '' : 's'}:`);
    for (const p of problems) for (const e of p.errors) log(`  ${p.file}: ${e}`);
    log('\nNothing was written.');
    return 1;
  }
  const index = { generatedAt: new Date().toISOString(), guides: entries };
  log(`${entries.length} guides OK (${entries.filter((e) => e.emergency).length} emergency, ${entries.filter((e) => e.medical).length} medical).`);
  for (const e of entries) log(`  [${e.category}] ${e.id}${e.emergency ? '  (emergency)' : ''}`);
  if (dryRun) { log('\nDry run: nothing was written.'); return 0; }

  fs.writeFileSync(path.join(dir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  log(`\nWrote ${path.join(dir, 'index.json')}`);
  if (customDir) { log('Custom --dir: sw.js was not changed.'); return 0; }
  const swPath = path.join(ROOT, 'sw.js');
  const rel = path.relative(ROOT, dir).split(path.sep).join('/');
  const paths = [`${rel}/index.json`, ...entries.map((e) => `${rel}/${e.id}.json`)];
  fs.writeFileSync(swPath, rewritePrecache(fs.readFileSync(swPath, 'utf8'), paths));
  log(`Updated the guide section of sw.js (${paths.length} files). Bump the version in sw.js, js/app.js and version.json before shipping.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
