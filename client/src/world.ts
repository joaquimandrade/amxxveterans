import * as THREE from "three";
import { CLEARING_RADIUS, MAP_SIZE, TREES, seededRandom } from "../../shared/forest.ts";

const GROUND_SIZE = MAP_SIZE * 2 + 40;

function groundTexture() {
  const size = 1536;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  const random = seededRandom(7);

  canvas.width = canvas.height = size;
  context.fillStyle = "#5e8a3c";
  context.fillRect(0, 0, size, size);

  /* Large patches of lighter and darker grass */
  for (let i = 0; i < 900; i++) {
    const radius = 24 + random() * 120;
    const x = random() * size;
    const y = random() * size;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    const tone = random() > 0.5 ? "120,160,62" : "62,104,44";

    gradient.addColorStop(0, `rgba(${tone},0.22)`);
    gradient.addColorStop(1, `rgba(${tone},0)`);
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  /* Dirt in the clearing and one trail through the map */
  const toPixel = (world: number) => ((world + GROUND_SIZE / 2) / GROUND_SIZE) * size;
  const dirt = context.createRadialGradient(toPixel(0), toPixel(0), 40, toPixel(0), toPixel(0), toPixel(CLEARING_RADIUS) - toPixel(0));

  dirt.addColorStop(0, "rgba(150,118,74,0.8)");
  dirt.addColorStop(0.7, "rgba(150,118,74,0.45)");
  dirt.addColorStop(1, "rgba(150,118,74,0)");
  context.fillStyle = dirt;
  context.fillRect(0, 0, size, size);
  context.strokeStyle = "rgba(146,114,72,0.55)";
  context.lineCap = "round";
  context.lineWidth = 34;
  context.beginPath();
  context.moveTo(0, toPixel(14));
  context.bezierCurveTo(toPixel(-20), toPixel(6), toPixel(-8), toPixel(-2), toPixel(0), toPixel(0));
  context.bezierCurveTo(toPixel(10), toPixel(4), toPixel(22), toPixel(-16), size, toPixel(-22));
  context.stroke();

  /* Fine grain */
  for (let i = 0; i < 90000; i++) {
    const shade = 70 + random() * 90;

    context.fillStyle = `rgba(${shade},${shade + 40},${shade - 30},0.16)`;
    context.fillRect(random() * size, random() * size, 2, 3);
  }

  const texture = new THREE.CanvasTexture(canvas);

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function instances(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  items: { position: THREE.Vector3; scale: THREE.Vector3; rotation?: number; color?: THREE.Color }[],
  castShadow = true,
) {
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const dummy = new THREE.Object3D();

  items.forEach((item, index) => {
    dummy.position.copy(item.position);
    dummy.scale.copy(item.scale);
    dummy.rotation.set(0, item.rotation ?? 0, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    if (item.color) mesh.setColorAt(index, item.color);
  });
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  return mesh;
}

const flat = (color?: THREE.ColorRepresentation) =>
  new THREE.MeshStandardMaterial({ color: color ?? 0xffffff, flatShading: true, roughness: 0.95 });

function addTrees(scene: THREE.Scene) {
  const random = seededRandom(42);
  const trunks: Parameters<typeof instances>[2] = [];
  const crowns: Parameters<typeof instances>[2] = [];
  const pines: Parameters<typeof instances>[2] = [];

  for (const tree of TREES) {
    const s = tree.scale * 1.35;
    const base = new THREE.Vector3(tree.x, 0, tree.z);

    trunks.push({
      position: base.clone().setY(1.1 * s),
      scale: new THREE.Vector3(s, s, s),
      rotation: random() * 6,
    });

    if (tree.kind === 0) {
      const green = new THREE.Color().setHSL(0.36 + random() * 0.05, 0.55, 0.16 + random() * 0.05);

      for (let layer = 0; layer < 3; layer++) {
        const width = s * (1.75 - layer * 0.42);

        pines.push({
          position: base.clone().setY((2.6 + layer * 1.15) * s),
          scale: new THREE.Vector3(width, s * 1.7, width),
          rotation: random() * 6,
          color: green,
        });
      }
    } else {
      const hue = tree.kind === 1 ? 0.27 + random() * 0.05 : 0.2 + random() * 0.04;

      for (let blob = 0; blob < 4; blob++) {
        const angle = random() * Math.PI * 2;
        const spread = blob === 0 ? 0 : s * 0.75;
        const size = s * (blob === 0 ? 1.55 : 1 + random() * 0.3);

        crowns.push({
          position: new THREE.Vector3(
            tree.x + Math.cos(angle) * spread,
            s * (blob === 0 ? 3.1 : 2.5 + random() * 0.5),
            tree.z + Math.sin(angle) * spread,
          ),
          scale: new THREE.Vector3(size, size * 0.85, size),
          rotation: random() * 6,
          color: new THREE.Color().setHSL(hue, 0.6, 0.22 + random() * 0.07),
        });
      }
    }
  }

  scene.add(
    instances(new THREE.CylinderGeometry(0.2, 0.34, 2.2, 6), flat(0x5b4028), trunks),
    instances(new THREE.IcosahedronGeometry(1, 1), flat(), crowns),
    instances(new THREE.ConeGeometry(1, 1, 7), flat(), pines),
  );
}

function addDetails(scene: THREE.Scene) {
  const random = seededRandom(9);
  const spot = (margin = 0) => {
    const x = (random() * 2 - 1) * (MAP_SIZE + margin);
    const z = (random() * 2 - 1) * (MAP_SIZE + margin);

    return new THREE.Vector3(x, 0, z);
  };
  const free = (position: THREE.Vector3) => TREES.every((tree) => Math.hypot(tree.x - position.x, tree.z - position.z) > 1.2);
  const collect = (count: number, make: (position: THREE.Vector3) => Parameters<typeof instances>[2][number]) => {
    const items: Parameters<typeof instances>[2] = [];

    for (let i = 0; i < count; i++) {
      const position = spot(10);

      if (free(position)) items.push(make(position));
    }
    return items;
  };

  scene.add(
    instances(new THREE.DodecahedronGeometry(1, 0), flat(0x8a8a82), collect(60, (position) => {
      const size = 0.3 + random() * 0.8;

      return { position: position.setY(size * 0.3), scale: new THREE.Vector3(size, size * 0.65, size * 0.85), rotation: random() * 6 };
    })),
    instances(new THREE.IcosahedronGeometry(1, 0), flat(), collect(150, (position) => {
      const size = 0.4 + random() * 0.6;

      return {
        position: position.setY(size * 0.5),
        scale: new THREE.Vector3(size, size * 0.8, size),
        rotation: random() * 6,
        color: new THREE.Color().setHSL(0.3 + random() * 0.07, 0.55, 0.17 + random() * 0.08),
      };
    })),
    instances(new THREE.ConeGeometry(0.1, 0.55, 4), flat(), collect(1400, (position) => ({
      position: position.setY(0.25),
      scale: new THREE.Vector3(1, 0.6 + random() * 0.8, 1),
      rotation: random() * 6,
      color: new THREE.Color().setHSL(0.27 + random() * 0.05, 0.5, 0.3 + random() * 0.14),
    })), false),
    instances(new THREE.SphereGeometry(0.09, 5, 4), flat(), collect(420, (position) => ({
      position: position.setY(0.22),
      scale: new THREE.Vector3(1, 1, 1),
      color: new THREE.Color().setHSL([0.13, 0.95, 0.75, 0][Math.floor(random() * 4)], 0.8, 0.72),
    })), false),
  );
}

export function createWorld() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 300);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const sun = new THREE.DirectionalLight(0xfff0d4, 2.4);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 }),
  );

  scene.background = new THREE.Color(0x3d5a2c);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  document.body.appendChild(renderer.domElement);

  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 140 });
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xd8e8ff, 0x4a5a30, 0.8));

  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  addTrees(scene);
  addDetails(scene);

  return { scene, camera, renderer, ground, sun };
}
