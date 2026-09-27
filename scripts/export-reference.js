// ============================================================
// EXPORT REFERENCE — the board, as the editor draws it underneath
//
// Serves the game (the `game/` submodule) on a local port, boots City
// Circuit with automatic placement (?nolayout), and writes what the editor
// shows as fixed reference:
//
//   ref/city_circuit.json        every space (id, position, district),
//       the roads as centre lines, the space radius, and the bounds of...
//       (image top is -z, right is +x; it spans -half..half on both axes)
//   ref/city_circuit-ground.jpg  ...a straight-down render of the ground,
//       roads and spaces with everything tall left out.
//
// Run it when the board itself (spaces, roads, ground) changes; buildings
// don't matter here. Needs Playwright and Chromium (see scripts/browser.js).
//
// usage: npm run export-ref
// ============================================================
const { chromium, launchOptions } = require('./browser.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const ROOT = path.join(__dirname, '..');
const GAME = path.join(ROOT, 'game');
const AGENT = fs.readFileSync(path.join(GAME, 'qa/agent.js'), 'utf8');
const HALF = 138;      // world units either side of the centre in the ground image
const PX = 1400;       // ground image size

// A plain static server for the game folder, so nothing else needs running.
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
                '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
function serve() {
    const server = http.createServer((req, res) => {
        const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
        const file = path.join(GAME, rel);
        if (!file.startsWith(GAME) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

(async () => {
    if (!fs.existsSync(path.join(GAME, 'index.html'))) throw new Error('game/ is empty: run `git submodule update --init`');
    const server = await serve();
    const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
    const browser = await chromium.launch(launchOptions());
    const ctx = await browser.newContext({ viewport: { width: PX, height: PX }, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); localStorage.setItem('hbd_seen_city_briefing', 'true'); } catch (e) {} });
    await page.goto(BASE + '?nolayout', { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.__QA, null, { timeout: 30000 });
    await page.evaluate(() => window.__QA.bind());
    await page.evaluate(() => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: 'city_circuit', rounds: 6 }));
    const t0 = Date.now();
    while (Date.now() - t0 < 600000) {
        const st = await page.evaluate(async () => {
            (await import('/src/engine/Renderer.js')).skipFlyover();
            for (const id of ['btn-msg-continue', 'btn-cb-start']) { const b = document.getElementById(id); if (b && b.offsetParent) b.click(); }
            const m = document.querySelector('#modal-overlay button'); if (m && m.offsetParent) m.click();
            return window.__QA.snapshot().gameState;
        }).catch(() => '');
        if (st === 'PRE_ROLL') break;
        await page.waitForTimeout(700);
    }
    await page.waitForTimeout(2000);
    await page.evaluate(async () => { (await import('/src/engine/Renderer.js')).setBoardPaused(true); });

    const out = await page.evaluate(async ({ HALF }) => {
        const R = await import('/src/engine/Renderer.js');
        const AM = await import('/src/config/ActiveMap.js');
        const { state } = await import('/src/core/GameState.js');
        const sc = R.getScene();
        sc.updateMatrixWorld(true);
        const r3 = n => Math.round(n * 1000) / 1000;

        // The fixed reference: spaces and roads.
        const g = AM.graph();
        const spaces = AM.ordered().filter(id => !AM.isJunction(id)).map(id => {
            const v = R.getPos(id);
            // No space type: every match rolls its own, and the editor only needs where spaces are.
            return { id, x: r3(v.x), z: r3(v.z), district: g[id]?.district || 'ring' };
        });
        const roads = AM.roads().map(rd => ({ district: rd.district,
            pts: rd.nodes.map(id => { const v = R.getPos(id); return [r3(v.x), r3(v.z)]; }) }));
        let tileR = 0;
        const box = new THREE.Box3(), size = new THREE.Vector3();
        R.getTileMeshes().slice(0, 12).forEach(m => { box.setFromObject(m).getSize(size); tileR = Math.max(tileR, Math.max(size.x, size.z) / 2); });

        // The ground, straight down, with anything tall left out.
        const tokens = new Set(state.players.map(pl => pl.mesh).filter(Boolean));
        const dice = R.getDiceGroup();
        const tall = new THREE.Box3();
        const ground = R.qaRenderTopDown(HALF, o => {
            if (o.userData?.kit || tokens.has(o) || o === dice) return true;
            // Only the city's own pieces are judged by height: the containers
            // (the city group, the board's tile group) are tall only because
            // of what they hold.
            if (o.parent && o.parent.name === 'cityEnv' && (o.isMesh || o.isGroup)) {
                tall.setFromObject(o);
                return tall.max.y > 7;
            }
            return false;
        });
        return { ref: { map: 'city_circuit', half: HALF, spaceR: r3(tileR), spaces, roads }, ground };
    }, { HALF });

    const refDir = path.join(ROOT, 'ref');
    fs.mkdirSync(refDir, { recursive: true });
    fs.writeFileSync(path.join(refDir, 'city_circuit.json'), JSON.stringify(out.ref, null, 1));
    fs.writeFileSync(path.join(refDir, 'city_circuit-ground.jpg'), Buffer.from(out.ground.split(',')[1], 'base64'));
    console.log(`reference: ${out.ref.spaces.length} spaces, ${out.ref.roads.length} roads, space radius ${out.ref.spaceR}`);

    console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
    await browser.close();
    server.close();
})().catch(e => { console.error(e.message || e); process.exit(1); });
