/** The forest layout. Server and clients build the same one from this seed. */
export const MAP_SIZE = 40;
export const CLEARING_RADIUS = 11;

export type Tree = { x: number; z: number; radius: number; scale: number; kind: number };

export function seededRandom(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function createTrees() {
  const random = seededRandom(1998);
  const trees: Tree[] = [];

  /* Groves around random centres leave open glades between them */
  for (let grove = 0; grove < 26; grove++) {
    const centerX = (random() * 2 - 1) * MAP_SIZE;
    const centerZ = (random() * 2 - 1) * MAP_SIZE;
    const count = 3 + Math.floor(random() * 7);

    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const distance = random() * 8;
      const x = centerX + Math.cos(angle) * distance;
      const z = centerZ + Math.sin(angle) * distance;
      const scale = 0.8 + random() * 0.7;
      const radius = 0.55 * scale;

      if (Math.abs(x) > MAP_SIZE - 1 || Math.abs(z) > MAP_SIZE - 1) continue;
      if (Math.hypot(x, z) < CLEARING_RADIUS) continue;
      if (trees.some((tree) => Math.hypot(tree.x - x, tree.z - z) < 2.4)) continue;
      trees.push({ x, z, radius, scale, kind: Math.floor(random() * 3) });
    }
  }
  return trees;
}

export const TREES = createTrees();
