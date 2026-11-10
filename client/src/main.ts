/** Screens, input and the frame loop. */
import { play, setMuted, unlockAudio, muted } from "./audio.ts";
import { CHARS, ROUND_SECONDS, WEAPONS, WEAPON_ORDER } from "./data.ts";
import type { Weapon } from "./data.ts";
import { Game } from "./game.ts";
import type { Input } from "./game.ts";
import { artUrl, draw, loadArt, prepareDouble, toWorld } from "./render.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const context = canvas.getContext("2d")!;
const params = new URLSearchParams(location.search);

let game: Game | null = null;
let chosen = CHARS[0].id;
let width = 0, height = 0, dpr = 1;
const input: Input = { mx: 0, my: 0, attack: false, aim: null };
const keys = new Set<string>();
let stickId = -1, stickX = 0, stickY = 0, touchX = 0, touchY = 0;
let buttonHeld = false, mouseHeld = false, mouseX = 0, mouseY = 0;

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
  $<HTMLImageElement>("attack").querySelector("img")!.src = artUrl(`icon_${weapon}`);
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

  hint.innerHTML = `Wreck the square! The icon on each bar is the weapon it fears.<br>${touch ? "Drag to move · red button attacks" : "WASD move · click or Space attacks · 1 2 3 weapons"}`;
  hint.style.opacity = "1";
  setTimeout(() => { hint.style.opacity = "0"; }, 6500);
  lastBoard = "";
}

$("begin").addEventListener("click", () => { unlockAudio(); play("pick"); show("select"); });
$("go").addEventListener("click", () => { unlockAudio(); start(); });
$("again").addEventListener("click", () => { game = null; show("select"); });
$("mute").addEventListener("click", () => { unlockAudio(); setMuted(!muted); $("mute").classList.toggle("off", muted); });

// ---------------------------------------------------------------- input
window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  keys.add(event.code);
  if (event.code.startsWith("Digit")) {
    const weapon = WEAPON_ORDER[Number(event.code.slice(5)) - 1];
    if (weapon) setWeapon(weapon);
  }
  if ((event.code === "KeyQ" || event.code === "KeyE") && game) {
    const step = event.code === "KeyE" ? 1 : 2;
    setWeapon(WEAPON_ORDER[(WEAPON_ORDER.indexOf(game.player.weapon) + step) % 3]);
  }
  if (event.code === "Space" || event.code.startsWith("Arrow")) event.preventDefault();
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => { keys.clear(); mouseHeld = buttonHeld = false; stickId = -1; });

const stick = $("stick");

canvas.addEventListener("pointerdown", (event) => {
  unlockAudio();
  if (event.pointerType === "mouse") {
    if (event.button === 0) { mouseHeld = true; mouseX = event.clientX; mouseY = event.clientY; }
    return;
  }
  if (stickId !== -1) return;
  stickId = event.pointerId; stickX = touchX = event.clientX; stickY = touchY = event.clientY;
  stick.style.left = `${stickX}px`; stick.style.top = `${stickY}px`;
  stick.classList.add("on");
});
window.addEventListener("pointermove", (event) => {
  if (event.pointerType === "mouse") { mouseX = event.clientX; mouseY = event.clientY; return; }
  if (event.pointerId !== stickId) return;
  touchX = event.clientX; touchY = event.clientY;
  const dx = touchX - stickX, dy = touchY - stickY, length = Math.hypot(dx, dy);
  // The base trails a thumb that drags past its edge, so reversing is always a short move.
  if (length > 56) { stickX += (dx / length) * (length - 56); stickY += (dy / length) * (length - 56); stick.style.left = `${stickX}px`; stick.style.top = `${stickY}px`; }
  const knob = stick.firstElementChild as HTMLElement;
  knob.style.transform = `translate(${touchX - stickX}px, ${touchY - stickY}px)`;
});
const release = (event: PointerEvent) => {
  if (event.pointerType === "mouse") { mouseHeld = false; return; }
  if (event.pointerId !== stickId) return;
  stickId = -1;
  stick.classList.remove("on");
  (stick.firstElementChild as HTMLElement).style.transform = "";
};
window.addEventListener("pointerup", release);
window.addEventListener("pointercancel", release);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

const attack = $("attack");
attack.addEventListener("pointerdown", (event) => { event.preventDefault(); unlockAudio(); buttonHeld = true; attack.classList.add("down"); attack.setPointerCapture(event.pointerId); });
for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) attack.addEventListener(type, () => { buttonHeld = false; attack.classList.remove("down"); });

function readInput() {
  let mx = 0, my = 0;

  if (keys.has("KeyA") || keys.has("ArrowLeft")) mx -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) mx += 1;
  if (keys.has("KeyW") || keys.has("ArrowUp")) my -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) my += 1;
  if (stickId !== -1) {
    const dx = touchX - stickX, dy = touchY - stickY, length = Math.hypot(dx, dy);
    if (length > 9) { mx = (dx / length) * Math.min(1, length / 44); my = (dy / length) * Math.min(1, length / 44); }
  }
  input.mx = mx; input.my = my;
  input.attack = mouseHeld || buttonHeld || keys.has("Space");
  input.aim = mouseHeld ? toWorld(mouseX, mouseY) : null;
}

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
  attack.style.opacity = game.player.cooldown > 0.05 ? "0.72" : "1";
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
    readInput();
    game.update(dt, input);
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
      for (let t = 0; t < skip && game; t += 1 / 30) game.update(1 / 30, input);
    }
  }
  requestAnimationFrame(frame);
});

Object.assign(window, { frGame: () => game, ROUND_SECONDS });
