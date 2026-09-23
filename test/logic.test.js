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
  tripTotals, settlements, unitList, unitTotals, groupOf, groupMembers, everyoneNow, syncAllFlag,
  receiptRate, receiptHasActual, receiptGrandEur, blendedRate, hydrate, validateBackup,
  mergeTrips, later, tripRate, cadAt
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

console.log('\nreceipt layouts a till actually prints');
const lay = (...rows) => S.parseReceiptText(rows.join('\n'));
const shape = out => out.map(l => [l.qty, l.desc, l.amount, l.note || '']);

/* The layout that failed: the item name, then quantity and price below it.
   The figure that matters is the line total, never the unit price. */
check('name above, price below', shape(lay(
  'Coperto', '4 x 3,00        12,00',
  'Bruschetta', '2 x 8,00        16,00',
  'TOTALE          28,00'
)), [[4,'Coperto','12,00',''], [2,'Bruschetta','16,00','']]);

check('one line each still works', shape(lay(
  'Coperto 3,00', 'Spaghetti vongole 16,00', 'TOTALE 19,00'
)), [[1,'Coperto','3,00',''], [1,'Spaghetti vongole','16,00','']]);

check('a dotted price column', shape(lay(
  'COPERTO.....................3,00', 'BRUSCHETTA MISTE............8,00'
)), [[1,'COPERTO','3,00',''], [1,'BRUSCHETTA MISTE','8,00','']]);

check('a euro sign is not part of the name', shape(lay(
  'Coperto  \u20ac 3,00', 'Vino della casa  \u20ac 22,00'
)), [[1,'Coperto','3,00',''], [1,'Vino della casa','22,00','']]);

check('a bare quantity in front', shape(lay(
  '4 Coperto 12,00', '2 Bruschetta 16,00'
)), [[4,'Coperto','12,00',''], [2,'Bruschetta','16,00','']]);

check('but a dish named after a number is not a quantity',
  shape(lay('Pizza 4 formaggi 9,00'))[0][1], 'Pizza 4 formaggi');

/* A VAT class column must never be read as someone's initials, or every
   line is silently assigned to whoever shares that letter. */
check('the VAT column is dropped', shape(lay(
  'COPERTO 3,00 A', 'BRUSCHETTA 8,00 A', 'VINO ROSSO 22,00 B', 'BRANZINO 26,00 A'
)).map(r => r[3]), ['', '', '', '']);

check('handwritten initials survive', shape(lay(
  'Branzino 26,00 J', 'Carbonara 14,00 M', 'Vino 22,00 ALL', 'Coperto 6,00'
)).map(r => r[3]), ['J', 'M', 'ALL', '']);

check('the shop name and address are not items', shape(lay(
  'TRATTORIA DA MARIO', 'Via Roma 14, Firenze', 'P.IVA 01234567890',
  'Coperto 3,00', 'Bruschetta 8,00'
)).map(r => r[1]), ['Coperto', 'Bruschetta']);

check('payment and total lines are left out', lay(
  'Coperto 3,00', 'TOTALE 3,00', 'CONTANTI 5,00', 'RESTO 2,00', 'Grazie e arrivederci'
).length, 1);

check('a discount keeps its sign', shape(lay(
  'Coperto 3,00', 'Sconto -2,50'
))[1], [1, 'Sconto', '-2,50', '']);

/* A real receipt, Costabella in Selva Gardena, typed exactly as printed.
   Two price columns, a continuation line, a timestamp and a grand total
   on a line of its own: every one of these produced garbage before. */
const costabella = [
  'Costabella Ristorante Pizzeria', 'Via Meisules 279', 'M.H.M SRL', 'Via Meisules 277',
  '39048 Selva Gardena', 'BZ ITALIA', 'Reg. Imp. Bz P.IVA 01686930213',
  'non vale come Fattura', 'Comanda:    65    Tavolo: 3 Bar', 'Data   :22/09/26 21.13',
  'Cameriere: Martina', 'Qta.  Descr.        Prezzo  Prezzo', '                  unitario totale',
  '4 x Coperto            2,50   10,00',
  '2 x Acqua nat          4,20    8,40',
  '1 x Weizen 0,5         6,50    6,50',
  '1 x Bic. Blaub0,2     11,00   11,00',
  '1 x Bic.Pino Grig0,   10,00   10,00',
  '1 x Tagliata manzo    28,00   28,00',
  '3 x Milanese          23,00   69,00',
  '    con dippers',
  '1 x Caprese           15,00   15,00',
  '1 x Via portata        0,00    0,00',
  '1 x Strudel+gelato     8,50    8,50',
  '                              166,40',
  'IMPORTO EURO'
].join('\n');
const cb = S.parseReceiptText(costabella);

check('ten items, no more and no fewer', cb.length, 10);
check('the line total is taken, never the unit price', cb.map(l => l.amount),
  ['10,00','8,40','6,50','11,00','10,00','28,00','69,00','15,00','0,00','8,50']);
check('quantities come through', cb.map(l => l.qty), [4,2,1,1,1,1,3,1,1,1]);
check('a continuation line rejoins its item', cb[6].desc, 'Milanese con dippers');
check('the timestamp is not an item', cb.some(l => /22\/09|21[.,]13/.test(l.desc + l.amount)), false);
check('the grand total is not an item', cb.some(l => l.amount === '166,40'), false);
check('the restaurant and its address stay out', cb.some(l => /Costabella|Meisules|Selva/i.test(l.desc)), false);
check('it reconciles to the printed total',
  S.round2(cb.reduce((t, l) => t + S.parseAmount(l.amount), 0)), 166.40);

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

console.log('\nbackup files');
check('a plain object is not a backup', S.validateBackup(null), 'That file is not a trip backup.');
check('nor is a list', S.validateBackup([1,2,3]), 'That file is not a trip backup.');
check('nor is a random json file', S.validateBackup({ hello: 'world' }), 'That file has no people and no receipts in it.');
check('broken people are rejected', S.validateBackup({ people: 'Jason', receipts: [] }), 'The people in that file are not readable.');
check('broken receipts are rejected', S.validateBackup({ people: [], receipts: 'lots' }), 'The receipts in that file are not readable.');
check('a real trip passes', S.validateBackup({ people: [{id:'p1'}], receipts: [] }), '');

/* Restoring has to cope with a file written by an older version. */
const older = {
  trip: { name: 'Italy 2025', rate: 1.4 },
  people: [{ id: 'a', name: 'Ann', tag: 'A', colour: '#2563EB' },
           { id: 'b', name: 'Ben', tag: 'B', colour: '#059669' }],
  receipts: [{ id: 'r', place: 'Bar', date: '2025-05-01', payerId: 'a', lines: [
    { id: 'l1', desc: 'Vino', amount: 20, assigned: 'ALL' },      // the old sentinel
    { id: 'l2', desc: 'Caffe', amount: 4, assigned: ['a'] }
  ]}]
};
const back = S.hydrate(older);
check('missing groups are filled in', back.groups, []);
check('the old everyone sentinel is frozen', back.receipts[0].lines[0].assigned, ['a','b']);
check('and flagged', back.receipts[0].lines[0].all, true);
check('a one-person line is not everyone', back.receipts[0].lines[1].all, false);
check('the trip details survive', [back.trip.name, back.trip.rate], ['Italy 2025', 1.4]);

/* A file with only the bare minimum still restores. */
const bare = S.hydrate({ people: [{ id: 'z', name: 'Zoe', tag: 'Z' }] });
check('missing receipts become empty', bare.receipts, []);
check('a default rate is supplied', typeof bare.trip.rate, 'number');

console.log('\nmerging two phones');
const T = (d) => '2026-09-2' + d + 'T12:00:00.000Z';
const trip = (over) => Object.assign({
  trip: { name: 'Italy 2026', rate: 1.5, updatedAt: T(0) },
  people: [], groups: [], receipts: [], deleted: {}
}, over);
const per = (id, name, at) => ({ id, name, tag: name[0], colour: '#2563EB', updatedAt: at });
const rec = (id, place, at, lines) => ({ id, place, date: '2026-09-22', payerId: '', extra: '', statedTotal: '',
  lines: lines || [{ id: id + 'l', desc: 'Vino', amount: 20, assigned: [], all: false }], updatedAt: at });

/* Each phone adds a receipt the other has never seen. Nothing may be lost. */
const phoneA = trip({ people: [per('p1','Jason',T(1))], receipts: [rec('rA','Osteria',T(2))] });
const phoneB = trip({ people: [per('p1','Jason',T(1))], receipts: [rec('rB','Bar Centrale',T(3))] });
const both = S.mergeTrips(phoneA, phoneB);
check('both receipts survive', both.receipts.map(r => r.place), ['Osteria', 'Bar Centrale']);
check('the shared person is not duplicated', both.people.length, 1);
check('merging the other way gives the same set',
  S.mergeTrips(phoneB, phoneA).receipts.map(r => r.id).sort(), ['rA','rB']);

/* The same receipt edited on both. The later edit wins, as a whole. */
const mineOld = trip({ receipts: [rec('r1','Osteria',T(1))] });
const theirsNew = trip({ receipts: [rec('r1','Osteria del Ponte',T(5))] });
check('later edit of a receipt wins', S.mergeTrips(mineOld, theirsNew).receipts[0].place, 'Osteria del Ponte');
check('and an older one does not clobber', S.mergeTrips(theirsNew, mineOld).receipts[0].place, 'Osteria del Ponte');

/* A deletion must not be undone by the other phone still holding it. */
const kept = trip({ receipts: [rec('r1','Osteria',T(1))] });
const removed = trip({ receipts: [], deleted: { receipts: { r1: T(4) } } });
check('a deletion sticks', S.mergeTrips(kept, removed).receipts.length, 0);
check('whichever way round', S.mergeTrips(removed, kept).receipts.length, 0);

/* Unless the receipt was edited again after the deletion. */
const revived = trip({ receipts: [rec('r1','Osteria',T(6))] });
check('an edit after the deletion brings it back', S.mergeTrips(revived, removed).receipts.length, 1);

/* Trip settings move as a block, latest wins. */
const rateA = trip({ trip: { name: 'Italy 2026', rate: 1.47, updatedAt: T(1) } });
const rateB = trip({ trip: { name: 'Italia', rate: 1.62, updatedAt: T(7) } });
check('later trip settings win together', [S.mergeTrips(rateA, rateB).trip.name, S.mergeTrips(rateA, rateB).trip.rate], ['Italia', 1.62]);
check('older settings are left alone', S.mergeTrips(rateB, rateA).trip.rate, 1.62);

/* Two phones handing out the same colour must not collide. */
const clashA = trip({ people: [per('p1','Jason',T(1))] });
const clashB = trip({ people: [per('p2','Maria',T(1))] });
const clashed = S.mergeTrips(clashA, clashB);
check('two people, two colours', clashed.people.length, 2);
check('and the colours differ', clashed.people[0].colour !== clashed.people[1].colour, true);

/* A household cannot outlive its members. */
const withGroup = trip({
  people: [per('p1','Jason',T(1)), per('p2','Maria',T(1))],
  groups: [{ id: 'g1', name: 'Jason & Maria', memberIds: ['p1','p2'], updatedAt: T(1) }]
});
const lostMaria = trip({ people: [per('p1','Jason',T(1))], deleted: { people: { p2: T(5) } } });
const after = S.mergeTrips(withGroup, lostMaria);
check('the removed person is gone', after.people.map(p => p.id), ['p1']);
check('and the household goes with them', after.groups.length, 0);

/* Merging a phone against itself changes nothing. */
const self = S.mergeTrips(phoneA, phoneA);
check('merging with itself is a no-op', [self.people.length, self.receipts.length], [1, 1]);

/* An empty phone simply receives everything. */
const fresh = S.mergeTrips(trip({}), phoneA);
check('an empty phone takes the lot', [fresh.people.length, fresh.receipts.length], [1, 1]);

console.log('\ncorrecting a misread amount');
/* An amount is held exactly as typed, so a half-entered figure is never
   destroyed, and every total reads it as a number. */
S.state = {
  trip: { name: 'Italy 2026', rate: 1.5 },
  people: [
    { id: 'p1', name: 'Jason', tag: 'J',  colour: '#2563EB' },
    { id: 'p2', name: 'Maria', tag: 'M',  colour: '#059669' },
    { id: 'p3', name: 'Tom',   tag: 'TB', colour: '#D97706' }
  ],
  groups: [], receipts: [], model: 'claude-opus-5'
};
const mis = { id: 'rm', place: 'Osteria', date: '2026-09-23', payerId: 'p1', lines: [], extra: '', statedTotal: '' };
S.state.receipts.push(mis);
S.addLines(mis, [
  { desc: 'Coperto', amount: 10, qty: 4, note: '' },
  { desc: 'Milanese', amount: 6.9, qty: 3, note: '' },     // 69,00 misread as 6,90
  { desc: 'Caprese', amount: 15, qty: 1, note: '' }
]);
check('the misread total', S.receiptLinesTotal(mis), 31.90);

mis.lines[1].amount = '69,00';                              // typed by hand, comma and all
check('a typed amount is kept as typed', mis.lines[1].amount, '69,00');
check('and the total reads it', S.receiptLinesTotal(mis), 94.00);

mis.lines.forEach(l => { l.assigned = S.everyoneNow(); S.syncAllFlag(l); });
const msh = S.receiptShares(mis);
check('the split follows the correction', Object.values(msh).map(v => S.round2(v)).sort(), [31.33, 31.33, 31.34]);
check('and still adds back exactly', S.round2(Object.values(msh).reduce((a,b) => a+b, 0)), 94.00);

mis.lines[1].amount = '69.';                                // mid-keystroke
check('a half-typed figure does not break the total', S.receiptLinesTotal(mis), 94.00);
mis.lines[1].amount = '';
check('an emptied amount counts as nothing', S.receiptLinesTotal(mis), 25.00);

/* The figure on screen beside a corrected line has to convert too. */
check('a typed amount still converts', S.cadAt(1.5, '69,00'), 'C$103.50');
check('so does one typed with a point', S.cadAt(1.5, '69.00'), 'C$103.50');
check('and a plain number', S.cadAt(1.5, 69), 'C$103.50');
check('an empty one shows nothing owed', S.cadAt(1.5, ''), 'C$0.00');

console.log('\nthe trip rate as typed');
/* Typed in stages, the way a thumb actually enters it. The rate is held
   as text so a half-typed figure is never destroyed, and read as a
   number wherever it is used. */
S.state.trip.rate = '1';      check('a whole number', S.tripRate(), 1);
S.state.trip.rate = '1.';     check('mid-keystroke, the point survives', S.state.trip.rate, '1.');
check('and reads as one so far', S.tripRate(), 1);
S.state.trip.rate = '1.6';    check('one decimal', S.tripRate(), 1.6);
S.state.trip.rate = '1.62';   check('two decimals', S.tripRate(), 1.62);
S.state.trip.rate = '1,62';   check('a comma works too', S.tripRate(), 1.62);
S.state.trip.rate = '';       check('empty reads as zero', S.tripRate(), 0);
S.state.trip.rate = 1.5;      check('a number from an older save still works', S.tripRate(), 1.5);

console.log('\ncurrency');
check('CAD conversion', S.cad(27), 'C$40.50');
check('EUR format', S.eur(27.005), '€27.01');

console.log('\nactual amount charged in CAD');
/* Two couples again, one receipt each. The first is paid by card and the
   statement later shows what it really cost; the second uses the trip rate. */
S.state = {
  trip: { name: 'Italy 2026', rate: 1.5 },
  people: [
    { id: 'p1', name: 'Jason', tag: 'J', colour: '#2563EB' },
    { id: 'p2', name: 'Maria', tag: 'M', colour: '#059669' }
  ],
  groups: [], receipts: [], model: 'claude-opus-5'
};
const card = { id: 'c1', place: 'Osteria', date: '2026-09-22', payerId: 'p1', lines: [], extra: '', statedTotal: '', actualCad: '' };
S.state.receipts.push(card);
S.addLines(card, [
  { desc: 'Branzino', amount: 60, qty: 1, note: 'J' },
  { desc: 'Carbonara', amount: 40, qty: 1, note: 'M' }
]);

check('no actual means the trip rate', S.receiptRate(card), 1.5);
check('and nothing claims otherwise', S.receiptHasActual(card), false);
check('trip rate drives the dollars', S.tripTotals().owedCad, { p1: 90, p2: 60 });

/* The statement says the 100 euro dinner cost 158 dollars, a wider rate
   than 1.50 once the card's spread is in. */
card.actualCad = '158,00';
check('receipt total in euros', S.receiptGrandEur(card), 100);
check('the actual sets the rate', S.receiptRate(card), 1.58);
check('and is flagged as actual', S.receiptHasActual(card), true);
check('every line converts at it', S.tripTotals().owedCad, { p1: 94.8, p2: 63.2 });
check('the dollars add back to the statement', S.round2(Object.values(S.tripTotals().owedCad).reduce((a,b)=>a+b,0)), 158);
check('euros are untouched', S.tripTotals().owed, { p1: 60, p2: 40 });
check('the payer is credited in dollars too', S.tripTotals().paidCad.p1, 158);

/* A tip is inside the receipt, so the actual covers it and the rate shifts. */
card.extra = '10,00';
check('tip is inside the converted total', S.receiptGrandEur(card), 110);
check('rate adjusts to the larger euro total', S.round2(S.receiptRate(card) * 110), 158);
card.extra = '';
card.actualCad = '158,00';

/* A second receipt with no actual keeps the trip rate. */
const cash = { id: 'c2', place: 'Bar', date: '2026-09-23', payerId: 'p2', lines: [], extra: '', statedTotal: '', actualCad: '' };
S.state.receipts.push(cash);
S.addLines(cash, [{ desc: 'Caffe', amount: 100, qty: 1, note: '' }]);
cash.lines[0].assigned = S.everyoneNow(); S.syncAllFlag(cash.lines[0]);

check('receipts convert independently', [S.receiptRate(card), S.receiptRate(cash)], [1.58, 1.5]);
check('dollars blend the two rates', S.tripTotals().owedCad, { p1: 169.8, p2: 138.2 });
check('blended rate sits between them', S.blendedRate() > 1.5 && S.blendedRate() < 1.58, true);
check('blended rate reproduces the total', S.round2(200 * S.blendedRate()), 308);
check('settlement still runs in euros', S.settlements().map(m => m.amount), [10]);

/* A nonsense entry must not poison the maths. */
card.actualCad = '0';
check('zero falls back to the trip rate', S.receiptRate(card), 1.5);
card.actualCad = 'abc';
check('junk falls back too', S.receiptRate(card), 1.5);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
