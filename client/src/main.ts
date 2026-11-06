import { Client, type Room } from "@colyseus/sdk";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { Effects } from "./effects.ts";
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

type Avatar = {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction;
  run: THREE.AnimationAction;
  hit: THREE.AnimationAction;
  flash: number;
  materials: THREE.MeshStandardMaterial[];
  moving: boolean;
};

const hud = document.getElementById("hud")!;
const { scene, camera, renderer, ground } = createWorld();
const effects = new Effects(scene);
const keys = new Set<string>();
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const avatars = new Map<string, Avatar>();
const shotMeshes = new Map<string, THREE.Object3D>();
let lastFrame = performance.now();

const url = import.meta.env.DEV
  ? `ws://${location.hostname}:8091`
  : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;

const gltf = await new GLTFLoader().loadAsync("/models/robot.glb");
const room: Room = await new Client(url).joinOrCreate("arena");

function createAvatar(player: PlayerState): Avatar {
  const root = cloneSkinned(gltf.scene);
  const materials: THREE.MeshStandardMaterial[] = [];
  const mixer = new THREE.AnimationMixer(root);
  const action = (name: string) =>
    mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, name)!);

  root.scale.setScalar(0.45);
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;

    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const material = (mesh.material as THREE.MeshStandardMaterial).clone();

    if (material.name === "Main") material.color.setHSL(player.hue, 0.7, 0.5);
    mesh.material = material;
    materials.push(material);
  });
  scene.add(root);

  const idle = action("Idle");
  const run = action("Running");
  const hit = action("No");

  hit.setLoop(THREE.LoopOnce, 1);
  idle.play();
  return { root, mixer, idle, run, hit, flash: 0, materials, moving: false };
}

function removeAvatar(id: string) {
  const avatar = avatars.get(id);

  if (!avatar) return;
  scene.remove(avatar.root);
  avatars.delete(id);
}

function updateAvatar(avatar: Avatar, player: PlayerState, dt: number) {
  const follow = 1 - Math.exp(-14 * dt);
  const turn = THREE.MathUtils.euclideanModulo(player.aim - avatar.root.rotation.y + Math.PI, Math.PI * 2) - Math.PI;

  avatar.root.position.x += (player.x - avatar.root.position.x) * follow;
  avatar.root.position.z += (player.z - avatar.root.position.z) * follow;
  avatar.root.rotation.y += turn * follow;

  if (player.moving !== avatar.moving) {
    const [from, to] = player.moving ? [avatar.idle, avatar.run] : [avatar.run, avatar.idle];

    to.reset().play();
    from.crossFadeTo(to, 0.15, false);
    avatar.moving = player.moving;
  }

  avatar.flash = Math.max(0, avatar.flash - dt * 4);
  for (const material of avatar.materials) {
    material.emissive.setRGB(avatar.flash, avatar.flash * 0.3, 0);
  }
  avatar.mixer.update(dt);
}

function aimAngle(self: THREE.Object3D) {
  const hits = (raycaster.setFromCamera(pointer, camera), raycaster.intersectObject(ground));

  if (!hits.length) return self.rotation.y;
  return Math.atan2(hits[0].point.x - self.position.x, hits[0].point.z - self.position.z);
}

function sendInput() {
  const self = avatars.get(room.sessionId);

  if (!self) return;
  room.send("input", {
    dx: Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft")),
    dz: Number(keys.has("KeyS") || keys.has("ArrowDown")) - Number(keys.has("KeyW") || keys.has("ArrowUp")),
    aim: aimAngle(self.root),
  });
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
    mesh.position.set(shot.x, 1, shot.z);
    effects.trail(mesh.position);
  });
}

function updateHud(players: Map<string, PlayerState>) {
  const rows: string[] = [];

  players.forEach((player, id) => {
    rows.push(`${id === room.sessionId ? "<b>you</b> " : ""}${player.name}: ${player.hits}`);
  });
  hud.innerHTML = `${rows.join("<br>")}<br><br>WASD move · mouse aim · click or space fire`;
}

addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (event.code === "Space") room.send("fire");
});
addEventListener("keyup", (event) => keys.delete(event.code));
addEventListener("pointerdown", () => room.send("fire"));
addEventListener("pointermove", (event) => {
  pointer.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
});

room.onMessage("explode", ({ x, z }: { x: number; z: number }) => effects.explode(x, z));
room.onMessage("hit", ({ id }: { id: string }) => {
  const avatar = avatars.get(id);

  if (!avatar) return;
  avatar.flash = 1;
  avatar.hit.reset().play();
});

setInterval(sendInput, 50);

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min((now - lastFrame) / 1000, 0.1);

  lastFrame = now;
  const players: Map<string, PlayerState> = room.state.players;

  players.forEach((player, id) => {
    let avatar = avatars.get(id);

    if (!avatar) {
      avatar = createAvatar(player);
      avatar.root.position.set(player.x, 0, player.z);
      avatars.set(id, avatar);
    }
    updateAvatar(avatar, player, dt);
  });
  for (const id of avatars.keys()) {
    if (!players.has(id)) removeAvatar(id);
  }

  syncShots(room.state.shots);
  effects.update(dt);

  const self = avatars.get(room.sessionId);

  if (self) {
    camera.position.lerp(self.root.position.clone().add(new THREE.Vector3(0, 15, 12)), 1 - Math.exp(-6 * dt));
    camera.lookAt(self.root.position);
  }
  updateHud(players);
  renderer.render(scene, camera);
});
