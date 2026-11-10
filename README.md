# French Rebellion

You and three bots vandalise a Parisian square full of cars and shops. Whoever does the most damage before the clock runs out wins.

Built for phones first; it also plays on a desktop browser. Plain 2D canvas, Vite and TypeScript. The whole game runs in the browser; the server only serves the files.

## Run it

Needs Node 22 or newer.

```sh
npm install
npm run dev --workspace=client     # http://localhost:5173
npm run build && npm start         # production, port 8091
```

## Branch previews

https://amxx.duendefm.work lists the branches. `/branch/frenchrebellion-fable/` runs the latest commit of this branch. `hub/hub.ts` does the builds and the proxying.

## How it plays

- Everything in the square has an energy bar. The icon at the left of the bar is the weapon that object fears (2.2 times the damage); the other weapons only do 0.7 times.
- Molotov burns cars, wood and paper. The bat shatters glass. The shotgun pierces steel and stone.
- Three characters, each 1.5 times stronger with one weapon: Moussa (bat), Yasmine (molotov), Léo (shotgun).
- Damage dealt is your score, plus a bonus for the final blow. The scoreboard updates live.

**Controls, the same on a phone and on a desktop:** tap or click the ground to walk there (a marker shows the spot); tap or click an object to walk into range and keep attacking it with the selected weapon until it is wrecked or you click elsewhere. The three buttons pick the weapon, and so do the 1 2 3 keys. The mouse wheel (or a two-finger pinch) zooms the camera.

Test hooks: `?auto=yasmine` skips the menus, `&demo=1` lets a bot play your character, `&skip=30` plays 30 seconds at once, `&screen=select` stops at the character screen.

## Where things live

| Path | What it does |
| --- | --- |
| `client/src/data.ts` | Weapons, characters, objects, their weak spots and the layout of the square |
| `client/src/game.ts` | The round: movement, attacks, damage, scores, bots |
| `client/src/render.ts` | Drawing: ground, depth-sorted sprites, energy bars, fire and smoke |
| `client/src/main.ts` | Screens, point-and-click input, scoreboard, frame loop |
| `client/src/audio.ts` | Synthesised sound effects |
| `tools/gen_art.py` | Prompts for every painted sheet, sent to Gemini 3 Pro Image through OpenRouter |
| `tools/build_art.py` | Keys the magenta backdrop, cuts the sheets and normalises character frames |
| `tools/placeholder_art.py` | Draws stand-in sheets in the same layouts, for working without the painted ones |

## Art

```sh
python tools/gen_art.py RAW '*'                    # paints every sheet into RAW (41 images, about $5.80)
python tools/placeholder_art.py RAW                # fills in stand-ins for whatever is missing
python tools/build_art.py RAW . --check CHECK_DIR  # cuts sprites into client/public/art, writes contact sheets
```

Character sheets are one row of four frames, facing the camera or facing away, always turned to the right; the game mirrors them for the left. `build_art.py` scales every sheet from its upright frame so a character has the same body size in every frame, puts the feet on one baseline and the hips on the cell centre. Look at the contact sheets before committing: `MIRROR`, `FRAME_SCALE`, `REPLACE` and `UPRIGHT` at the top of the script fix sheets that came back facing the wrong way or with one odd frame.

Painted art in `client/public/art` is generated with Gemini 3 Pro Image; if this ever ships on a store, it must be disclosed as AI-generated.
