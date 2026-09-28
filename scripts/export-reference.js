// ============================================================
// EXPORT REFERENCE — the board, as the editor draws it underneath
//
// Serves the game (the `game/` submodule) on a local port, boots City
// Circuit with automatic placement (?nolayout), and writes what the editor
// shows as fixed reference:
//
//   ref/city_circuit.json        every node (id, original position, district,
//       junction or not), the roads as node lists, each district's run (lobe
//       ends and samples, pavement width and colour), the space radius, and
//       the bounds of...
//       (image top is -z, right is +x; it spans -half..half on both axes)
//   ref/city_circuit-ground.jpg  ...a straight-down render of the ground
//       that does not move: base, ring road, spurs, avenues, park. Spaces,
//       district pavements and the guide path follow the spaces, so the
//       editor draws those itself.
//   ref/hundred_block_dash.json  the path's waypoints, the realm of every
//       block for each run length (50, 75, 100), and each realm's ground
//       colours. Everything on that board follows the path, so the editor
//       draws all of it.
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

// Boots a map in a fresh page with automatic placement and waits for the
// first roll. ?nolayout: the map's own geometry (the layout is the editor's
// to draw); ?noopt: the static merge would strip the marks that say which
// ground follows the spaces.
async function boot(browser, map, len) {
    const ctx = await browser.newContext({ viewport: { width: PX, height: PX }, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); localStorage.setItem('hbd_seen_city_briefing', 'true'); } catch (e) {} });
    await page.goto(BASE + '?nolayout&noopt', { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.__QA, null, { timeout: 30000 });
    await page.evaluate(() => window.__QA.bind());
    await page.evaluate(([map, len]) => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map, rounds: 6, len }), [map, len]);
    const t0 = Date.now();
    while (Date.now() - t0 < 600000) {
        const st = await page.evaluate(async () => {
            (await import('/src/engine/Renderer.js')).skipFlyover();
            for (const id of ['btn-msg-continue', 'btn-cb-start', 'btn-hbd-story-begin']) { const b = document.getElementById(id); if (b && b.offsetParent) b.click(); }
            const m = document.querySelector('#modal-overlay button'); if (m && m.offsetParent) m.click();
            return window.__QA.snapshot().gameState;
        }).catch(() => '');
        if (st === 'PRE_ROLL') break;
        await page.waitForTimeout(700);
    }
    await page.waitForTimeout(2000);
    await page.evaluate(async () => { (await import('/src/engine/Renderer.js')).setBoardPaused(true); });
    return { page, ctx, errors };
}

let BASE = '';
(async () => {
    if (!fs.existsSync(path.join(GAME, 'index.html'))) throw new Error('game/ is empty: run `git submodule update --init`');
    const server = await serve();
    BASE = `http://127.0.0.1:${server.address().port}/index.html`;
    const browser = await chromium.launch(launchOptions());
    const { page, errors } = await boot(browser, 'city_circuit');

    const out = await page.evaluate(async ({ HALF }) => {
        const R = await import('/src/engine/Renderer.js');
        const AM = await import('/src/config/ActiveMap.js');
        const { state } = await import('/src/core/GameState.js');
        const sc = R.getScene();
        sc.updateMatrixWorld(true);
        const r3 = n => Math.round(n * 1000) / 1000;

        // The board: every node (original positions), the roads, and each
        // district's run (lobe ends, samples, pavement width and colour), as
        // the game describes itself.
        const board = R.qaBoardRef();
        let tileR = 0;
        const box = new THREE.Box3(), size = new THREE.Vector3();
        R.getTileMeshes().slice(0, 12).forEach(m => { box.setFromObject(m).getSize(size); tileR = Math.max(tileR, Math.max(size.x, size.z) / 2); });

        // The ground, straight down, with anything tall left out.
        const tokens = new Set(state.players.map(pl => pl.mesh).filter(Boolean));
        const dice = R.getDiceGroup();
        const tall = new THREE.Box3();
        const ground = R.qaRenderTopDown(HALF, o => {
            if (o.userData?.kit || o.userData?.followsSpaces || tokens.has(o) || o === dice) return true;
            // The board's own group (tiles, guide path, icons) and anything else
            // outside the city group moves with the spaces: the editor draws it.
            if (o.parent === sc && o.name !== 'cityEnv' && !o.isLight) return true;
            // Only the city's own pieces are judged by height: the containers
            // (the city group, the board's tile group) are tall only because
            // of what they hold.
            if (o.parent && o.parent.name === 'cityEnv' && (o.isMesh || o.isGroup)) {
                tall.setFromObject(o);
                return tall.max.y > 7;
            }
            return false;
        });
        return { ref: { map: 'city_circuit', version: 2, half: HALF, spaceR: r3(tileR), ...board }, ground };
    }, { HALF });

    const refDir = path.join(ROOT, 'ref');
    fs.mkdirSync(refDir, { recursive: true });
    fs.writeFileSync(path.join(refDir, 'city_circuit.json'), JSON.stringify(out.ref, null, 1));
    fs.writeFileSync(path.join(refDir, 'city_circuit-ground.jpg'), Buffer.from(out.ground.split(',')[1], 'base64'));
    console.log(`reference: ${out.ref.nodes.filter(n => !n.junction).length} spaces, ${out.ref.roads.length} roads, ${out.ref.runs.length} district runs, space radius ${out.ref.spaceR}`);

    // Hundred Block Dash, once per run length: the realms split the path by length.
    const hbd = { map: 'hundred_block_dash', version: 1, lengths: {} };
    for (const len of [50, 75, 100]) {
        const run = await boot(browser, 'hundred_block_dash', len);
        const r = await run.page.evaluate(async () => (await import('/src/engine/Renderer.js')).qaHbdRef());
        if (!r || r.length !== len) throw new Error(`Hundred Block Dash did not start at ${len} blocks`);
        Object.assign(hbd, { waypoints: r.waypoints, style: r.style, ribbonHalf: r.ribbonHalf, groundY: r.groundY });
        hbd.lengths[len] = r.realms;
        errors.push(...run.errors);
        await run.ctx.close();
    }
    fs.writeFileSync(path.join(refDir, 'hundred_block_dash.json'), JSON.stringify(hbd, null, 1));
    console.log(`reference: Hundred Block Dash, ${hbd.waypoints.length} waypoints, realms for ${Object.keys(hbd.lengths).join('/')} blocks`);

    console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
    await browser.close();
    server.close();
})().catch(e => { console.error(e.message || e); process.exit(1); });
