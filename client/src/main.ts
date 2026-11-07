import { Client, type Room } from "@colyseus/sdk";
import { AREAS, HOTSPOTS, insidePolygon } from "../../shared/areas.ts";
import { SPAWN } from "../../shared/forest.ts";
import { type Camera, type EnemyView, type Pickable, type PlayerView, Renderer, artUrl, loadArt } from "./render.ts";

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
  health: number;
  maxHealth: number;
  alive: boolean;
  kills: number;
  weapon: string;
  inventory: string[];
};
type EnemyState = { kind: string; x: number; z: number; aim: number; moving: boolean; health: number; maxHealth: number };
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
const ENEMY_NAMES: Record<string, string> = { cop: "POLIȚIST", donkey: "POLIȚIST" };
const ZOOM_SECONDS = 3.2;
const FIGHT_ZOOM = 0.8;
const TYPE_SPEED = 45;
/* The face-off before the fight: English first, the Romanian under it. */
const DIALOGUE = [
  {
    who: "POLIȚIST", portrait: "portrait_donkey",
    english: "Did you think nobody would notice the missing copper? You've got two choices: hand over every kilo of copper you stole, the easy way or the hard way. Your call.",
    romanian: "Credeai că nu observă nimeni că lipsește cuprul? Ai două variante: îmi dai toate kilogramele de cupru pe care le-ai furat, de bunăvoie sau cu forța. Tu alegi.",
  },
  {
    who: "VIRGILIU", portrait: "portrait_hero",
    english: "I do shit on your elders.",
    romanian: "Mă cac pe morții tăi.",
  },
];
const STRIKE_MS = 250;
const DYING_MS = 900;
const ITEM_NAMES: Record<string, string> = {
  sword: "Knife", axe: "Battle axe", potion_mana: "Mana potion", coins: "Gold coins",
  ring: "Gold ring", helmet: "Helmet", pouch: "Leather pouch",
};
const manaFill = document.getElementById("mana-fill")!;
const heroFill = document.getElementById("hero-fill")!;
const heroLag = document.getElementById("hero-lag")!;
const heroScore = document.getElementById("hero-score")!;
const enemyBar = document.getElementById("enemy-bar")!;
const enemyFill = document.getElementById("enemy-fill")!;
const enemyLag = document.getElementById("enemy-lag")!;
const enemyName = document.getElementById("enemy-name")!;
const enemyPortrait = document.getElementById("enemy-portrait") as HTMLImageElement;
const heroPortrait = document.getElementById("hero-portrait") as HTMLImageElement;
const talk = document.getElementById("talk")!;
const talkScene = document.getElementById("talk-scene") as HTMLImageElement;
const talkPortrait = document.getElementById("talk-portrait") as HTMLImageElement;
const talkName = document.getElementById("talk-name")!;
const talkEnglish = document.getElementById("talk-english")!;
const talkRomanian = document.getElementById("talk-romanian")!;
const banner = document.getElementById("banner")!;
const bannerText = document.getElementById("banner-text")!;
const bannerHint = document.getElementById("banner-hint")!;
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
  /* Single player: always a fresh room of one's own. */
  new Client(url).create("arena") as Promise<Room>,
]);
const renderer = new Renderer(canvas, art);
heroPortrait.src = artUrl(base, "portrait_hero");
talkScene.src = artUrl(base, "scene_talk");
(document.getElementById("talk-scene-tall") as HTMLImageElement).src = artUrl(base, "scene_talk_tall");

/* Intro: the camera flies in on the two of them, then the dialogue, then the fight. */
let stage: "zoom" | "talk" | "fight" | "over" = "zoom";
let stageTime = 0;
let line = 0;
let typed = 0;
let zoomedOut = false;

function showBanner(text: string, hint: string, seconds: number) {
  bannerText.textContent = text;
  bannerHint.textContent = hint;
  banner.hidden = false;
  banner.classList.remove("pop");
  void banner.offsetWidth;
  banner.classList.add("pop");
  if (seconds > 0) setTimeout(() => (banner.hidden = true), seconds * 1000);
}

function showLine() {
  const current = DIALOGUE[line];

  talkPortrait.src = artUrl(base, current.portrait);
  talkName.textContent = current.who;
  typed = 0;
}

function advanceTalk() {
  const current = DIALOGUE[line];

  if (typed < current.english.length) {
    typed = current.english.length;
    return;
  }
  line++;
  if (line < DIALOGUE.length) {
    showLine();
    return;
  }
  talk.hidden = true;
  stage = "fight";
  document.body.classList.remove("cutscene");
  room.send("ready");
  showBanner("FIGHT!", "", 1.3);
}

function updateTalk(dt: number) {
  const current = DIALOGUE[line];

  typed = Math.min(current.english.length, typed + dt * TYPE_SPEED);
  talkEnglish.textContent = current.english.slice(0, Math.floor(typed));
  talkRomanian.textContent = typed >= current.english.length ? current.romanian : "";
}

/* Returns true while the intro owns the camera and the controls. */
function updateIntro(dt: number, self: PlayerView | undefined, enemy: EnemyView | undefined) {
  if (stage === "fight" || stage === "over") {
    /* Ease back out to the playing zoom once, then the wheel decides. */
    if (!zoomedOut) {
      camera.zoom += (FIGHT_ZOOM - camera.zoom) * (1 - Math.exp(-3 * dt));
      if (Math.abs(camera.zoom - FIGHT_ZOOM) < 0.01) zoomedOut = true;
    }
    return false;
  }
  if (!self || !enemy) return true;
  stageTime += dt;
  const ease = Math.min(1, stageTime / ZOOM_SECONDS);
  const smooth = ease * ease * (3 - 2 * ease);

  camera.x = (self.x + enemy.x) / 2;
  camera.y = (self.y + enemy.y) / 2 - 90;
  /* Start as wide as the painting allows, so no black shows round the edges. */
  const widest = Math.max(ZOOM_MIN, innerWidth / AREAS.city.width, innerHeight / AREAS.city.height) * 1.03;

  camera.zoom = widest + (1.15 - widest) * smooth;
  if (stage === "zoom" && stageTime > ZOOM_SECONDS + 0.4) {
    stage = "talk";
    talk.hidden = false;
    showLine();
  }
  if (stage === "talk") updateTalk(dt);
  return true;
}

function checkEnd(phase: string) {
  if (stage !== "fight" || (phase !== "won" && phase !== "lost")) return;
  stage = "over";
  showBanner(phase === "won" ? "VICTORY!" : "DEFEAT", "click to fight again", 0);
}
const camera: Camera = { x: SPAWN.x, y: SPAWN.y, zoom: 0.8 };
const views = new Map<string, PlayerView>();
const enemyViews = new Map<string, EnemyView>();
let enemyShownAt = -Infinity;
const pointer = { x: innerWidth / 2, y: innerHeight / 2 };
let cameraReady = false;
let hovered: string | undefined;
let pickables: Pickable[] = [];
let shownInventory = "";
let currentArea = "city";
let fade = 0;
let lastLeftClick = -Infinity;
let casting = false;
let rightPressed = false;
const fingers = new Set<number>();
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
      alive: true,
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
  view.alive = player.alive;
  view.flash = Math.max(0, view.flash - dt * 4);
  if (view.slashTime >= 0) {
    view.slashTime += dt * 1000;
    if (view.slashTime > 420) view.slashTime = -1;
  }
}

function updateEnemies(enemies: Map<string, EnemyState>, dt: number) {
  enemies.forEach((enemy, id) => {
    let view = enemyViews.get(id);

    if (!view) {
      view = {
        kind: enemy.kind, x: enemy.x, y: enemy.z, aim: enemy.aim, moving: false, walkDistance: 0,
        attackTime: -1, windup: 300, tiredTime: -1, tiredMs: 0, flash: 0, dying: -1,
      };
      enemyViews.set(id, view);
    }
    const follow = 1 - Math.exp(-18 * dt);
    const stepX = (enemy.x - view.x) * follow;
    const stepY = (enemy.z - view.y) * follow;

    view.x += stepX;
    view.y += stepY;
    view.walkDistance = enemy.moving ? view.walkDistance + Math.hypot(stepX, stepY / DEPTH_SCALE) : 0;
    view.aim = enemy.aim;
    view.moving = enemy.moving;
  });
  for (const [id, view] of enemyViews) {
    view.flash = Math.max(0, view.flash - dt * 4);
    if (view.attackTime >= 0) {
      view.attackTime += dt * 1000;
      if (view.attackTime > view.windup + STRIKE_MS) view.attackTime = -1;
    }
    if (view.tiredTime >= 0) {
      view.tiredTime += dt * 1000;
      if (view.tiredTime > view.tiredMs) view.tiredTime = -1;
    }
    if (view.dying >= 0) view.dying += dt * 1000;
    if (view.dying > DYING_MS || (view.dying < 0 && !enemies.has(id))) enemyViews.delete(id);
  }
}

/* Arcade health bars: the yellow drops at once, the red behind it catches up a moment later. */
function setBar(fill: HTMLElement, lag: HTMLElement, share: number) {
  const width = `${Math.max(0, Math.min(1, share)) * 100}%`;

  fill.style.width = width;
  lag.style.width = width;
}

function updateHud(self: PlayerState | undefined, enemies: Map<string, EnemyState>, now: number) {
  if (self) {
    setBar(heroFill, heroLag, self.health / self.maxHealth);
    manaFill.style.width = `${self.mana}%`;
    heroScore.textContent = String(self.kills * 1000).padStart(6, "0");
  }
  const enemy = [...enemies.values()][0];

  if (enemy) {
    enemyShownAt = now;
    enemyBar.hidden = false;
    enemyName.textContent = ENEMY_NAMES[enemy.kind] ?? enemy.kind.toUpperCase();
    enemyPortrait.src = artUrl(base, `portrait_${enemy.kind}`);
    setBar(enemyFill, enemyLag, enemy.health / enemy.maxHealth);
  } else if (now - enemyShownAt > 1200) {
    enemyBar.hidden = true;
  } else {
    setBar(enemyFill, enemyLag, 0);
  }
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

function startRightPress() {
  casting = false;
  rightPressed = true;
  holdTimer = setTimeout(() => {
    casting = true;
    room.send("bolt", aimFromPointer());
    holdRepeat = setInterval(() => room.send("bolt", aimFromPointer()), BOLT_REPEAT_MS);
  }, HOLD_MS);
}

function endRightPress() {
  if (!rightPressed) return;
  rightPressed = false;
  stopHolding();
  if (!casting) room.send("slash", aimFromPointer());
}

function leftPress(timeStamp: number, allowRun: boolean) {
  const item = pickableAt(pointer.x, pointer.y);

  if (item) {
    room.send("interact", item.id);
  } else {
    moveToPointer(allowRun && timeStamp - lastLeftClick < DOUBLE_CLICK_MS);
    lastLeftClick = timeStamp;
  }
}

/** The enemy whose painted body is under the given screen point. */
function enemyAt(screenX: number, screenY: number) {
  const point = renderer.toWorld(camera, screenX, screenY);

  return [...enemyViews.values()].find((enemy) => {
    const halfWidth = enemy.kind === "donkey" ? 110 : 60;
    const height = enemy.kind === "donkey" ? 230 : 190;

    return enemy.dying < 0 && Math.abs(point.x - enemy.x) < halfWidth && point.y < enemy.y + 30 && point.y > enemy.y - height;
  });
}

/* On a phone, a tap walks, a double tap runs (or attacks, on the policeman), and a second finger acts as the right mouse button. */
function touchPress(timeStamp: number) {
  const self = views.get(room.sessionId);
  const enemy = enemyAt(pointer.x, pointer.y);

  if (fingers.size < 2 && enemy && self && timeStamp - lastLeftClick < DOUBLE_CLICK_MS) {
    room.send("move", { x: self.x, z: self.y });
    room.send("slash", Math.atan2(enemy.x - self.x, enemy.y - self.y));
    lastLeftClick = -Infinity;
    return;
  }
  if (fingers.size >= 2) {
    if (self) room.send("move", { x: self.x, z: self.y });
    startRightPress();
  } else {
    leftPress(timeStamp, true);
  }
}

addEventListener("pointerdown", (event) => {
  if (stage === "talk") {
    advanceTalk();
    return;
  }
  if (stage === "over") {
    location.reload();
    return;
  }
  if (event.target !== canvas || stage !== "fight") return;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  if (event.pointerType === "touch") {
    fingers.add(event.pointerId);
    touchPress(event.timeStamp);
  }
  else if (event.button === 0) leftPress(event.timeStamp, true);
  else if (event.button === 2) startRightPress();
});
function pointerReleased(event: PointerEvent) {
  fingers.delete(event.pointerId);
  endRightPress();
}

addEventListener("pointerup", pointerReleased);
addEventListener("pointercancel", pointerReleased);
addEventListener("blur", stopHolding);
addEventListener("keydown", (event) => {
  if (stage === "talk" && (event.code === "Space" || event.code === "Enter")) {
    if (!event.repeat) advanceTalk();
    return;
  }
  if (stage !== "fight") return;
  if (event.code === "Space" && !event.repeat) room.send("fire", aimFromPointer());
  if (event.code === "KeyM" && !event.repeat) panel.hidden = !panel.hidden;
  if (event.code === "Escape") panel.hidden = true;
});
addEventListener("wheel", (event) => {
  if (stage !== "fight" && stage !== "over") return;
  zoomedOut = true;
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
room.onMessage("enemyAttack", ({ id, windup }: { id: string; windup: number }) => {
  const view = enemyViews.get(id);

  if (!view) return;
  view.attackTime = 0;
  view.windup = windup;
  view.tiredTime = -1;
});
room.onMessage("enemyTired", ({ id, ms }: { id: string; ms: number }) => {
  const view = enemyViews.get(id);

  if (!view) return;
  view.tiredTime = 0;
  view.tiredMs = ms;
});
room.onMessage("enemyHit", ({ id }: { id: string }) => {
  const view = enemyViews.get(id);

  if (view) view.flash = 1;
});
room.onMessage("enemyDown", ({ id, kind, x, z, aim }: { id: string; kind: string; x: number; z: number; aim: number }) => {
  const view = enemyViews.get(id) ?? {
    kind, x, y: z, aim, moving: false, walkDistance: 0, attackTime: -1, windup: 300, tiredTime: -1, tiredMs: 0, flash: 0, dying: 0,
  };

  view.dying = 0;
  view.moving = false;
  enemyViews.set(id, view);
});
room.onMessage("bolt", (bolt: { area: string; fromX: number; fromZ: number; toX: number; toZ: number }) => {
  if (bolt.area === currentArea) renderer.addBolt(bolt.fromX, bolt.fromZ, bolt.toX, bolt.toZ);
});

renderer.resize();

function frame(now: number) {
  requestAnimationFrame(frame);

  /* The first state patch can arrive a moment after joining */
  if (!room.state?.players || !room.state?.shots || !room.state?.items || !room.state?.enemies) return;

  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  const players: Map<string, PlayerState> = room.state.players;
  const shots: Map<string, ShotState> = room.state.shots;
  const enemies: Map<string, EnemyState> = room.state.enemies;

  lastFrame = now;
  players.forEach((player, id) => updateView(id, player, dt));
  updateEnemies(enemies, dt);
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

  if (selfState) renderInventory(selfState);

  const self = views.get(room.sessionId);
  const inIntro = updateIntro(dt, self, [...enemyViews.values()][0]);

  checkEnd(room.state.phase);
  if (self && !inIntro) {
    const follow = cameraReady ? 1 - Math.exp(-5 * dt) : 1;

    camera.x += (self.x - camera.x) * follow;
    camera.y += (self.y - 60 - camera.y) * follow;
    cameraReady = true;
  } else if (inIntro) {
    cameraReady = true;
  }
  renderer.clampCamera(camera, currentArea);

  const visible = [...views].filter(([id]) => players.get(id)?.area === currentArea).map(([, view]) => view);

  renderer.draw(currentArea, camera, visible, [...enemyViews.values()], shotViews, pickables, hovered, dt);
  fade = Math.max(0, fade - dt * 2);
  fadeLayer.style.opacity = String(fade);
  updateHud(selfState, enemies, now);
}

requestAnimationFrame(frame);
