# AMXX Veterans

Browser sandbox for exploring characters, animation and powers together. Not a game yet.

**Stack:** Three.js and Vite on the client, Colyseus on the server, TypeScript on both sides. The server owns the game state.

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

WASD or arrows move, the mouse aims, and click or space fires.

## Where things live

| Path | What it does |
| --- | --- |
| `server/src/arena.ts` | The game: movement, fireballs, hits, knockback |
| `server/src/state.ts` | State synced to clients |
| `client/src/main.ts` | Input, avatars, animation, following the server state |
| `client/src/effects.ts` | Fireball and particle effects |
| `client/src/world.ts` | Scene, lighting, ground, crates |

## Adding a power

1. Add a message and the logic in `server/src/arena.ts`.
2. Add its look in `client/src/effects.ts`.
3. Bind a key in `client/src/main.ts`.

## Models

`client/public/models/robot.glb` is RobotExpressive by Tomás Laulhé, CC0, with modifications by Don McCurdy, from the three.js examples.

This repository is public, so check a model's licence before committing it. Many store licences forbid redistribution.
