/* Regenerates CHANGELOG.md from js/changelog.js — the single source the app
   itself renders. Run after adding a release entry:

     NODE_OPTIONS= node make-changelog.js
*/
'use strict';

const fs = require('fs');
const path = require('path');

global.window = { HR: {} };
require('vm').runInThisContext(
  fs.readFileSync(path.join(__dirname, 'js', 'changelog.js'), 'utf8'));
const { VERSION, ENTRIES } = window.HR.changelog;

const lines = [
  '# Changelog',
  '',
  'Versions are CalVer (`YYYY.M.N` — Nth release of that month). This file is',
  'generated from `js/changelog.js` by `make-changelog.js`; edit there, not here.',
  ''
];
for (const e of ENTRIES) {
  lines.push('## [' + e.version + '] — ' + e.date, '');
  for (const c of e.changes) lines.push('- ' + c);
  lines.push('');
}

fs.writeFileSync(path.join(__dirname, 'CHANGELOG.md'), lines.join('\n'));
console.log('CHANGELOG.md written — current version ' + VERSION +
  ', ' + ENTRIES.length + ' releases.');
