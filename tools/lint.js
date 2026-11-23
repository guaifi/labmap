#!/usr/bin/env node
/* Checks a lab file the way the page does, without a browser.
   Usage:  node tools/lint.js lab.yaml [catalog.yaml] [--write]
   - Reads both files (catalog: the given one, else defaults/catalog.yaml).
   - Prints what the page would warn about: errors (red) and warnings (amber).
   - With --write, rewrites lab.yaml in the canonical form the page writes (sorted,
     normalised, aliases turned into catalog keys), keeping a copy as lab.yaml.bak.
   Exit code: 0 no errors, 1 errors, 2 the file cannot be read.
   Meant for editing the YAML by hand or with a tool, then importing it in the page
   (Data > Import > Replace) or copying it into the data folder with the server stopped. */
'use strict';
const fs = require('fs'), path = require('path');
const L = require(path.join(__dirname, '..', 'app.js'));
const args = process.argv.slice(2), write = args.includes('--write'), files = args.filter(a => !a.startsWith('--'));
if (!files.length) { console.error('Usage: node tools/lint.js lab.yaml [catalog.yaml] [--write]'); process.exit(2); }
const [labFile, catFile] = files;
let lab, cat;
try {
  cat = L.normCatalog(L.readData(fs.readFileSync(catFile || path.join(__dirname, '..', 'defaults', 'catalog.yaml'), 'utf8')));
  L.setCatalog0(cat);
  lab = L.readData(fs.readFileSync(labFile, 'utf8'));
} catch (e) { console.error('Cannot read: ' + e.message); process.exit(2); }
if (!lab || typeof lab !== 'object' || (!lab.devices && !lab.links)) { console.error('Not a lab file (devices or links missing).'); process.exit(2); }
lab.catalog = cat;
const IX = L.analyze(lab), st = L.state;
const err = IX.issues.filter(i => i.level === 'err'), warn = IX.issues.filter(i => i.level === 'warn');
const unknown = [...new Set([].concat(...Object.values(st.devices).map(d => d.ports.filter(p => !L.kindKey(p.kind)).map(p => p.kind))))];
console.log(`${Object.keys(st.devices).length} devices, ${st.links.length} cables, ${Object.keys(st.vlans).length} VLANs, ${st.ipUse.length} IP notes`);
if (unknown.length) console.log('Port types not in the catalog: ' + unknown.join(', '));
for (const [t, list] of [['ERROR', err], ['warning', warn]]) for (const i of list) console.log(`${t.padEnd(7)} ${i.msg}`);
if (!err.length && !warn.length) console.log('No issues.');
if (write) {
  fs.copyFileSync(labFile, labFile + '.bak');
  fs.writeFileSync(labFile, L.toYaml(st, true));
  console.log(`Rewritten in canonical form: ${labFile} (previous copy: ${labFile}.bak)`);
}
process.exit(err.length ? 1 : 0);
