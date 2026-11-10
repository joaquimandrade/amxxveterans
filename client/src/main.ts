/** Screens, input and the frame loop. */
import { play, setMuted, unlockAudio, muted } from "./audio.ts";
import { CHARS, ROUND_SECONDS, WEAPONS, WEAPON_ORDER } from "./data.ts";
import type { Weapon } from "./data.ts";
import { Game } from "./game.ts";
import { artUrl, draw, loadArt, prepareDouble, camera, toWorld, zoomBy } from "./render.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const context = canvas.getContext("2d")!;
const params = new URLSearchParams(location.search);

let game: Game | null = null;
let chosen = CHARS[0].id;
let width = 0, height = 0, dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  width = window.innerWidth; height = window.innerHeight;
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
}
window.addEventListener("resize", resize);
resize();

// ---------------------------------------------------------------- screens
function show(id: "title" | "select" | "end" | null) {
  for (const name of ["title", "select", "end"]) $(name).hidden = name !== id;
  $("hud").hidden = id === "title" || id === "select";
}

for (const element of document.querySelectorAll<HTMLElement>(".backdrop")) element.style.backgroundImage = `url(${artUrl("title_bg")})`;
$<HTMLImageElement>("logo").src = artUrl("logo");

const cast = $("cast");
for (const char of CHARS) {
  const card = document.createElement("button");

  card.className = "card";
  card.dataset.id = char.id;
  card.innerHTML = `<img class="who" src="${artUrl(`${char.id}_portrait`)}" alt=""><b>${char.name}</b><small>${char.bio}</small>
    <span class="perk"><img src="${artUrl(`icon_${char.special}`)}" alt="">${WEAPONS[char.special].label} ×1.5</span>`;
  card.addEventListener("click", () => { pick(char.id); play("pick"); });
  cast.append(card);
}

function pick(id: string) {
  chosen = id;
  for (const card of cast.children) card.classList.toggle("on", (card as HTMLElement).dataset.id === id);
}
pick(chosen);

const weaponBox = $("weapons");
WEAPON_ORDER.forEach((weapon, index) => {
  const button = document.createElement("button");

  button.dataset.weapon = weapon;
  button.title = `${WEAPONS[weapon].label}: ${WEAPONS[weapon].hint}`;
  button.innerHTML = `<img src="${artUrl(`icon_${weapon}`)}" alt="${WEAPONS[weapon].label}"><kbd>${index + 1}</kbd>`;
  button.addEventListener("pointerdown", (event) => { event.preventDefault(); setWeapon(weapon); });
  weaponBox.append(button);
});

function setWeapon(weapon: Weapon) {
  if (!game) return;
  game.player.weapon = weapon;
  for (const button of weaponBox.children) {
    const own = (button as HTMLElement).dataset.weapon as Weapon;
    button.classList.toggle("on", own === weapon);
    if (own === game.player.char.special && !button.querySelector("em")) button.insertAdjacentHTML("beforeend", "<em>×1.5</em>");
    if (own !== game.player.char.special) button.querySelector("em")?.remove();
  }
  play("pick");
}

function start() {
  game = new Game(chosen);
  for (const actor of game.actors) prepareDouble(actor.sheet);
  game.demo = params.has("demo");
  setWeapon(game.player.weapon);
  show(null);
  const hint = $("hint");
  const touch = matchMedia("(pointer: coarse)").matches;

  hint.innerHTML = `Wreck the square! The icon on each bar is the weapon it fears.<br>${touch ? "Tap the ground to walk · tap an object to wreck it" : "Click the ground to walk · click an object to wreck it · 1 2 3 weapons · wheel zooms"}`;
  hint.style.opacity = "1";
  setTimeout(() => { hint.style.opacity = "0"; }, 6500);
  lastBoard = "";
}

$("begin").addEventListener("click", () => { unlockAudio(); play("pick"); show("select"); });
$("go").addEventListener("click", () => { unlockAudio(); start(); });
$("again").addEventListener("click", () => { game = null; show("select"); });
$("mute").addEventListener("click", () => { unlockAudio(); setMuted(!muted); $("mute").classList.toggle("off", muted); });

// ---------------------------------------------------------------- input
// Point and click, the same with a mouse and with a finger: the ground is a walk order, an object an attack order.
window.addEventListener("keydown", (event) => {
  if (event.repeat || !event.code.startsWith("Digit")) return;
  const weapon = WEAPON_ORDER[Number(event.code.slice(5)) - 1];

  if (weapon) setWeapon(weapon);
});

const fingers = new Map<number, { x: number; y: number }>();
let pinch = 0;

canvas.addEventListener("pointerdown", (event) => {
  unlockAudio();
  if (event.pointerType === "mouse" && event.button !== 0) return;
  fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (fingers.size === 1 && game) {
    const point = toWorld(event.clientX, event.clientY);
    game.click(point.x, point.y);
  }
  pinch = 0;
});
window.addEventListener("pointermove", (event) => {
  const finger = fingers.get(event.pointerId);

  if (!finger) return;
  finger.x = event.clientX; finger.y = event.clientY;
  if (fingers.size !== 2) return;
  // Two fingers pinch the camera in and out.
  const [a, b] = [...fingers.values()];
  const spread = Math.hypot(a.x - b.x, a.y - b.y);

  if (pinch > 0 && spread > 0) zoomBy(spread / pinch);
  pinch = spread;
});
for (const type of ["pointerup", "pointercancel"] as const) window.addEventListener(type, (event) => { fingers.delete(event.pointerId); pinch = 0; });
window.addEventListener("blur", () => fingers.clear());
canvas.addEventListener("wheel", (event) => { event.preventDefault(); zoomBy(Math.exp(-event.deltaY * 0.0012)); }, { passive: false });
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

// ---------------------------------------------------------------- hud
let lastBoard = "";

function row(game: Game, index: number) {
  const actor = game.ranking()[index];

  return `<li class="${actor.isPlayer ? "me" : ""}"><i style="background:${actor.color}"></i><span>${index + 1}. ${actor.name}</span><b>${Math.round(actor.score)}</b></li>`;
}

function hud(game: Game) {
  const board = [0, 1, 2, 3].map((index) => row(game, index)).join("");

  if (board !== lastBoard) { $("board").innerHTML = board; lastBoard = board; }
  const seconds = Math.ceil(game.time);
  const clock = $("clock");

  clock.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  clock.classList.toggle("late", seconds <= 10);
  if (game.over && $("end").hidden && overFor > 1.1) {
    const place = game.ranking().indexOf(game.player);

    $("verdict").textContent = game.time > 0 ? "Nothing left standing!" : ["You rule the square!", "So close: 2nd", "3rd place", "Last… again?"][place];
    $("final").innerHTML = board;
    $("end").hidden = false;
  }
}

// ---------------------------------------------------------------- loop
let previous = performance.now(), overFor = 0;

function frame(now: number) {
  const dt = Math.min(0.05, (now - previous) / 1000);

  previous = now;
  if (game) {
    game.update(dt);
    overFor = game.over ? overFor + dt : 0;
    for (const sound of game.sounds) play(sound);
    game.sounds.length = 0;
    draw(context, game, width, height, dpr, now / 1000, dt);
    hud(game);
  }
  requestAnimationFrame(frame);
}

loadArt((done) => { $("loading").textContent = `Loading… ${Math.round(done * 100)}%`; }).then(() => {
  $("loading").hidden = true;
  $("begin").hidden = false;
  const auto = params.get("auto");

  if (auto) {
    pick(CHARS.some((c) => c.id === auto) ? auto : CHARS[0].id);
    if (params.get("screen") === "select") show("select");
    else {
      start();
      // Test hook: play some seconds of the round at once before the first frame.
      const skip = Number(params.get("skip") ?? 0);
      for (let t = 0; t < skip && game; t += 1 / 30) game.update(1 / 30);
    }
  }
  requestAnimationFrame(frame);
});

Object.assign(window, { frGame: () => game, frToWorld: toWorld, frToScreen: (x: number, y: number) => ({ x: (x - camera.left) * camera.zoom, y: (y - camera.top) * camera.zoom }), ROUND_SECONDS });
