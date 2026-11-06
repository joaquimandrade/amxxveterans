import * as THREE from "three";

const ARENA = 44;

function sandTexture() {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;

  canvas.width = canvas.height = 512;
  context.fillStyle = "#b08a5c";
  context.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 26000; i++) {
    const shade = 120 + Math.random() * 70;

    context.fillStyle = `rgba(${shade + 40},${shade},${shade - 40},0.25)`;
    context.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  const texture = new THREE.CanvasTexture(canvas);

  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(12, 12);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Same sequence on every client, so everyone sees the same arena. */
function seededRandom(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function addCrates(scene: THREE.Scene) {
  const material = new THREE.MeshStandardMaterial({ color: 0x6d4a2b, roughness: 0.9 });
  const random = seededRandom(1998);

  for (let i = 0; i < 14; i++) {
    const size = 1 + random() * 1.6;
    const crate = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material);

    crate.position.set((random() - 0.5) * 38, size / 2, (random() - 0.5) * 38);
    crate.rotation.y = random() * Math.PI;
    crate.castShadow = crate.receiveShadow = true;
    scene.add(crate);
  }
}

export function createWorld() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const sun = new THREE.DirectionalLight(0xffe2b8, 2.6);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA, ARENA),
    new THREE.MeshStandardMaterial({ map: sandTexture(), roughness: 1 }),
  );

  scene.background = new THREE.Color(0xd59a6a);
  scene.fog = new THREE.Fog(0xd59a6a, 35, 75);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);

  sun.position.set(14, 24, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, far: 70 });
  scene.add(sun, new THREE.HemisphereLight(0xffd9b0, 0x4a3324, 1.1));

  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  addCrates(scene);

  camera.position.set(0, 15, 12);
  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  return { scene, camera, renderer, ground };
}
