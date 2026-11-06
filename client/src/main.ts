import { Client, type Room } from "@colyseus/sdk";
import { HOTSPOTS, insidePolygon } from "../../shared/areas.ts";
import { SPAWN } from "../../shared/forest.ts";
import { type Camera, type Pickable, type PlayerView, Renderer, artUrl, loadArt } from "./render.ts";

type PlayerState = {
  name: string;
  hue: number;
  x: number;
  z: number;
  aim: number;
  moving: boolean;
  running: boolean;
  hits: number;
  area: string;
  mana: number;
  weapon: string;
  inventory: string[];
};
type ShotState = { x: number; z: number; area: string };
type GroundState = { kind: string; x: number; z: number };
type ChestState = { x: number; z: number; open: boolean };

const ZOOM_MIN = 0.45;
const ZOOM_MAX = 1.25;
const DOUBLE_CLICK_MS = 320;
const HOLD_MS = 280;
const BOLT_REPEAT_MS = 560;
const PICK_RADIUS = 58;
const DEPTH_SCALE = 0.72;
const ITEM_NAMES: Record<string, string> = {
  sword: "Sword", axe: "Battle axe", potion_mana: "Mana potion", coins: "Gold coins",
  ring: "Gold ring", helmet: "Helmet", pouch: "Leather pouch",
};
const hud = document.getElementById("hud")!;
const manaFill = document.getElementById("mana-fill")!;
const panel = document.getElementById("panel")!;
const panelHint = document.getElementById("panel-hint")!;
const slots = document.getElementById("slots")!;
const fadeLayer = document.getElementById("fade")!;
const canvas = document.createElement("canvas");

const base = import.meta.env.BASE_URL;
const basePath = base.replace(/\/$/, "");
const url = import.meta.env.DEV
  ? `ws://${location.hostname}:8091`
  : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${basePath}`;

document.body.appendChild(canvas);

const [art, room] = await Promise.all([
  loadArt(base),
  new Client(url).joinOrCreate("arena") as Promise<Room>,
]);
const renderer = new Renderer(canvas, art);
const camera: Camera = { x: SPAWN.x, y: SPAWN.y, zoom: 0.8 };
const views = new Map<string, PlayerView>();
const pointer = { x: innerWidth / 2, y: innerHeight / 2 };
let cameraReady = false;
let hovered: string | undefined;
let pickables: Pickable[] = [];
let shownInventory = "";
let currentArea = "city";
let fade = 0;
let lastLeftClick = -Infinity;
let casting = false;
let holdTimer: ReturnType<typeof setTimeout> | undefined;
let holdRepeat: ReturnType<typeof setInterval> | undefined;
let lastFrame = performance.now();

function aimFromPointer() {
  const self = views.get(room.sessionId);

  if (!self) return 0;
  const target = renderer.toWorld(camera, pointer.x, pointer.y);

  return Math.atan2(target.x - self.x, target.y - self.y);
}

function updateView(id: string, player: PlayerState, dt: number) {
  let view = views.get(id);

  if (!view) {
    view = {
      x: player.x,
      y: player.z,
      aim: player.aim,
      moving: false,
      running: false,
      weapon: player.weapon,
      hue: player.hue,
      name: player.name,
      isSelf: id === room.sessionId,
      walkDistance: 0,
      slashTime: -1,
      flash: 0,
    };
    views.set(id, view);
  }

  const follow = 1 - Math.exp(-18 * dt);

  const stepX = (player.x - view.x) * follow;
  const stepY = (player.z - view.y) * follow;

  view.x += stepX;
  view.y += stepY;
  view.walkDistance = player.moving ? view.walkDistance + Math.hypot(stepX, stepY / DEPTH_SCALE) : 0;
  view.aim = player.aim;
  view.moving = player.moving;
  view.running = player.running;
  view.weapon = player.weapon;
  view.flash = Math.max(0, view.flash - dt * 4);
  if (view.slashTime >= 0) {
    view.slashTime += dt * 1000;
    if (view.slashTime > 420) view.slashTime = -1;
  }
}

function updateHud(players: Map<string, PlayerState>) {
  const rows: string[] = [];

  players.forEach((player, id) => {
    rows.push(`${id === room.sessionId ? "<b>you</b> " : ""}${player.name}: ${player.hits}`);
  });
  hud.innerHTML = `${rows.join("<br>")}<br><br>left click walk or use · double click run · right click attack · hold right lightning · space fireball · M inventory · wheel zoom`;
}

addEventListener("contextmenu", (event) => event.preventDefault());
addEventListener("pointermove", (event) => {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
});
function pickableAt(screenX: number, screenY: number) {
  const target = renderer.toWorld(camera, screenX, screenY);
  const hotspot = HOTSPOTS.find(
    (spot) => spot.area === currentArea && insidePolygon(spot.outline, target.x, target.y),
  );

  if (hotspot) return pickables.find((item) => item.id === hotspot.id);

  let best: Pickable | undefined;
  let bestDistance = PICK_RADIUS;

  for (const item of pickables) {
    if (!item.sprite) continue;
    const distance = Math.hypot(item.x - target.x, item.y - 20 - target.y);

    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

function renderInventory(player: PlayerState) {
  const key = `${player.weapon}|${[...player.inventory].join(",")}`;

  if (key === shownInventory) return;
  shownInventory = key;
  slots.replaceChildren();
  [...player.inventory].forEach((kind, index) => {
    const slot = document.createElement("button");
    const icon = document.createElement("img");
    const isWeapon = kind === "sword" || kind === "axe";
    const usable = isWeapon || kind === "potion_mana";

    slot.type = "button";
    slot.className = "slot";
    slot.title = ITEM_NAMES[kind] ?? kind;
    slot.setAttribute("aria-label", slot.title);
    slot.classList.toggle("usable", usable);
    slot.classList.toggle("equipped", isWeapon && kind === player.weapon);
    icon.src = artUrl(base, `icon_${kind}`);
    icon.alt = "";
    slot.appendChild(icon);
    if (isWeapon) slot.addEventListener("click", () => room.send("equip", kind));
    if (kind === "potion_mana") slot.addEventListener("click", () => room.send("use", index));
    slots.appendChild(slot);
  });
  panelHint.textContent = `Equipped: ${ITEM_NAMES[player.weapon]}. Click a weapon to swap, or a potion to drink. M closes.`;
}

function collectPickables() {
  const items: Map<string, GroundState> = room.state.items;
  const chests: Map<string, ChestState> = room.state.chests;
  const list: Pickable[] = HOTSPOTS.filter((spot) => spot.area === currentArea).map(
    ({ id, x, y, label }) => ({ id, x, y, label }),
  );

  if (currentArea !== "city") return list;
  items.forEach((item, id) => list.push({ id, sprite: `item_${item.kind}`, x: item.x, y: item.z }));
  chests.forEach((chest, id) => {
    list.push({ id, sprite: chest.open ? "item_chest_open" : "item_chest", x: chest.x, y: chest.z });
  });
  return list;
}

function moveToPointer(run: boolean) {
  const target = renderer.toWorld(camera, pointer.x, pointer.y);

  room.send("move", { x: target.x, z: target.y, run });
  renderer.showMarker(target.x, target.y);
}

function stopHolding() {
  clearTimeout(holdTimer);
  clearInterval(holdRepeat);
  holdTimer = holdRepeat = undefined;
}

addEventListener("pointerdown", (event) => {
  if (event.target !== canvas) return;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  if (event.button === 0) {
    const item = pickableAt(pointer.x, pointer.y);

    if (item) {
      room.send("interact", item.id);
    } else {
      moveToPointer(event.timeStamp - lastLeftClick < DOUBLE_CLICK_MS);
      lastLeftClick = event.timeStamp;
    }
  }
  if (event.button === 2) {
    casting = false;
    holdTimer = setTimeout(() => {
      casting = true;
      room.send("bolt", aimFromPointer());
      holdRepeat = setInterval(() => room.send("bolt", aimFromPointer()), BOLT_REPEAT_MS);
    }, HOLD_MS);
  }
});
addEventListener("pointerup", (event) => {
  if (event.button !== 2) return;
  stopHolding();
  if (!casting) room.send("slash", aimFromPointer());
});
addEventListener("blur", stopHolding);
addEventListener("keydown", (event) => {
  if (event.code === "Space" && !event.repeat) room.send("fire", aimFromPointer());
  if (event.code === "KeyM" && !event.repeat) panel.hidden = !panel.hidden;
  if (event.code === "Escape") panel.hidden = true;
});
addEventListener("wheel", (event) => {
  camera.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, camera.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
});
addEventListener("resize", () => renderer.resize());

room.onMessage("explode", ({ x, z, area }: { x: number; z: number; area: string }) => {
  if (area === currentArea) renderer.explode(x, z);
});
room.onMessage("hit", ({ id }: { id: string }) => {
  const view = views.get(id);

  if (view) view.flash = 1;
});
room.onMessage("slash", ({ id }: { id: string }) => {
  const view = views.get(id);

  if (view) view.slashTime = 0;
});
room.onMessage("cast", () => {});
room.onMessage("bolt", (bolt: { area: string; fromX: number; fromZ: number; toX: number; toZ: number }) => {
  if (bolt.area === currentArea) renderer.addBolt(bolt.fromX, bolt.fromZ, bolt.toX, bolt.toZ);
});

renderer.resize();

function frame(now: number) {
  requestAnimationFrame(frame);

  /* The first state patch can arrive a moment after joining */
  if (!room.state?.players || !room.state?.shots || !room.state?.items) return;

  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  const players: Map<string, PlayerState> = room.state.players;
  const shots: Map<string, ShotState> = room.state.shots;

  lastFrame = now;
  players.forEach((player, id) => updateView(id, player, dt));
  for (const id of views.keys()) {
    if (!players.has(id)) views.delete(id);
  }

  const shotViews: { x: number; y: number }[] = [];

  shots.forEach((shot) => {
    if (shot.area !== currentArea) return;
    shotViews.push({ x: shot.x, y: shot.z });
    renderer.trail(shot.x, shot.z - 60);
  });

  const selfPlayer = players.get(room.sessionId);

  if (selfPlayer && selfPlayer.area !== currentArea) {
    currentArea = selfPlayer.area;
    fade = 1;
    cameraReady = false;
    const view = views.get(room.sessionId);

    if (view) {
      view.x = selfPlayer.x;
      view.y = selfPlayer.z;
    }
  }
  pickables = collectPickables();
  hovered = pickableAt(pointer.x, pointer.y)?.id;
  canvas.style.cursor = hovered ? "pointer" : "";

  const selfState = players.get(room.sessionId);

  if (selfState) {
    manaFill.style.width = `${selfState.mana}%`;
    renderInventory(selfState);
  }

  const self = views.get(room.sessionId);

  if (self) {
    const follow = cameraReady ? 1 - Math.exp(-5 * dt) : 1;

    camera.x += (self.x - camera.x) * follow;
    camera.y += (self.y - 60 - camera.y) * follow;
    cameraReady = true;
  }
  renderer.clampCamera(camera, currentArea);

  const visible = [...views].filter(([id]) => players.get(id)?.area === currentArea).map(([, view]) => view);

  renderer.draw(currentArea, camera, visible, shotViews, pickables, hovered, dt);
  fade = Math.max(0, fade - dt * 2);
  fadeLayer.style.opacity = String(fade);
  updateHud(players);
}

requestAnimationFrame(frame);
