# French Rebellion (branch `frenchrebellion`)

A browser game made for phones first: you and three bots wreck a Parisian square for points.
Pick one of three rebels on the title screen; each is 50% stronger with one weapon
(molotov, bat or shotgun), and every car, shop and street object has its own energy and
is weaker to one kind of attack. The highest score when the clock runs out wins.

| Path | What |
|---|---|
| `client/src/main.ts` | Screens, input, drawing, HUD |
| `client/src/game.ts` | The round: rioters, bots, damage, fire, points |
| `client/src/rules.ts` | Weapons, characters, object energy and weaknesses |
| `client/src/layout.ts` | Generated: world size, sprite sizes, where objects stand |
| `tools/build_art.py` | Cuts the painted sheets into sprites and writes `layout.ts` |

The game runs entirely in the browser; the server is only there because the branch hub starts one.
