#!/usr/bin/env node
// ============================================================
// BUILD — the editor as one self-contained page for claude.ai
//
// Fills editor.html with what it needs, so the page has no
// files of its own to fetch:
//
//   /*@@CITYKIT@@*/   game/src/engine/CityKit.js, verbatim: the editor builds the
//                     models with the game's own code, so what you place is
//                     what ships
//   /*@@REF@@*/       ref/<map>.json for each map (City Circuit's spaces and
//                     roads; Hundred Block Dash's path and realms)
//   @@GROUND@@        ref/city_circuit-ground.jpg as a data URL
//   /*@@LAYOUT@@*/    the layouts the game uses now (game/src/config/layouts)
//   /*@@BUILD@@*/     the game commit the models came from
//
// `game/` is the game repository as a git submodule, pinned to a commit.
//
// Refresh the reference first if the board itself changed:
//   npm run export-ref
//
// usage: npm run build [-- out.html]   (default dist/city-map-editor.html)
// ============================================================
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MAPS = ['city_circuit', 'hundred_block_dash'];
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const GAME = 'game/';

function gameLayout(map) {
    const src = read(`${GAME}src/config/layouts/${map}.js`);
    const at = src.indexOf('export default ');
    const body = src.slice(at + 'export default '.length).trim().replace(/;\s*$/, '');
    const layout = JSON.parse(body);
    const ok = layout && (Array.isArray(layout.items) || (layout.runs && typeof layout.runs === 'object'));
    if (!ok) throw new Error(`${GAME}src/config/layouts/${map}.js has no layout`);
    return layout;
}

function build(out) {
    if (!fs.existsSync(path.join(ROOT, GAME, 'src/engine/CityKit.js'))) throw new Error('game/ is empty: run `git submodule update --init`');
    let html = read('editor.html');
    const kit = read(GAME + 'src/engine/CityKit.js');
    if (/<\/script/i.test(kit)) throw new Error('CityKit.js contains "</script" and cannot be inlined');
    const refs = Object.fromEntries(MAPS.map(m => [m, JSON.parse(read(`ref/${m}.json`))]));
    const layouts = Object.fromEntries(MAPS.map(m => [m, gameLayout(m)]));
    const ground = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(ROOT, 'ref/city_circuit-ground.jpg')).toString('base64');
    let commit = 'working tree';
    try { commit = execSync('git rev-parse --short HEAD', { cwd: path.join(ROOT, GAME) }).toString().trim(); } catch (e) {}
    const info = { commit, date: new Date().toISOString().slice(0, 10) };
    const fill = (marker, text) => {
        if (!html.includes(marker)) throw new Error('editor.html is missing ' + marker);
        html = html.replace(marker, () => text);         // a function, so "$&" in the source stays literal
    };
    fill('/*@@CITYKIT@@*/', kit);
    fill('/*@@REF@@*/null', JSON.stringify(refs));
    fill('/*@@LAYOUT@@*/null', JSON.stringify(layouts));
    fill('/*@@BUILD@@*/null', JSON.stringify(info));
    fill('@@GROUND@@', ground);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html);
    return { out, bytes: html.length };
}

if (require.main === module) {
    const out = path.resolve(process.argv[2] || path.join(ROOT, 'dist/city-map-editor.html'));
    const r = build(out);
    console.log(`wrote ${path.relative(ROOT, r.out) || r.out} (${Math.round(r.bytes / 1024)} KB)`);
}
module.exports = { build };
