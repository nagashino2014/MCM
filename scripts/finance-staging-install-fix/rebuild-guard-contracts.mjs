import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

// Reconcile only the pre-existing 178/187/197 schema members omitted by the
// isolated finance fixture. The input is the PostgreSQL 17 catalog projection
// of the staging schema after 226-232, with 243 and 233-241 installed locally.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const sqlDir = path.join(root, 'infra/aws');
const contractDir = path.join(root, 'frontend/lib/finance');
const extras = JSON.parse(fs.readFileSync(path.join(here, 'baseline-catalog-extras.json'), 'utf8'));
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sortName = (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

function locate(sql, name) {
  const re = new RegExp(`^CREATE OR REPLACE FUNCTION ${name}\\(`, 'gm');
  let m;
  let last;
  while ((m = re.exec(sql))) last = m;
  if (!last) throw new Error(`Missing function: ${name}`);
  const start = last.index;
  const tagMatch = /\bAS (\$[a-zA-Z0-9_]*\$)/.exec(sql.slice(start, start + 300));
  if (!tagMatch) throw new Error(`Missing SQL body tag: ${name}`);
  const tag = tagMatch[1];
  const open = sql.indexOf(tag, start) + tag.length;
  const closeMarker = `END ${tag};`;
  const close = sql.indexOf(closeMarker, open);
  if (close < 0) throw new Error(`Missing SQL body close: ${name}`);
  const end = close + closeMarker.length;
  const source = sql.slice(open, close + 'END '.length);
  const fragment = sql.slice(start, end);
  const literalStartMarker = "DECLARE expected jsonb := '";
  const literalStart = fragment.indexOf(literalStartMarker);
  const literalEnd = fragment.lastIndexOf("'::jsonb; e jsonb");
  if (literalStart < 0 || literalEnd < literalStart) throw new Error(`Missing contract literal: ${name}`);
  const contract = JSON.parse(fragment.slice(literalStart + literalStartMarker.length, literalEnd).replaceAll("''", "'"));
  const contractHash = sha(contract);
  const declaredHash = [...fragment.matchAll(/'contractHash','([0-9a-f]{64})'/g)].at(-1)?.[1];
  // SQL 257's recognition guard had a stale display hash even before this
  // change. Its frozen JSON and VAT dependency still match the installed
  // source. Correct this display hash while rebuilding the contract.
  const known257Mismatch = name === 'finance_assert_r1_definitions'
    && contract.version === 'r1-recognition-installation-v1-e257-e257'
    && contractHash === 'ea054268e03bd043875532d0af2fc3442d43785749448e133ec4323c6b856429'
    && declaredHash === 'c3c4cc6c0fdabd2895b9d73d6328877545f9992ada3bd7600990d5f8035673d1';
  if (!declaredHash || (declaredHash !== contractHash && !known257Mismatch)) {
    throw new Error(`Contract hash mismatch: ${name} computed=${contractHash} declared=${declaredHash}`);
  }
  const hashMarker = `'contractHash','${declaredHash}'`;
  return { start, end, source, fragment, contract, contractHash, literalStart, literalEnd, literalStartMarker, hashMarker };
}

function addExistingMembers(contract, kind) {
  const byName = new Map(contract.installation.structures.map(x => [x.name, x]));
  const targets = kind === 'vat'
    ? [['card_transactions', 'columns'], ['card_transactions', 'indexes'], ['tax_invoices', 'columns']]
    : [['journal_accounts', 'columns']];
  for (const [table, member] of targets) {
    const relation = byName.get(table);
    if (!relation) throw new Error(`Missing protected relation: ${table}`);
    for (const row of extras[table][member]) {
      const existing = relation[member].find(x => x.name === row.name);
      if (existing) {
        if (!isDeepStrictEqual(existing, row)) throw new Error(`Catalog mismatch: ${table}.${row.name}`);
      } else {
        relation[member].push(row);
      }
    }
    relation[member].sort(member === 'columns' ? (a, b) => a.position - b.position : sortName);
  }
}

function patch(sql, name, mutate) {
  const found = locate(sql, name);
  mutate(found.contract, found);
  const newHash = sha(found.contract);
  const oldLiteral = found.fragment.slice(found.literalStart + found.literalStartMarker.length, found.literalEnd);
  const newLiteral = JSON.stringify(found.contract).replaceAll("'", "''");
  let fragment = found.fragment.slice(0, found.literalStart + found.literalStartMarker.length)
    + newLiteral + found.fragment.slice(found.literalEnd);
  const oldHashMarker = found.hashMarker;
  const newHashMarker = `'contractHash','${newHash}'`;
  const hashAt = fragment.lastIndexOf(oldHashMarker);
  if (hashAt < 0) throw new Error(`Missing return hash: ${name}`);
  fragment = fragment.slice(0, hashAt) + newHashMarker + fragment.slice(hashAt + oldHashMarker.length);
  const updated = sql.slice(0, found.start) + fragment + sql.slice(found.end);
  const verify = locate(updated, name);
  if (verify.contractHash !== newHash || verify.fragment.includes(oldLiteral) && oldLiteral !== newLiteral) {
    throw new Error(`Guard regeneration failed: ${name}`);
  }
  return { sql: updated, contract: verify.contract, hash: newHash, source: verify.source };
}

const files = [257, 258, 260, 263, 264];
const results = new Map();
for (const number of files) {
  const file = fs.readdirSync(sqlDir).find(x => x.startsWith(`${number}_`) && x.endsWith('.sql'));
  if (!file) throw new Error(`Missing SQL ${number}`);
  const fullPath = path.join(sqlDir, file);
  let sql = fs.readFileSync(fullPath, 'utf8');
  const guards = {};
  if (number !== 264) {
    const vat = patch(sql, 'finance_assert_vat_use_definitions', c => addExistingMembers(c, 'vat'));
    sql = vat.sql;
    guards.vat = vat;
    const r1 = patch(sql, 'finance_assert_r1_definitions', (c, old) => {
      const dependency = c.functions.find(x => x.name === 'finance_assert_vat_use_definitions');
      if (!dependency || dependency.source !== locate(fs.readFileSync(fullPath, 'utf8'), 'finance_assert_vat_use_definitions').source) {
        throw new Error(`Recognition/VAT dependency mismatch in ${file}`);
      }
      dependency.source = vat.source;
    });
    sql = r1.sql;
    guards.r1 = r1;
  }
  if (number === 263 || number === 264) {
    const journal = patch(sql, 'finance_assert_journal_use_definitions', c => addExistingMembers(c, 'journal'));
    sql = journal.sql;
    guards.journal = journal;
  }
  fs.writeFileSync(fullPath, sql);
  results.set(number, guards);
  process.stdout.write(`${file}: ${Object.entries(guards).map(([key, value]) => `${key}=${value.hash}`).join(' ')}\n`);
}

for (const [name, guard] of [
  ['vat-use', results.get(263).vat],
  ['recognition', results.get(263).r1],
  ['journal-use', results.get(264).journal],
]) {
  const file = path.join(contractDir, `${name}-definition-contract.json`);
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  document.contract = guard.contract;
  document.contractHash = guard.hash;
  document.guard.source = guard.source;
  fs.writeFileSync(file, JSON.stringify(document, null, 2) + '\n');
}
