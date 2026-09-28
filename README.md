# Hundred Block Dash: map editor

Place, move, turn and resize everything that stands on City Circuit (buildings, landmarks, street props, overhead spans, lamps, benches, trees and the fountain) over the real board, then hand the layout to the game.

**Open the editor:** https://claude.ai/artifact/NuwJ1mBP2ZaybkCrjZsU7Z. It's a private claude.ai page, built for iPad and usable in any browser.

The game is [Claws02/HundredBlockDash](https://github.com/Claws02/HundredBlockDash). Its automatic plot placement put buildings on top of each other and into the spaces; on that layout the editor counts 31 buildings in conflict. This repo is the tool that puts a person in charge of placement. The game only reads the result.

## How the pieces fit

```
game/src/engine/CityKit.js ──(verbatim, at build)──► editor page ──Save for Claude──► the page's store
            ▲                                                                              │
     the game builds every                                                        read by Claude
     model from this file                                                                  ▼
            └──── game/src/config/layouts/city_circuit.js ◄── game/scripts/apply-layout.js (validates)
```

- **`game/` is the game repository, as a git submodule** pinned to a commit. The editor builds with the game's own `CityKit.js`, so what you place is exactly what ships and nothing is copied by hand.
- **Layouts are data:** `{ model, seed, hq, x, z, rotY, scale }` per item. `seed` (0–99) picks the variant (height, width, colour, options) independently of position, so moving a building never changes its look.
- **The game side** (loading layouts, the validator, the layout files) is described in the game's `docs/LAYOUTS.md`.

## Using the editor

- **Add:** tap a model in the library. It lands in the middle of the view, selected.
- **Move:** drag it with one finger.
- **Turn:** drag the gold handle. The handle marks the front, which should face the road.
- **Look around:** pinch to zoom, and drag empty ground to pan (orbit in 3D). Plan and 3D views are at the top.
- **Adjust:** the panel at the bottom holds variant, HQ, size and exact position, plus Duplicate and Delete.
- **Spaces** (the coloured hexagons) can be dragged too. The district's road and pavement follow, **Put back** returns a space to where the map puts it, and spaces packed too close together turn red. What each space *is* (coin, duel and so on) is still dealt by the game each match.
- **Look** restyles a district: sky, haze, pavement, paving slabs and seams, the district lamp and bounce light, and the drifting particles. The board shows ground and light changes as you make them; the panel's preview card shows the sky and particles. **Reset this district** returns it to the game's own look.
- **Layers** hides whole kinds of pieces (props, overheads and so on) while you arrange the rest.
- **Red** means the piece overlaps another one, or stands on a space (within about 3.1 units of its centre) or on the road (within 3 units of its centre line). The "N to fix" button walks through them.
- **Undo and redo** are there, and your work is kept on the device between saves.
- **Save for Claude** stores the layout and adds a saved version. Add a note saying what changed, then ask Claude to pull the city layout.
- **More** holds saved versions, a JSON download, and starting again from the game's current layout.

## Working on the editor

```bash
git clone --recurse-submodules https://github.com/Claws02/hundredblockdash-map-editor
npm install && npx playwright install chromium      # for export-ref and test only
npm run build          # → dist/city-map-editor.html (republish it to the editor's URL)
npm test               # the built page end to end: drag, inspector, undo, library, 3D, save
npm run export-ref     # re-capture ref/ from the game, when spaces, roads or ground change
```

| File | What it is |
|---|---|
| `editor.html` | The editor's source: markup, styles and code, with markers the build fills |
| `scripts/build.js` | Inlines `game/src/engine/CityKit.js`, `ref/`, the game's current layout and the game commit into one page |
| `scripts/export-reference.js` | Serves `game/`, boots City Circuit, and writes `ref/city_circuit.json` (spaces, roads) and a straight-down ground image |
| `ref/` | The board underneath: the ground that never moves (image), and the spaces, roads and district runs the editor draws itself (JSON) |
| `test/editor.test.js` | Drives the built page in Chromium, framed the way claude.ai frames it, against an in-memory store |

## Keeping in step with the game

When the game's models or layout change (a new model batch, or a pulled layout committed to the game), move the submodule and rebuild:

```bash
git -C game fetch && git -C game checkout <game commit>
npm run build && npm test
git commit -am "Editor: models from game <commit>"
```

Then republish `dist/city-map-editor.html` to the editor's URL; saved layouts and versions stay in the page's store. Keep the game's `MODELS` keys stable: saved layouts name models by key, and the game's validator refuses unknown ones.

## Not in this version

- The traffic (moving cars and people) is fixed.
- City Circuit only. Hundred Block Dash can follow once its realm landmarks move into the model kit.
