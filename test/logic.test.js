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
  addLines, lineOwners, receiptShares, receiptLinesTotal, receiptUnassigned, translateItem,
  tripTotals, settlements, unitList, unitTotals, groupOf, groupMembers, everyoneNow, syncAllFlag
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
  receipts: [], groups: [], model: 'claude-opus-5'
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

console.log('\ntranslating item names');
check('single word', S.translateItem('Branzino'), 'Sea bass');
check('accents ignored', S.translateItem('Caffè'), 'Espresso');
check('phrase beats single words', S.translateItem('Frutti di mare'), 'Seafood');
check('glue words read naturally', S.translateItem('Pasta al ragu'), 'Pasta with meat sauce');
check('preparation moves to the front', S.translateItem('Branzino alla griglia'), 'Grilled sea bass');
check('wine colour leads', S.translateItem('Vino rosso'), 'Red wine');
check('coffee with liquor reads as one thing', S.translateItem('Caffe corretto'), 'Espresso with liquor');
check('leading quantity dropped', S.translateItem('2 x Birra media'), 'Medium beer');
check('receipt wording', S.translateItem('Coperto'), 'Cover charge');
check('unknown word left alone', S.translateItem('Zzzqq'), null);
check('mostly unknown gives nothing', S.translateItem('Zzzqq Ppplk Mmmnn vino'), null);
check('already english gives nothing', S.translateItem('Pizza'), null);
check('empty input', S.translateItem(''), null);
check('repeated noun collapses', S.translateItem('Calice vino bianco'), 'Glass of white wine');
check('glossary noun yields to the fuller one', S.translateItem('Risotto ai funghi porcini'), 'Risotto with porcini mushrooms');
check('stranded joining word dropped', S.translateItem('Melanzane alla parmigiana'), 'Aubergine bake');
check('curly apostrophe splits words', S.translateItem('Penne all\u2019arrabbiata'), 'Penne with spicy tomato');
check('straight apostrophe splits words', S.translateItem("Penne all'arrabbiata"), 'Penne with spicy tomato');
check('named dish beats word by word', S.translateItem('Bistecca alla fiorentina'), 'T-bone steak');
check('house wine', S.translateItem('Vino rosso della casa'), 'House red wine');

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
check('lines carry a translation', r1.lines.map(l => l.en), ['Pasta with meat sauce', 'Sea bass', 'House wine', 'Cover charge']);
check('un-notated lines queue up', S.receiptUnassigned(r1), 30);
check('shared item is suggested', S.suggestShared('Coperto'), true);

r1.lines[2].assigned = S.everyoneNow();   // the wine, tapped Everyone
r1.lines[3].assigned = S.everyoneNow();   // coperto, tapped Everyone
r1.lines.forEach(l => S.syncAllFlag(l));
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
odd.lines.forEach(l => { l.assigned = S.everyoneNow(); S.syncAllFlag(l); });
const oddShares = S.receiptShares(odd);
check('three-way split adds back exactly', S.round2(Object.values(oddShares).reduce((a, b) => a + b, 0)), 5.01);
check('odd cents spread, not dumped on one person', Object.values(oddShares).map(v => S.round2(v)).sort(), [1.66, 1.67, 1.68]);
odd.extra = '1,00';
check('tip leaves no remainder', S.round2(Object.values(S.receiptShares(odd)).reduce((a, b) => a + b, 0)), 6.01);

console.log('\nsettling across two receipts');
const r2 = { id: 'r2', place: 'Bar Centrale', date: '2026-09-21', payerId: 'p2', lines: [], extra: '', statedTotal: '' };
S.state.receipts.push(r2);
S.addLines(r2, [{ desc: 'Caffe x3 ALL', amount: 9, qty: 3, note: '' }]);
check('claude translation wins over the glossary', (() => {
  const t = { id: 'rt', lines: [] };
  S.addLines(t, [{ desc: 'Tagliata di manzo', en: 'Sliced beef steak', amount: 24, qty: 1, note: '' }]);
  return t.lines[0].en;
})(), 'Sliced beef steak');
check('shared marker inside description', r2.lines[0].assigned, ['p1','p2','p3']);
check('and reads back as everyone', r2.lines[0].all, true);
const t = S.tripTotals();
check('owed per person', t.owed, { p1: 27, p2: 39, p3: 13 });
check('paid per person', t.paid, { p1: 70, p2: 9, p3: 0 });
const moves = S.settlements();
check('two transfers clear it', moves.length, 2);
check('every transfer nets out', S.round2(moves.reduce((s, m) => s + m.amount, 0)), 43);
check('nobody pays more than they owe', moves.every(m => m.amount > 0), true);

console.log('\ncouples and households');
/* Four travellers, two couples. Jason and Maria settle together; Tom and
   Sara settle together. */
S.state = {
  trip: { name: 'Italy 2026', rate: 1.5 },
  people: [
    { id: 'p1', name: 'Jason', tag: 'J',  colour: '#2563EB' },
    { id: 'p2', name: 'Maria', tag: 'M',  colour: '#059669' },
    { id: 'p3', name: 'Tom',   tag: 'TB', colour: '#D97706' },
    { id: 'p4', name: 'Sara',  tag: 'S',  colour: '#DC2626' }
  ],
  groups: [
    { id: 'g1', name: 'Jason & Maria', memberIds: ['p1','p2'] },
    { id: 'g2', name: 'Tom & Sara',    memberIds: ['p3','p4'] }
  ],
  receipts: [], model: 'claude-opus-5'
};

check('a person knows their household', S.groupOf('p2').name, 'Jason & Maria');
check('an ungrouped person has none', S.groupOf('nobody'), null);
check('four people settle as two units', S.unitList().map(u => u.name), ['Jason & Maria', 'Tom & Sara']);
check('each unit holds its members', S.unitList().map(u => u.memberIds), [['p1','p2'], ['p3','p4']]);

/* Jason pays the whole dinner. Each person ate their own main, the wine
   was shared four ways. */
const rc = { id: 'rc', place: 'Osteria', date: '2026-09-22', payerId: 'p1', lines: [], extra: '', statedTotal: '' };
S.state.receipts.push(rc);
S.addLines(rc, [
  { desc: 'Branzino',  amount: 26, qty: 1, note: 'J' },
  { desc: 'Carbonara', amount: 14, qty: 1, note: 'M' },
  { desc: 'Bistecca',  amount: 30, qty: 1, note: 'TB' },
  { desc: 'Risotto',   amount: 18, qty: 1, note: 'S' },
  { desc: 'Vino ALL',  amount: 40, qty: 1, note: '' }
]);
const t2 = S.tripTotals();
check('individual detail is kept', t2.owed, { p1: 36, p2: 24, p3: 40, p4: 28 });

const ut = S.unitTotals();
check('household owes the sum of its members', ut.map(u => u.owed), [60, 68]);
check('the paying partner credits the household', ut.map(u => u.paid), [128, 0]);

const m2 = S.settlements();
check('one transfer between the two couples', m2.length, 1);
check('the other couple pays as one', { from: m2[0].fromName, to: m2[0].toName, amount: m2[0].amount },
  { from: 'Tom & Sara', to: 'Jason & Maria', amount: 68 });

/* The case that prompted this: Maria pays, not Jason. The other couple
   owes exactly the same, since the household is one balance. */
rc.payerId = 'p2';
const m3 = S.settlements();
check('either partner paying gives the same result', { from: m3[0].fromName, to: m3[0].toName, amount: m3[0].amount },
  { from: 'Tom & Sara', to: 'Jason & Maria', amount: 68 });

/* Nothing moves inside a household. */
rc.payerId = 'p1';
check('no transfer between partners', S.settlements().every(m => m.from !== m.to), true);
check('couples never owe themselves', S.settlements().length, 1);

/* Everyone is a snapshot, not a standing rule. */
check('everyone marks the whole roster', rc.lines[4].assigned, ['p1','p2','p3','p4']);
check('and flags as everyone', rc.lines[4].all, true);

/* A lone traveller settles on their own alongside the couples. */
S.state.people.push({ id: 'p5', name: 'Elena', tag: 'E', colour: '#7C3AED' });
S.addLines(rc, [{ desc: 'Tiramisu', amount: 9, qty: 1, note: 'E' }]);
check('a later arrival does not join past shared lines', S.receiptShares(rc)['p5'], 9);
check('the wine stays split four ways', rc.lines[4].assigned.length, 4);
check('ungrouped person is their own unit', S.unitList().map(u => u.name), ['Jason & Maria', 'Tom & Sara', 'Elena']);
check('and owes on their own', S.unitTotals().find(u => u.name === 'Elena').owed, 9);
const m4 = S.settlements();
check('two transfers now', m4.length, 2);
check('every euro paid comes back', S.round2(m4.reduce((a, m) => a + m.amount, 0)), 77);

console.log('\ncurrency');
check('CAD conversion', S.cad(27), 'C$40.50');
check('EUR format', S.eur(27.005), '€27.01');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
