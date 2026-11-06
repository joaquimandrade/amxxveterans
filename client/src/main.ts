import { Client, type Room } from "@colyseus/sdk";
import * as THREE from "three";
import { MAP_SIZE } from "../../shared/forest.ts";
import { Effects } from "./effects.ts";
import { Hero } from "./hero.ts";
import { createWorld } from "./world.ts";

type PlayerState = {
  name: string;
  hue: number;
  x: number;
  z: number;
  aim: number;
  moving: boolean;
  hits: number;
};
type ShotState = { x: number; z: number };

const CAMERA_DIRECTION = new THREE.Vector3(1, 1.12, 1).normalize();
const CAMERA_DISTANCE = 120;
const SUN_OFFSET = new THREE.Vector3(30, 60, 12);
const ZOOM_MIN = 12;
const ZOOM_MAX = 42;

const hud = document.getElementById("hud")!;
const { scene, camera, renderer, ground, sun } = createWorld();
const effects = new Effects(scene);
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const heroes = new Map<string, Hero>();
const shotMeshes = new Map<string, THREE.Object3D>();
const focus = new THREE.Vector3();
let viewHeight = 24;
let lastFrame = performance.now();

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const url = import.meta.env.DEV
  ? `ws://${location.hostname}:8091`
  : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${basePath}`;

const room: Room = await new Client(url).joinOrCreate("arena");

const selection = new THREE.Mesh(
  new THREE.RingGeometry(0.7, 0.85, 32),
  new THREE.MeshBasicMaterial({ color: 0x6dff8a, transparent: true, opacity: 0.85 }),
);
const moveMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.25, 0.42, 24),
  new THREE.MeshBasicMaterial({ color: 0x9dff6d, transparent: true, opacity: 0 }),
);

selection.rotation.x = moveMarker.rotation.x = -Math.PI / 2;
selection.position.y = 0.05;
moveMarker.position.y = 0.06;
scene.add(selection, moveMarker);

function updateProjection() {
  const aspect = innerWidth / innerHeight;

  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.left = (-viewHeight * aspect) / 2;
  camera.right = (viewHeight * aspect) / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

function placeCamera() {
  camera.position.copy(focus).addScaledVector(CAMERA_DIRECTION, CAMERA_DISTANCE);
  camera.lookAt(focus);
  sun.position.copy(focus).add(SUN_OFFSET);
  sun.target.position.copy(focus);
}

function pointOnGround() {
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObject(ground)[0]?.point;
}

function aimFromPointer() {
  const self = heroes.get(room.sessionId);
  const point = pointOnGround();

  if (!self || !point) return 0;
  return Math.atan2(point.x - self.root.position.x, point.z - self.root.position.z);
}

function moveTo() {
  const point = pointOnGround();

  if (!point) return;
  const x = THREE.MathUtils.clamp(point.x, -MAP_SIZE, MAP_SIZE);
  const z = THREE.MathUtils.clamp(point.z, -MAP_SIZE, MAP_SIZE);

  room.send("move", { x, z });
  moveMarker.position.set(x, 0.06, z);
  moveMarker.scale.setScalar(2.2);
  (moveMarker.material as THREE.MeshBasicMaterial).opacity = 1;
}

function updateHero(hero: Hero, player: PlayerState, dt: number) {
  const follow = 1 - Math.exp(-16 * dt);
  const turn =
    THREE.MathUtils.euclideanModulo(player.aim - hero.root.rotation.y + Math.PI, Math.PI * 2) - Math.PI;

  hero.root.position.x += (player.x - hero.root.position.x) * follow;
  hero.root.position.z += (player.z - hero.root.position.z) * follow;
  hero.root.rotation.y += turn * follow;
  hero.update(dt, player.moving);
}

function syncShots(shots: Map<string, ShotState>) {
  for (const [id, mesh] of shotMeshes) {
    if (!shots.has(id)) {
      scene.remove(mesh);
      shotMeshes.delete(id);
    }
  }
  shots.forEach((shot, id) => {
    let mesh = shotMeshes.get(id);

    if (!mesh) {
      mesh = effects.createFireball();
      shotMeshes.set(id, mesh);
    }
    mesh.position.set(shot.x, 1.4, shot.z);
    effects.trail(mesh.position);
  });
}

function updateHud(players: Map<string, PlayerState>) {
  const rows: string[] = [];

  players.forEach((player, id) => {
    rows.push(`${id === room.sessionId ? "<b>you</b> " : ""}${player.name}: ${player.hits}`);
  });
  hud.innerHTML = `${rows.join("<br>")}<br><br>right click move · left click sword · space fireball · wheel zoom`;
}

addEventListener("contextmenu", (event) => event.preventDefault());
addEventListener("pointermove", (event) => {
  pointer.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
});
addEventListener("pointerdown", (event) => {
  pointer.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
  if (event.button === 2) moveTo();
  if (event.button === 0) room.send("slash", aimFromPointer());
});
addEventListener("keydown", (event) => {
  if (event.code === "Space" && !event.repeat) room.send("fire", aimFromPointer());
});
addEventListener("wheel", (event) => {
  viewHeight = THREE.MathUtils.clamp(viewHeight + Math.sign(event.deltaY) * 2, ZOOM_MIN, ZOOM_MAX);
  updateProjection();
});
addEventListener("resize", updateProjection);

room.onMessage("explode", ({ x, z }: { x: number; z: number }) => effects.explode(x, z));
room.onMessage("hit", ({ id }: { id: string }) => heroes.get(id)?.hit());
room.onMessage("slash", ({ id }: { id: string }) => heroes.get(id)?.slash());
room.onMessage("cast", ({ id }: { id: string }) => heroes.get(id)?.cast());

updateProjection();

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  const players: Map<string, PlayerState> = room.state.players;

  lastFrame = now;
  players.forEach((player, id) => {
    let hero = heroes.get(id);

    if (!hero) {
      hero = new Hero(player.hue);
      hero.root.position.set(player.x, 0, player.z);
      hero.root.rotation.y = player.aim;
      scene.add(hero.root);
      heroes.set(id, hero);
      if (id === room.sessionId) focus.copy(hero.root.position);
    }
    updateHero(hero, player, dt);
  });
  for (const [id, hero] of heroes) {
    if (!players.has(id)) {
      scene.remove(hero.root);
      heroes.delete(id);
    }
  }

  syncShots(room.state.shots);
  effects.update(dt);

  const marker = moveMarker.material as THREE.MeshBasicMaterial;

  marker.opacity = Math.max(0, marker.opacity - dt * 2);
  moveMarker.scale.setScalar(Math.max(1, moveMarker.scale.x - dt * 4));

  const self = heroes.get(room.sessionId);

  if (self) {
    focus.lerp(self.root.position, 1 - Math.exp(-4 * dt));
    selection.position.x = self.root.position.x;
    selection.position.z = self.root.position.z;
  }
  placeCamera();
  updateHud(players);
  renderer.render(scene, camera);
});
