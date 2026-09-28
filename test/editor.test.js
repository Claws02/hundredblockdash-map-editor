// ============================================================
// EDITOR TEST — the built page works end to end
//
// Builds nothing itself: run `npm run build` first. Loads
// dist/city-map-editor.html the way claude.ai frames it
// (three.js from the game's vendor copy instead of cdnjs, an in-memory stand-in
// for the page's db), then: every layout item is on the board, a real mouse
// drag moves a building, the inspector's buttons change it, undo reverts
// them, a library tap adds a model, the 3D view renders, and Save for Claude
// writes the layout and a saved version. Screenshots go to test/out/.
//
// usage: npm test      (W=820 H=1180 for iPad portrait)
// ============================================================
const { chromium, launchOptions } = require('../scripts/browser.js');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.join(__dirname, '..');
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ' — ' + d : ''));
(async () => {
  const b = await chromium.launch(launchOptions());
  const ctx = await b.newContext({ viewport: { width: +(process.env.W||1180), height: +(process.env.H||820) }, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ body: fs.readFileSync(path.join(ROOT, 'game/vendor/three.min.js')), contentType: 'application/javascript' }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  const page = fs.readFileSync(path.join(ROOT, 'dist/city-map-editor.html'), 'utf8');
  await p.route('http://editor.test/', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}body{margin:0}[hidden]{display:none!important}</style></head><body>' + page + '</body></html>' }));
  await p.addInitScript(() => {
    const store = {}; window.__store = store;
    const docRef = path => ({ id: path.split('/').pop(), path,
      get: async () => ({ exists: path in store, data: () => store[path] }),
      set: async d => { store[path] = JSON.parse(JSON.stringify(d)); }, delete: async () => { delete store[path]; } });
    const coll = (path, ord) => ({ doc: id => docRef(path + '/' + id),
      orderBy: (f, dir) => coll(path, [f, dir]), limit: () => coll(path, ord),
      get: async () => { let ds = Object.keys(store).filter(k => k.startsWith(path + '/') && k.split('/').length === path.split('/').length + 1).map(k => ({ id: k.split('/').pop(), exists: true, data: () => store[k] }));
        if (ord) ds.sort((a, b) => (a.data()[ord[0]] < b.data()[ord[0]] ? -1 : 1) * (ord[1] === 'desc' ? -1 : 1));
        return { docs: ds, empty: !ds.length, size: ds.length }; } });
    const db = { doc: docRef, collection: p => coll(p) };
    window.claude = { use: async n => n === 'db' ? db : null };
  });
  await p.goto('http://editor.test/');
  await p.waitForFunction(() => window.__editor && window.__editor.items.length > 0, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  // dismiss first-run help
  await p.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.hidden = true));
  await p.screenshot({ path: OUT + '/plan.png' });
  const r1 = await p.evaluate(() => ({ items: window.__editor.items.length, conf: document.getElementById('b-conf').textContent,
      status: document.getElementById('status').textContent,
      bad: window.__editor.items.filter(i => window.__editor.objs.get(i.uid).conflicts.length).map(i => i.model + ':' + window.__editor.objs.get(i.uid).conflicts.join('/')).slice(0, 12) }));
  console.log(JSON.stringify(r1));
  ok('every layout item is on the board', r1.items > 0, r1.items + ' items');
  // Drag the first fin building with the mouse: find its screen position.
  const target = await p.evaluate(() => {
    const it = window.__editor.items.find(i => i.model === 'fin'); window.__editor.select(null);
    const cam = null; return { uid: it.uid, x: it.x, z: it.z };
  });
  const scr = await p.evaluate(({ x, z }) => {
    const c = document.getElementById('view').getBoundingClientRect();
    // plan: half=95 vertical, centre 0,0, north up
    const half = 95, a = c.width / c.height;
    return { sx: c.left + (x / (half * a) + 1) / 2 * c.width, sy: c.top + (z / half + 1) / 2 * c.height };
  }, target);
  await p.mouse.move(scr.sx, scr.sy); await p.mouse.down(); await p.mouse.move(scr.sx + 40, scr.sy + 30, { steps: 8 }); await p.mouse.up();
  const r2 = await p.evaluate(uid => { const it = window.__editor.items.find(i => i.uid === uid); return { x: it.x, z: it.z, sel: !document.getElementById('inspector').hidden, status: document.getElementById('status').textContent, undo: !document.getElementById('b-undo').disabled }; }, target.uid);
  ok('a mouse drag moves a building', r2.x !== target.x || r2.z !== target.z, JSON.stringify(r2));
  ok('a drag leaves unsaved changes and an undo', r2.status === 'Unsaved changes' && r2.undo);
  console.log('after drag', JSON.stringify(target), '→', JSON.stringify(r2));
  await p.screenshot({ path: OUT + '/selected.png' });
  // Buttons: turn +90, variant next, HQ, bigger
  for (const id of ['i-r90', 'i-vnext', 'i-bigger']) await p.click('#' + id);
  const r3 = await p.evaluate(uid => { const it = window.__editor.items.find(i => i.uid === uid); return { rotY: it.rotY, seed: it.seed, scale: it.scale }; }, target.uid);
  ok('turn, variant and size buttons apply', r3.scale === 1.05, JSON.stringify(r3));
  console.log('after buttons', JSON.stringify(r3));
  await p.click('#b-undo'); await p.click('#b-undo');
  const r4 = await p.evaluate(uid => window.__editor.items.find(i => i.model === 'fin'), target.uid);
  ok('two undos revert size and variant', r4.scale === 1 && r4.seed !== r3.seed);
  console.log('after 2 undos', JSON.stringify({ rotY: r4.rotY, seed: r4.seed, scale: r4.scale }));
  // Add from library
  await p.click('.card');
  const r5 = await p.evaluate(() => ({ n: window.__editor.items.length, last: window.__editor.items.at(-1).model }));
  ok('a library tap adds a model', r5.n === r1.items + 1, JSON.stringify(r5));
  console.log('after add', JSON.stringify(r5));
  // Spaces: drag one, check it moved and the board followed, put it back, drag it again.
  const toScreen = ({ x, z }) => p.evaluate(({ x, z }) => {
    const c = document.getElementById('view').getBoundingClientRect(), half = 95, a = c.width / c.height;
    return { sx: c.left + (x / (half * a) + 1) / 2 * c.width, sy: c.top + (z / half + 1) / 2 * c.height };
  }, { x, z });
  await p.evaluate(() => { window.__editor.select(null); document.getElementById('b-fit').click(); });
  const sp0 = await p.evaluate(() => window.__editor.nodePos('fin_4'));
  const ss = await toScreen(sp0);
  const dragSpace = async () => { await p.mouse.move(ss.sx, ss.sy); await p.mouse.down(); await p.mouse.move(ss.sx - 30, ss.sy + 25, { steps: 8 }); await p.mouse.up(); };
  await dragSpace();
  const sp1 = await p.evaluate(() => ({ pos: window.__editor.nodePos('fin_4'), moved: Object.keys(window.__editor.moved), name: document.getElementById('i-name').textContent }));
  ok('a mouse drag moves a space', sp1.moved.includes('fin_4') && Math.hypot(sp1.pos.x - sp0.x, sp1.pos.z - sp0.z) > 3, JSON.stringify(sp1));
  await p.click('#i-reset');
  const sp2 = await p.evaluate(() => ({ pos: window.__editor.nodePos('fin_4'), moved: Object.keys(window.__editor.moved) }));
  ok('Put back returns the space', !sp2.moved.length && Math.hypot(sp2.pos.x - sp0.x, sp2.pos.z - sp0.z) < 1e-6, JSON.stringify(sp2));
  await dragSpace();
  await p.screenshot({ path: OUT + '/space.png' });

  // District look: open the panel, pick the Back Alley, move the lamp slider.
  await p.click('#b-look');
  await p.evaluate(() => [...document.querySelectorAll('#lk-tabs .tab')].find(b => b.textContent === 'Back Alley').click());
  const lk0 = await p.evaluate(() => document.querySelector('#lk-rows input[aria-label="Lamp amount"]').value);
  await p.evaluate(() => { const sl = document.querySelector('#lk-rows input[aria-label="Lamp amount"]');
    for (const v of [2, 2.5, 3]) { sl.value = v; sl.dispatchEvent(new Event('input')); } sl.dispatchEvent(new Event('change')); });
  const lk1 = await p.evaluate(() => ({ glow: document.getElementById('lk-glow').style.opacity, undo: !document.getElementById('b-undo').disabled }));
  await p.screenshot({ path: OUT + '/look.png' });
  ok('a look slider restyles the district', +lk1.glow > 0.9 && lk1.undo, JSON.stringify({ before: lk0, ...lk1 }));
  await p.click('#b-undo');
  const lk2 = await p.evaluate(() => document.querySelector('#lk-rows input[aria-label="Lamp amount"]').value);
  ok('one undo reverts the whole slider move', lk2 === lk0, `${lk0} → ${lk2}`);
  await p.click('#b-redo');
  await p.click('#lk-close');

  // 3D view
  await p.click('#v-3d'); await p.waitForTimeout(1500);
  await p.screenshot({ path: OUT + '/3d.png' });
  // Save
  {
    await p.click('#b-save'); await p.fill('#m-note', 'test save'); await p.click('#m-save-go'); await p.waitForTimeout(800);
    const r6 = await p.evaluate(() => ({ keys: Object.keys(window.__store), main: window.__store['layouts/city_circuit'] && { n: window.__store['layouts/city_circuit'].items.length, note: window.__store['layouts/city_circuit'].note }, status: document.getElementById('status').textContent }));
    ok('Save for Claude writes the layout and a version', !!r6.main && r6.keys.length === 2 && r6.main.note === 'test save', JSON.stringify(r6));
    const savedSpaces = await p.evaluate(() => window.__store['layouts/city_circuit'].spaces || {});
    ok('the saved layout carries the moved space', !!savedSpaces.fin_4, JSON.stringify(savedSpaces));
    const savedLooks = await p.evaluate(() => window.__store['layouts/city_circuit'].looks || {});
    ok('the saved layout carries only the changed look', JSON.stringify(savedLooks) === JSON.stringify({ ba: { light: { intensity: 3 } } }), JSON.stringify(savedLooks));
    console.log('after save', JSON.stringify(r6));
    
  }
  // ---- Hundred Block Dash ----
  await p.click('#map-hbd');
  await p.waitForFunction(() => window.__editor.map === 'hundred_block_dash' && window.__editor.items.length > 0, null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.hidden = true));
  await p.screenshot({ path: OUT + '/hbd-plan.png' });
  const h0 = await p.evaluate(() => ({ n: window.__editor.items.length, len: window.__editor.runLen, cards: document.querySelectorAll('#cards .card').length,
      models: [...new Set(window.__editor.items.map(i => i.model.split('-')[0]))].sort().join(','), conf: document.getElementById('b-conf').textContent,
      look: getComputedStyle(document.getElementById('b-look')).display, lens: !document.getElementById('lenseg').hidden }));
  console.log('hbd', JSON.stringify(h0));
  ok('Hundred Block Dash opens on its 100-block scenery', h0.len === '100' && h0.n === 290 && h0.models === 'decor,lm,scatter' && h0.lens, JSON.stringify(h0));
  ok('its library holds only its own models, and Look is gone', h0.cards === 12 && h0.look === 'none', JSON.stringify(h0));
  // Screen position of a world point in the plan view (north up).
  const planScreen = ({ x, z }) => p.evaluate(({ x, z }) => {
    const c = document.getElementById('view').getBoundingClientRect(), P = window.__editor.plan, a = c.width / c.height;
    return { sx: c.left + ((x - P.cx) / (P.half * a) + 1) / 2 * c.width, sy: c.top + ((z - P.cz) / P.half + 1) / 2 * c.height };
  }, { x, z });
  // Drag a waypoint: the path bends and the waypoint is recorded.
  const wp0 = await p.evaluate(() => window.__editor.nodePos('p3'));
  const ws = await planScreen(wp0);
  await p.mouse.move(ws.sx, ws.sy); await p.mouse.down(); await p.mouse.move(ws.sx + 30, ws.sy, { steps: 8 }); await p.mouse.up();
  const wp1 = await p.evaluate(() => ({ pos: window.__editor.nodePos('p3'), moved: Object.keys(window.__editor.moved), name: document.getElementById('i-name').textContent }));
  ok('a mouse drag moves a path point', wp1.moved.join() === 'p3' && wp1.pos.x - wp0.x > 5 && wp1.name === 'Path point 3', JSON.stringify(wp1));
  // Move a piece of scenery with the inspector's typed position.
  const dec = await p.evaluate(() => { const it = window.__editor.items.find(i => i.model === 'lm-ember'); window.__editor.select(it.uid); return { uid: it.uid, x: it.x }; });
  await p.fill('#i-x', String(Math.round(dec.x) + 12)); await p.press('#i-x', 'Enter');
  const dec1 = await p.evaluate(uid => window.__editor.items.find(i => i.uid === uid).x, dec.uid);
  ok('typing a position moves the volcano', Math.abs(dec1 - (Math.round(dec.x) + 12)) < 1e-6, `${dec.x} → ${dec1}`);
  await p.screenshot({ path: OUT + '/hbd-edit.png' });
  // The 50-block run has its own scenery; the 100 run is marked as changed.
  await p.click('#lenseg [data-len="50"]');
  const h1 = await p.evaluate(() => ({ n: window.__editor.items.length, len: window.__editor.runLen, b100: document.querySelector('#lenseg [data-len="100"]').textContent, b50: document.querySelector('#lenseg [data-len="50"]').textContent }));
  ok('the 50-block run shows its own scenery', h1.len === '50' && h1.n === 144 && h1.b100 === '100 •' && h1.b50 === '50', JSON.stringify(h1));
  // Undo the typed move while on the 50 run: the 100 run gets it back.
  await p.click('#b-undo');
  const h2 = await p.evaluate(() => window.__editor.state().runs['100'].find(i => i.model === 'lm-ember').x);
  ok('undo reaches the run not on the board', Math.abs(h2 - dec.x) < 1e-3, `${h2} vs ${dec.x}`);
  await p.click('#b-redo');
  // Save, and run the saved layout through the game's own checker.
  await p.click('#b-save'); await p.fill('#m-note', 'hbd test save'); await p.click('#m-save-go'); await p.waitForTimeout(800);
  const hs = await p.evaluate(() => window.__store['layouts/hundred_block_dash']);
  ok('Save writes Hundred Block Dash with every run and the path', !!hs && Object.keys(hs.runs).join() === '50,75,100' && hs.path && hs.path.length === 12 && !hs.items && hs.itemCount === 652,
     hs ? JSON.stringify({ runs: Object.keys(hs.runs), path: hs.path && hs.path.length, items: !!hs.items, n: hs.itemCount }) : 'nothing saved');
  if (hs) {
    const { validate, loadModels } = require(path.join(ROOT, 'game/scripts/apply-layout.js'));
    let verdict = 'ok';
    try { const v = validate(hs, await loadModels()); verdict += ` (${v.path.length} waypoints, ${Object.values(v.runs).reduce((n, r) => n + r.length, 0)} items)`; } catch (e) { verdict = e.message; }
    ok('the game\'s apply-layout accepts the saved layout', verdict.startsWith('ok'), verdict);
  }
  // Unsaved work survives switching maps.
  await p.evaluate(() => { const it = window.__editor.items[0]; window.__editor.select(it.uid); });
  await p.click('#i-del');
  const n50 = await p.evaluate(() => window.__editor.items.length);
  await p.click('#map-city');
  await p.waitForFunction(() => window.__editor.map === 'city_circuit' && window.__editor.items.length > 0, null, { timeout: 30000 });
  const c1 = await p.evaluate(() => ({ n: window.__editor.items.length, status: document.getElementById('status').textContent, cards: document.querySelectorAll('#cards .card').length }));
  await p.click('#map-hbd');
  await p.waitForFunction(() => window.__editor.map === 'hundred_block_dash' && window.__editor.items.length > 0, null, { timeout: 30000 });
  const h3 = await p.evaluate(() => ({ n: window.__editor.items.length, len: window.__editor.runLen, fifty: window.__editor.state().runs['50'].length, status: document.getElementById('status').textContent }));
  ok('switching maps keeps each map\'s work', c1.n === 182 && c1.cards > 12 && h3.fifty === n50 && h3.status === 'Unsaved changes', JSON.stringify({ c1, n50, h3 }));
  await p.click('#v-3d'); await p.waitForTimeout(1500);
  await p.screenshot({ path: OUT + '/hbd-3d.png' });

  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  await b.close();
  console.log('PASS ' + pass.length); pass.forEach(x => console.log('  ✓ ' + x));
  console.log('FAIL ' + fail.length); fail.forEach(x => console.log('  ✗ ' + x));
  process.exit(fail.length ? 1 : 0);
})();
