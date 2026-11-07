# AMXX Veterans

Browser sandbox for exploring characters, animation and powers together. Not a game yet.

**Stack:** plain 2D canvas and Vite on the client, Colyseus on the server, TypeScript on both sides. The server owns the game state.

## Run it

Needs Node 22 or newer.

```sh
npm install
npm run dev
```

Open http://localhost:5173 in two tabs. Dev mode connects to the game server on port 8091.

For production, `npm run build && npm start` serves the client and the game from port 8091.

## Branch previews

https://amxx.duendefm.work lists the branches. `/branch/NAME/` runs the latest commit of that branch, client and server, so a push is live on the next visit.

Each branch runs in its own Docker container with no access to the host, the LAN or the internet. `hub/hub.ts` does the builds and the proxying.

## Controls

Left click walks or picks things up, double click runs, right click swings the sword, holding right click casts lightning, space throws a fireball, M opens the inventory, and the wheel zooms. On a phone, tap walks, double tap runs, and a second finger acts as the right button.

## Where things live

| Path | What it does |
| --- | --- |
| `server/src/arena.ts` | The game: movement, fireballs, hits, knockback |
| `server/src/state.ts` | State synced to clients |
| `client/src/main.ts` | Input, avatars, animation, following the server state |
| `client/src/render.ts` | Drawing: painted ground, sprites sorted by depth, optional night lighting and rain, effects |
| `shared/forest.ts` | Generated village layout, used by server collisions and client drawing |
| `shared/areas.ts` | Village area, walkable floors, usable spots and NPCs |
| `tools/build_art.py` | Cuts the painted sheets into sprites and lays out the village |

## Adding a power

1. Add a message and the logic in `server/src/arena.ts`.
2. Add its look in `client/src/render.ts`.
3. Bind a key in `client/src/main.ts`.

## Art

The painted art in `client/public/art` was generated with Gemini 3 Pro Image. If this ever ships on Steam, it must be disclosed as AI-generated.

## Models

This repository is public, so check a model's licence before committing it. Many store licences forbid redistribution.
