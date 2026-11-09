/* French Rebellion: title, character select, then the round. Rendering and input live here; rules in game.ts. */
import { DEPTH, Game, type Rioter, type Thing } from "./game.ts";
import { SPRITES, WORLD_H, WORLD_W } from "./layout.ts";
import { ATTACK_MS, CHARACTERS, type CharacterId, KINDS, WEAPONS, WEAPON_INFO, type Weapon } from "./rules.ts";

declare const __BUILD__: string;

const CELL_W = 300;
const CELL_H = 260;
const FEET_Y = 245;
const WALK_FRAMES = 8;
const ATTACK_FRAMES = 5;
const WALK_STRIDE = 140;
const RING_COLORS = ["#ffd23a", "#4fc3f7", "#ef5350", "#9ccc65"];

const base = import.meta.env.BASE_URL;
const art = (name: string) => `${base}art/${name}.webp?v=${__BUILD__}`;
const $ = (id: string) => document.getElementById(id)!;

function loadImage(url: string) {
  const image = new Image();

  image.src = url;
  return image.decode().then(() => image);
}

const characterIds = Object.keys(CHARACTERS) as CharacterId[];
const sheetNames = characterIds.flatMap((c) => [
  `${c}_walk_front`, `${c}_walk_back`, ...WEAPONS.flatMap((w) => [`${c}_${w}_front`, `${c}_${w}_back`]),
]);
const objectNames = Object.keys(SPRITES).flatMap((k) => [`obj_${k}`, `obj_${k}_broken`]);
const images = new Map<string, HTMLImageElement>();

const loading = Promise.all(["ground", ...sheetNames, ...objectNames].map(async (name) => images.set(name, await loadImage(art(name)))));

/* ---------------------------------------------------------------- screens */

const title = $("title");
const select = $("select");
const hud = $("hud");
const results = $("results");

for (const image of title.querySelectorAll("img")) image.src = art("title");

title.addEventListener("pointerdown", () => {
  title.hidden = true;
  select.hidden = false;
});

const cards = $("cards");
for (const id of characterIds) {
  const info = CHARACTERS[id];
  const card = document.createElement("button");

  card.className = "card";
  card.innerHTML = `<img src="${art(`card_${id}`)}" alt=""><b>${info.name}</b><span>${WEAPON_INFO[info.weapon].icon} ${info.blurb}</span>`;
  card.addEventListener("click", () => start(id));
  cards.appendChild(card);
}

$("again").addEventListener("click", () => {
  results.hidden = true;
  select.hidden = false;
});

/* ---------------------------------------------------------------- the round */

const canvas = document.querySelector("canvas")!;
const context = canvas.getContext("2d", { alpha: false })!;
const camera = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 0.7 };
let game: Game | undefined;
let lastFrame = performance.now();
let marker = { x: 0, y: 0, life: 0 };

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; glow: boolean };
type Floater = { x: number; y: number; text: string; life: number; color: string };
const particles: Particle[] = [];
const floaters: Floater[] = [];
const shots: { fromX: number; fromY: number; toX: number; toY: number; life: number }[] = [];

function start(character: CharacterId) {
  select.hidden = true;
  hud.hidden = false;
  game = new Game(character);
  particles.length = floaters.length = shots.length = 0;
  camera.zoom = Math.max(0.55, Math.min(0.95, innerWidth / 1400 + 0.25));
  renderWeapons();
}

function resize() {
  const scale = Math.min(devicePixelRatio, 2);

  canvas.width = Math.round(innerWidth * scale);
  canvas.height = Math.round(innerHeight * scale);
}
addEventListener("resize", resize);
resize();

const viewScale = () => (canvas.width / innerWidth) * camera.zoom;
const toWorld = (sx: number, sy: number) => ({
  x: camera.x + (sx - innerWidth / 2) / camera.zoom,
  y: camera.y + (sy - innerHeight / 2) / camera.zoom,
});

/* ---------------------------------------------------------------- input */

canvas.addEventListener("pointerdown", (event) => {
  if (!game || game.over) return;
  const point = toWorld(event.clientX, event.clientY);

  game.order(point.x, point.y);
  if (!game.thingAt(point.x, point.y)) marker = { x: point.x, y: point.y, life: 1 };
});
addEventListener("keydown", (event) => {
  const index = ["Digit1", "Digit2", "Digit3"].indexOf(event.code);

  if (index >= 0) chooseWeapon(WEAPONS[index]);
});
addEventListener("wheel", (event) => {
  camera.zoom = Math.min(1.4, Math.max(0.4, camera.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
});

const weaponBar = $("weapons");

function chooseWeapon(weapon: Weapon) {
  if (!game) return;
  game.player.weapon = weapon;
  renderWeapons();
}

function renderWeapons() {
  if (!game) return;
  const player = game.player;

  weaponBar.replaceChildren(...WEAPONS.map((weapon, index) => {
    const button = document.createElement("button");
    const info = WEAPON_INFO[weapon];

    button.className = `weapon${player.weapon === weapon ? " on" : ""}${CHARACTERS[player.character].weapon === weapon ? " best" : ""}`;
    button.innerHTML = `<span>${info.icon}</span><small>${index + 1} ${info.label}</small>`;
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      chooseWeapon(weapon);
    });
    return button;
  }));
}

/* ---------------------------------------------------------------- events -> effects */

function burst(x: number, y: number, count: number, color: string, speed: number, size: number, glow: boolean, up = 1) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.8);

    particles.push({ x, y, vx: Math.cos(angle) * s, vy: Math.sin(angle) * s * 0.6 - speed * 0.6 * up, life: 0, max: 0.4 + Math.random() * 0.6, size, color, glow });
  }
}

function handleEvents() {
  if (!game) return;
  for (const event of game.events) {
    if (event.type === "hit") {
      if (event.weapon === "bat") burst(event.x, event.y, 10, "#d8e6f0", 260, 3, false);
      if (event.weapon === "shotgun") burst(event.x, event.y, 14, "#ffd27a", 320, 2.5, true);
      if (event.owner === 0 && event.points > 0) floaters.push({ x: event.x, y: event.y - 20, text: `+${event.points}`, life: 1, color: "#ffe066" });
    } else if (event.type === "wreck") {
      burst(event.thing.x, event.thing.y - event.thing.h * 0.4, 40, "#c9d4dc", 380, 3.5, false);
      burst(event.thing.x, event.thing.y - event.thing.h * 0.4, 30, "#ff9a3c", 300, 4, true);
      floaters.push({
        x: event.thing.x, y: event.thing.y - event.thing.h - 10, life: 1.6,
        text: `${game.rioters[event.owner].name} wrecked the ${KINDS[event.thing.kind].label.toLowerCase()} +${event.points}`,
        color: event.owner === 0 ? "#ffe066" : "#ffffff",
      });
    } else if (event.type === "shot") {
      shots.push({ fromX: event.fromX, fromY: event.fromY, toX: event.toX, toY: event.toY, life: 0.12 });
    } else if (event.type === "splash") {
      burst(event.x, event.y, 30, "#ff8a2a", 260, 5, true);
    }
  }
  game.events.length = 0;
}

/* ---------------------------------------------------------------- drawing */

function drawThing(thing: Thing, player: Rioter) {
  const image = images.get(`obj_${thing.kind}${thing.broken ? "_broken" : ""}`)!;
  const w = image.width;
  const h = image.height;
  const left = thing.x - w / 2;
  const top = thing.y - h + 6;
  /* Fade a building that hides you */
  const covers = player.y < thing.y - 10 && player.y > top + h * 0.2 && Math.abs(player.x - thing.x) < w * 0.45 && h > 300;

  context.globalAlpha = covers ? 0.4 : 1;
  context.drawImage(image, left, top, w, h);
  if (thing.flash > 0) {
    context.globalCompositeOperation = "lighter";
    context.globalAlpha = thing.flash * 0.35;
    context.drawImage(image, left, top, w, h);
    context.globalCompositeOperation = "source-over";
  }
  context.globalAlpha = 1;

  if (thing.burn > 0 && Math.random() < 0.9) {
    const spread = Math.min(w * 0.35, 110);

    particles.push({
      x: thing.x + (Math.random() - 0.5) * spread, y: thing.y - Math.random() * Math.min(h * 0.5, 120),
      vx: (Math.random() - 0.5) * 30, vy: -60 - Math.random() * 80, life: 0, max: 0.5 + Math.random() * 0.5,
      size: 6 + Math.random() * 8, color: Math.random() < 0.7 ? "#ff7a1a" : "#ffd04a", glow: true,
    });
  }
}

function drawBar(thing: Thing, highlight: boolean) {
  if (thing.broken || (thing.hp >= thing.maxHp && !highlight)) return;
  const width = Math.min(160, Math.max(70, thing.w * 0.5));
  const x = thing.x - width / 2;
  const y = thing.y - thing.h - 14;
  const share = thing.hp / thing.maxHp;

  context.fillStyle = "rgba(0,0,0,0.65)";
  context.fillRect(x - 2, y - 2, width + 4, 12);
  context.fillStyle = share > 0.5 ? "#7bd35a" : share > 0.25 ? "#f2c230" : "#ef4b3a";
  context.fillRect(x, y, width * share, 8);
  if (highlight) {
    context.font = "600 18px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillStyle = "#fff";
    context.strokeStyle = "rgba(0,0,0,0.8)";
    context.lineWidth = 4;
    const label = KINDS[thing.kind].label;

    context.strokeText(label, thing.x, y - 8);
    context.fillText(label, thing.x, y - 8);
  }
}

function drawRioter(r: Rioter) {
  const dx = Math.sin(r.aim);
  const facesCamera = Math.cos(r.aim) >= 0;
  const side = facesCamera ? "front" : "back";
  const attacking = r.attackTime >= 0;
  const sheet = images.get(attacking ? `${r.character}_${r.weapon}_${side}` : `${r.character}_walk_${side}`)!;
  const frame = attacking
    ? Math.min(ATTACK_FRAMES - 1, Math.floor((r.attackTime / ATTACK_MS) * ATTACK_FRAMES))
    : r.moving ? Math.floor((r.walkDistance / WALK_STRIDE) * WALK_FRAMES) % WALK_FRAMES : 0;

  context.fillStyle = "rgba(0,0,0,0.35)";
  context.beginPath();
  context.ellipse(r.x, r.y, 34, 12, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = RING_COLORS[r.id];
  context.lineWidth = r.isPlayer ? 4 : 2.5;
  context.beginPath();
  context.ellipse(r.x, r.y, 38, 14, 0, 0, Math.PI * 2);
  context.stroke();

  context.save();
  context.translate(r.x, r.y);
  if (dx < 0) context.scale(-1, 1);
  context.drawImage(sheet, frame * CELL_W, 0, CELL_W, CELL_H, -CELL_W / 2, -FEET_Y, CELL_W, CELL_H);
  context.restore();

  context.font = `700 ${r.isPlayer ? 20 : 16}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.lineWidth = 4;
  context.strokeStyle = "rgba(0,0,0,0.8)";
  context.strokeText(r.name, r.x, r.y - 160);
  context.fillStyle = RING_COLORS[r.id];
  context.fillText(r.name, r.x, r.y - 160);
}

function draw(dt: number) {
  if (!game) return;
  const scale = viewScale();
  const player = game.player;

  camera.x += (player.x - camera.x) * Math.min(1, dt * 5);
  camera.y += (player.y - 80 - camera.y) * Math.min(1, dt * 5);
  const halfW = innerWidth / camera.zoom / 2;
  const halfH = innerHeight / camera.zoom / 2;

  camera.x = Math.min(WORLD_W - halfW, Math.max(halfW, camera.x));
  camera.y = Math.min(WORLD_H - halfH, Math.max(halfH - 260, camera.y));

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = "#0d0b10";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.setTransform(scale, 0, 0, scale, canvas.width / 2 - camera.x * scale, canvas.height / 2 - camera.y * scale);
  context.drawImage(images.get("ground")!, 0, 0, WORLD_W, WORLD_H);

  if (marker.life > 0) {
    marker.life -= dt * 2;
    context.strokeStyle = `rgba(255,220,120,${marker.life})`;
    context.lineWidth = 3;
    context.beginPath();
    context.ellipse(marker.x, marker.y, 20 + (1 - marker.life) * 26, (20 + (1 - marker.life) * 26) * DEPTH * 0.6, 0, 0, Math.PI * 2);
    context.stroke();
  }

  const target = game.things[player.target];
  const items: { y: number; draw: () => void }[] = [
    ...game.things.map((thing) => ({ y: thing.y, draw: () => drawThing(thing, player) })),
    ...game.rioters.map((r) => ({ y: r.y, draw: () => drawRioter(r) })),
  ];

  items.sort((a, b) => a.y - b.y);
  for (const item of items) item.draw();

  for (const b of game.bottles) {
    context.fillStyle = "#3a5a2a";
    context.beginPath();
    context.ellipse(b.x, b.y, 6, 10, b.x * 0.05, 0, Math.PI * 2);
    context.fill();
    particles.push({ x: b.x, y: b.y - 8, vx: 0, vy: -20, life: 0, max: 0.25, size: 6, color: "#ffb03a", glow: true });
  }

  context.globalCompositeOperation = "lighter";
  for (const s of shots) {
    s.life -= dt;
    context.strokeStyle = `rgba(255,220,140,${Math.max(0, s.life) * 6})`;
    context.lineWidth = 3;
    for (let i = -2; i <= 2; i++) {
      context.beginPath();
      context.moveTo(s.fromX, s.fromY);
      context.lineTo(s.toX + i * 14, s.toY + i * 6);
      context.stroke();
    }
  }
  for (const p of particles) {
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += (p.glow ? -30 : 500) * dt;
    const fade = 1 - p.life / p.max;

    if (fade <= 0) continue;
    context.globalAlpha = fade;
    context.fillStyle = p.color;
    context.globalCompositeOperation = p.glow ? "lighter" : "source-over";
    context.beginPath();
    context.arc(p.x, p.y, p.size * (p.glow ? 0.5 + fade : 1), 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life >= particles[i].max) particles.splice(i, 1);
  for (let i = shots.length - 1; i >= 0; i--) if (shots[i].life <= 0) shots.splice(i, 1);

  for (const thing of game.things) drawBar(thing, thing === target);

  for (const f of floaters) {
    f.life -= dt;
    f.y -= 40 * dt;
    context.globalAlpha = Math.max(0, Math.min(1, f.life * 2));
    context.font = "800 22px system-ui, sans-serif";
    context.textAlign = "center";
    context.lineWidth = 5;
    context.strokeStyle = "rgba(0,0,0,0.85)";
    context.strokeText(f.text, f.x, f.y);
    context.fillStyle = f.color;
    context.fillText(f.text, f.x, f.y);
  }
  context.globalAlpha = 1;
  for (let i = floaters.length - 1; i >= 0; i--) if (floaters[i].life <= 0) floaters.splice(i, 1);

  /* Night: darker edges, warm centre */
  context.setTransform(1, 0, 0, 1, 0, 0);
  const shade = context.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.35, canvas.width / 2, canvas.height / 2, Math.hypot(canvas.width, canvas.height) * 0.6);

  shade.addColorStop(0, "rgba(20,10,0,0)");
  shade.addColorStop(1, "rgba(5,3,12,0.6)");
  context.fillStyle = shade;
  context.fillRect(0, 0, canvas.width, canvas.height);
}

/* ---------------------------------------------------------------- HUD */

const board = $("board");
const clock = $("clock");
let shownBoard = "";

function updateHud() {
  if (!game) return;
  const ranking = [...game.rioters].sort((a, b) => b.score - a.score);
  const key = ranking.map((r) => `${r.id}:${Math.floor(r.score)}`).join("|");

  if (key !== shownBoard) {
    shownBoard = key;
    board.innerHTML = ranking.map((r, i) => `
      <div class="row${r.isPlayer ? " me" : ""}">
        <span class="pos">${i + 1}</span>
        <img src="${art(`face_${r.character}`)}" alt="">
        <span class="name" style="color:${RING_COLORS[r.id]}">${r.name}</span>
        <span class="score">${Math.floor(r.score).toLocaleString("en")}</span>
      </div>`).join("");
  }
  const seconds = Math.ceil(game.timeLeft);

  clock.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  clock.classList.toggle("hurry", seconds <= 20);

  if (game.over && results.hidden) {
    hud.hidden = true;
    results.hidden = false;
    const left = game.things.filter((t) => !t.broken).length;

    $("verdict").textContent = ranking[0].isPlayer ? "YOU RULE THE STREETS" : `${ranking[0].name} WINS`;
    $("summary").textContent = `${game.things.length - left} of ${game.things.length} wrecked`;
    $("final").innerHTML = ranking.map((r, i) => `<div class="${r.isPlayer ? "me" : ""}">${i + 1}. ${r.name} <b>${Math.floor(r.score).toLocaleString("en")}</b></div>`).join("");
  }
}

/* ---------------------------------------------------------------- loop */

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);

  lastFrame = now;
  if (!game) return;
  game.step(dt);
  handleEvents();
  draw(dt);
  updateHud();
}

await loading;
$("loading").hidden = true;
requestAnimationFrame(frame);
