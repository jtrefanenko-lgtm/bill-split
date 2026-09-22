/* Loads the app's script block into a stubbed DOM and exercises the
   money maths, notation matching and receipt text parsing.
   Run with: node test/logic.test.js  */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

const stubEl = () => new Proxy({}, {
  get: (t, k) => k === 'classList' ? { toggle(){}, add(){}, remove(){} }
    : k === 'style' ? {}
    : k === 'value' ? ''
    : k === 'files' ? []
    : typeof k === 'string' && ['textContent','innerHTML','src','href','download','width','height'].includes(k) ? ''
    : () => stubEl(),
  set: () => true
});
const store = {};
const sandbox = {
  console,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: {
    addEventListener(){}, getElementById: () => stubEl(),
    querySelectorAll: () => [], createElement: () => stubEl(),
    body: stubEl(), head: stubEl()
  },
  navigator: {}, location: { protocol: 'file:' }, window: {},
  fetch: () => Promise.reject(new Error('no network in tests')),
  alert(){}, confirm: () => true, setTimeout, Image: function(){}, URL: { createObjectURL(){}, revokeObjectURL(){} }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(script, sandbox);

/* Top-level let/const live in the context's global lexical scope, not on the
   sandbox object. A second script in the same context can still see them, so
   bridge the pieces under test across. */
vm.runInContext(`globalThis.__api = {
  get state(){ return state; }, set state(v){ state = v; },
  round2, eur, cad, parseAmount, matchNotation, suggestShared, parseReceiptText,
  addLines, lineOwners, receiptShares, receiptLinesTotal, receiptUnassigned,
  tripTotals, settlements
};`, sandbox);

const S = sandbox.__api;
let pass = 0, fail = 0;
function check(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + JSON.stringify(got) + '\n       want ' + JSON.stringify(want)); }
}

/* --- fixture: three people, two receipts --- */
S.state = {
  trip: { name: 'Italy 2026', rate: 1.5 },
  people: [
    { id: 'p1', name: 'Jason',  tag: 'J',  colour: '#2563EB' },
    { id: 'p2', name: 'Maria',  tag: 'M',  colour: '#059669' },
    { id: 'p3', name: 'Tom',    tag: 'TB', colour: '#D97706' }
  ],
  receipts: [], model: 'claude-opus-5'
};

console.log('\nnotation matching');
check('initials on the line', S.matchNotation('Vino rosso J'), { ids: ['p1'], why: 'noted on receipt' });
check('two sets of initials', S.matchNotation('Tiramisu J+M'), { ids: ['p1','p2'], why: 'noted on receipt' });
check('two-letter tag', S.matchNotation('Birra TB'), { ids: ['p3'], why: 'noted on receipt' });
check('first name', S.matchNotation('Pasta maria'), { ids: ['p2'], why: 'noted on receipt' });
check('shared marker ALL', S.matchNotation('Acqua frizzante ALL'), { ids: 'ALL', why: 'marked shared' });
check('italian shared marker', S.matchNotation('Antipasto tutti'), { ids: 'ALL', why: 'marked shared' });
check('no notation returns null', S.matchNotation('Pasta al ragu'), null);
check('tag inside a word is ignored', S.matchNotation('Melanzane'), null);

console.log('\namount parsing');
check('italian decimal comma', S.parseAmount('14,50'), 14.5);
check('thousands with dot', S.parseAmount('1.234,50'), 1234.5);
check('euro sign stripped', S.parseAmount('€ 8,00'), 8);
check('negative discount', S.parseAmount('-2,50'), -2.5);

console.log('\nreceipt text parsing');
const parsed = S.parseReceiptText([
  'Pasta al ragu 14,00',
  '2 x Birra media 9,00',
  'Vino rosso 22,00 J',
  'Coperto 6,00',
  'TOTALE 51,00'
].join('\n'));
check('line count excludes total', parsed.length, 4);
check('quantity pulled out', { qty: parsed[1].qty, desc: parsed[1].desc }, { qty: 2, desc: 'Birra media' });
check('trailing notation captured', parsed[2].note, 'J');

console.log('\nsplitting one receipt');
const r1 = { id: 'r1', place: 'Trattoria', date: '2026-09-20', payerId: 'p1', lines: [], extra: '', statedTotal: '' };
S.state.receipts.push(r1);
S.addLines(r1, [
  { desc: 'Pasta al ragu', amount: 14, qty: 1, note: 'J' },     // Jason, by notation
  { desc: 'Branzino', amount: 26, qty: 1, note: 'M' },          // Maria, by notation
  { desc: 'Vino della casa', amount: 24, qty: 1, note: '' },    // no notation -> asked
  { desc: 'Coperto', amount: 6, qty: 1, note: '' }              // no notation -> asked
]);
check('notated lines auto-assigned', r1.lines.slice(0,2).map(l => l.assigned), [['p1'], ['p2']]);
check('un-notated lines queue up', S.receiptUnassigned(r1), 30);
check('shared item is suggested', S.suggestShared('Coperto'), true);

r1.lines[2].assigned = 'ALL';   // the wine, tapped Everyone
r1.lines[3].assigned = 'ALL';   // coperto, tapped Everyone
check('nothing left unassigned', S.receiptUnassigned(r1), 0);
const sh1 = S.receiptShares(r1);
check('shares split evenly where shared', sh1, { p1: 24, p2: 36, p3: 10 });
check('receipt shares add back to the receipt', S.round2(Object.values(sh1).reduce((a, b) => a + b, 0)), 70);
check('receipt total', S.receiptLinesTotal(r1), 70);

console.log('\ntip allocation');
r1.extra = '7,00';                       // typed Italian style
const withTip = S.receiptShares(r1);
check('italian comma reads as 7.00', S.round2(withTip.p1 + withTip.p2 + withTip.p3), 77);
check('tip follows each share', withTip, { p1: 26.4, p2: 39.6, p3: 11 });
r1.extra = '';

console.log('\nno cent goes missing');
const odd = { id: 'r9', place: 'Odd', date: '2026-09-22', payerId: 'p1', lines: [], extra: '', statedTotal: '' };
S.addLines(odd, [
  { desc: 'Pizza', amount: 10, qty: 1, note: '' },       // 10.00 / 3 = 3.333...
  { desc: 'Gelato', amount: 0.01, qty: 1, note: '' },    // one cent, three ways
  { desc: 'Sconto', amount: -5, qty: 1, note: '' }       // discount, three ways
]);
odd.lines.forEach(l => l.assigned = 'ALL');
const oddShares = S.receiptShares(odd);
check('three-way split adds back exactly', S.round2(Object.values(oddShares).reduce((a, b) => a + b, 0)), 5.01);
check('odd cents spread, not dumped on one person', Object.values(oddShares).map(v => S.round2(v)).sort(), [1.66, 1.67, 1.68]);
odd.extra = '1,00';
check('tip leaves no remainder', S.round2(Object.values(S.receiptShares(odd)).reduce((a, b) => a + b, 0)), 6.01);

console.log('\nsettling across two receipts');
const r2 = { id: 'r2', place: 'Bar Centrale', date: '2026-09-21', payerId: 'p2', lines: [], extra: '', statedTotal: '' };
S.state.receipts.push(r2);
S.addLines(r2, [{ desc: 'Caffe x3 ALL', amount: 9, qty: 3, note: '' }]);
check('shared marker inside description', r2.lines[0].assigned, 'ALL');
const t = S.tripTotals();
check('owed per person', t.owed, { p1: 27, p2: 39, p3: 13 });
check('paid per person', t.paid, { p1: 70, p2: 9, p3: 0 });
const moves = S.settlements();
check('two transfers clear it', moves.length, 2);
check('every transfer nets out', S.round2(moves.reduce((s, m) => s + m.amount, 0)), 43);
check('nobody pays more than they owe', moves.every(m => m.amount > 0), true);

console.log('\ncurrency');
check('CAD conversion', S.cad(27), 'C$40.50');
check('EUR format', S.eur(27.005), '€27.01');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
