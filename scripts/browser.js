// Finds Playwright and a Chromium to drive, for export-reference and the test.
//
// Uses a local `npm install` of playwright if there is one, otherwise a
// global install. PW_CHROMIUM points at a specific Chromium binary; without
// it, Playwright's own download is used. The WebGL flags let a headless
// Chromium with no GPU (a CI box, a cloud container) still render.
const fs = require('fs');

function load() {
    for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
        try { return require(id); } catch (e) {}
    }
    throw new Error('Playwright not found: run `npm install` (and `npx playwright install chromium`)');
}

const { chromium } = load();
const FALLBACK = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

function launchOptions() {
    const exe = process.env.PW_CHROMIUM || (fs.existsSync(FALLBACK) ? FALLBACK : undefined);
    return {
        ...(exe ? { executablePath: exe } : {}),
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
    };
}

module.exports = { chromium, launchOptions };
