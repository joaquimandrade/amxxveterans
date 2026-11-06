import { Client, type Room } from "@colyseus/sdk";
import { SPAWN } from "../../shared/forest.ts";
import { type Camera, type PlayerView, Renderer, loadArt } from "./render.ts";

type PlayerState = {
  name: string;
  hue: number;
  x: number;
  z: number;
  aim: number;
  moving: boolean;
  running: boolean;
  hits: number;
};
type ShotState = { x: number; z: number };

const ZOOM_MIN = 0.45;
const ZOOM_MAX = 1.25;
const DOUBLE_CLICK_MS = 320;
const HOLD_MS = 280;
const BOLT_REPEAT_MS = 560;
const hud = document.getElementById("hud")!;
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
      hue: player.hue,
      name: player.name,
      isSelf: id === room.sessionId,
      walkTime: 0,
      slashTime: -1,
      flash: 0,
    };
    views.set(id, view);
  }

  const follow = 1 - Math.exp(-18 * dt);

  view.x += (player.x - view.x) * follow;
  view.y += (player.z - view.y) * follow;
  view.aim = player.aim;
  view.moving = player.moving;
  view.running = player.running;
  view.walkTime = player.moving ? view.walkTime + dt : 0;
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
  hud.innerHTML = `${rows.join("<br>")}<br><br>left click walk · double click run · right click sword · hold right lightning · space fireball · wheel zoom`;
}

addEventListener("contextmenu", (event) => event.preventDefault());
addEventListener("pointermove", (event) => {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
});
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
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  if (event.button === 0) {
    moveToPointer(event.timeStamp - lastLeftClick < DOUBLE_CLICK_MS);
    lastLeftClick = event.timeStamp;
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
});
addEventListener("wheel", (event) => {
  camera.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, camera.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
});
addEventListener("resize", () => renderer.resize());

room.onMessage("explode", ({ x, z }: { x: number; z: number }) => renderer.explode(x, z));
room.onMessage("hit", ({ id }: { id: string }) => {
  const view = views.get(id);

  if (view) view.flash = 1;
});
room.onMessage("slash", ({ id }: { id: string }) => {
  const view = views.get(id);

  if (view) view.slashTime = 0;
});
room.onMessage("cast", () => {});
room.onMessage("bolt", (bolt: { fromX: number; fromZ: number; toX: number; toZ: number }) => {
  renderer.addBolt(bolt.fromX, bolt.fromZ, bolt.toX, bolt.toZ);
});

renderer.resize();

function frame(now: number) {
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
    shotViews.push({ x: shot.x, y: shot.z });
    renderer.trail(shot.x, shot.z - 60);
  });

  const self = views.get(room.sessionId);

  if (self) {
    const follow = cameraReady ? 1 - Math.exp(-5 * dt) : 1;

    camera.x += (self.x - camera.x) * follow;
    camera.y += (self.y - 60 - camera.y) * follow;
    cameraReady = true;
  }
  renderer.clampCamera(camera);
  renderer.draw(camera, [...views.values()], shotViews, dt);
  updateHud(players);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
