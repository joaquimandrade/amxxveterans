import * as THREE from "three";

const CLOTH_ROWS = 10;
const CLOTH_COLUMNS = 6;

function material(color: THREE.ColorRepresentation, options: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, ...options });
}

function part(
  geometry: THREE.BufferGeometry,
  surface: THREE.Material,
  parent: THREE.Object3D,
  x = 0,
  y = 0,
  z = 0,
) {
  const mesh = new THREE.Mesh(geometry, surface);

  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function pivot(parent: THREE.Object3D, x: number, y: number, z: number) {
  const group = new THREE.Group();

  group.position.set(x, y, z);
  parent.add(group);
  return group;
}

/** A low-poly hero built from code: white cloak, long blond hair and a sword. */
export class Hero {
  readonly root = new THREE.Group();

  private body: THREE.Group;
  private legs: THREE.Group[] = [];
  private arms: THREE.Group[] = [];
  private forearm: THREE.Group;
  private strands: THREE.Group[] = [];
  private cloak: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private cloakRest: Float32Array;
  private surfaces: THREE.MeshStandardMaterial[] = [];
  private time = Math.random() * 10;
  private walkBlend = 0;
  private slashTime = -1;
  private castTime = -1;
  private flash = 0;

  constructor(hue: number) {
    const skin = material(0xe8b48a);
    const tunic = material(0xd9d6cc);
    const leather = material(0x5a3a22);
    const steel = material(0xcdd6e0, { metalness: 0.75, roughness: 0.3 });
    const gold = material(0xd8a93a, { metalness: 0.7, roughness: 0.4 });
    const hair = material(0xf0cf5a);
    const team = material(new THREE.Color().setHSL(hue, 0.65, 0.45));

    this.surfaces = [skin, tunic, leather, hair, team];
    this.body = pivot(this.root, 0, 0.95, 0);

    /* Legs */
    for (const side of [-1, 1]) {
      const leg = pivot(this.body, side * 0.17, 0, 0);

      part(new THREE.CapsuleGeometry(0.11, 0.42, 3, 6), tunic, leg, 0, -0.32, 0);
      part(new THREE.BoxGeometry(0.2, 0.36, 0.28), leather, leg, 0, -0.74, 0.04);
      this.legs.push(leg);
    }

    /* Torso */
    part(new THREE.CylinderGeometry(0.3, 0.26, 0.72, 7), tunic, this.body, 0, 0.36, 0);
    part(new THREE.CylinderGeometry(0.28, 0.28, 0.09, 7), leather, this.body, 0, 0.06, 0);
    part(new THREE.BoxGeometry(0.12, 0.09, 0.06), gold, this.body, 0, 0.06, 0.27);
    part(new THREE.CylinderGeometry(0.34, 0.42, 0.5, 7), tunic, this.body, 0, -0.2, 0);
    part(new THREE.SphereGeometry(0.15, 6, 4), team, this.body, -0.36, 0.68, 0);
    part(new THREE.SphereGeometry(0.15, 6, 4), team, this.body, 0.36, 0.68, 0);

    /* Head */
    const head = pivot(this.body, 0, 0.98, 0.02);

    part(new THREE.IcosahedronGeometry(0.24, 1), skin, head);
    part(new THREE.SphereGeometry(0.27, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, head, 0, 0.03, -0.03);
    part(new THREE.BoxGeometry(0.04, 0.05, 0.03), material(0x24303c), head, -0.09, 0.02, 0.22);
    part(new THREE.BoxGeometry(0.04, 0.05, 0.03), material(0x24303c), head, 0.09, 0.02, 0.22);

    /* Long hair: a fan of strands that sway from the back of the head */
    for (let i = 0; i < 7; i++) {
      const angle = ((i - 3) / 3) * 1.25;
      const strand = pivot(head, Math.sin(angle) * 0.22, 0.05, Math.cos(angle) * -0.2);

      part(new THREE.CapsuleGeometry(0.075, 1, 2, 5), hair, strand, 0, -0.56, 0);
      strand.rotation.z = -Math.sin(angle) * 0.1;
      this.strands.push(strand);
    }

    /* Arms: index 0 is the free arm, index 1 holds the sword */
    for (const side of [-1, 1]) {
      const arm = pivot(this.body, side * 0.4, 0.66, 0);

      part(new THREE.CapsuleGeometry(0.09, 0.3, 3, 6), tunic, arm, 0, -0.24, 0);
      this.arms.push(arm);
    }
    this.forearm = pivot(this.arms[1], 0, -0.46, 0);
    part(new THREE.CapsuleGeometry(0.08, 0.24, 3, 6), skin, this.forearm, 0, -0.16, 0);
    part(new THREE.CapsuleGeometry(0.08, 0.24, 3, 6), skin, this.arms[0], 0, -0.62, 0);

    /* Sword in the right hand */
    const sword = pivot(this.forearm, 0, -0.36, 0.05);

    part(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 6), leather, sword, 0, 0, 0).rotation.x = Math.PI / 2;
    part(new THREE.BoxGeometry(0.34, 0.06, 0.07), gold, sword, 0, 0, 0.14);
    part(new THREE.BoxGeometry(0.08, 0.03, 1.24), steel, sword, 0, 0, 0.78);
    part(new THREE.ConeGeometry(0.057, 0.16, 4), steel, sword, 0, 0, 1.47).rotation.x = Math.PI / 2;

    /* Cloak: a grid of vertices waved in code */
    const cloakSurface = material(0xf7f4ec, { side: THREE.DoubleSide, roughness: 0.95 });

    this.cloak = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.65, CLOTH_COLUMNS, CLOTH_ROWS), cloakSurface);
    this.cloak.position.set(0, -0.08, -0.33);
    this.cloak.castShadow = true;
    this.body.add(this.cloak);
    this.cloakRest = Float32Array.from(this.cloak.geometry.attributes.position.array);
    this.surfaces.push(cloakSurface);
    part(new THREE.TorusGeometry(0.31, 0.06, 5, 9), team, this.body, 0, 0.74, -0.02).rotation.x = Math.PI / 2;

    this.root.scale.setScalar(0.95);
  }

  slash() {
    this.slashTime = 0;
  }

  cast() {
    this.castTime = 0;
  }

  hit() {
    this.flash = 1;
  }

  private updateCloak(walk: number) {
    const positions = this.cloak.geometry.attributes.position;
    const rest = this.cloakRest;

    for (let i = 0; i < positions.count; i++) {
      const x = rest[i * 3];
      const y = rest[i * 3 + 1];
      const drop = 0.82 - y; /* 0 at the shoulders, 1.65 at the hem */
      const wave = Math.sin(this.time * (2 + walk * 5) + drop * 3.2 + x * 3) * drop * (0.05 + walk * 0.1);

      positions.setZ(i, -drop * (0.1 + walk * 0.5) + wave);
      positions.setX(i, x * (1 + drop * 0.22));
    }
    positions.needsUpdate = true;
    this.cloak.geometry.computeVertexNormals();
  }

  update(dt: number, moving: boolean) {
    this.time += dt;
    this.walkBlend += (Number(moving) - this.walkBlend) * (1 - Math.exp(-10 * dt));

    const walk = this.walkBlend;
    const stride = Math.sin(this.time * 10);
    const breath = Math.sin(this.time * 2.2);

    this.body.position.y = 0.95 + Math.abs(Math.cos(this.time * 10)) * 0.07 * walk + breath * 0.012;
    this.body.rotation.x = walk * 0.14;
    this.legs[0].rotation.x = stride * 0.8 * walk;
    this.legs[1].rotation.x = -stride * 0.8 * walk;
    this.arms[0].rotation.x = -stride * 0.6 * walk;
    this.arms[0].rotation.z = -0.12;

    /* Sword arm: relaxed, then a wide overhead cut when slashing */
    let swordRaise = -stride * 0.3 * walk - 0.15;
    let swordSweep = 0.12;
    let forearmBend = -0.5;

    if (this.slashTime >= 0) {
      const t = this.slashTime / 0.36;

      if (t >= 1) {
        this.slashTime = -1;
      } else {
        const swing = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7;

        swordRaise = -2.6 * swing + (t > 0.3 ? -0.5 * (1 - t) : 0);
        swordSweep = 0.9 * (1 - t) - 0.7 * t;
        forearmBend = -0.2;
        this.body.rotation.y = 0.6 - t * 1.2;
        this.slashTime += dt;
      }
    } else {
      this.body.rotation.y *= Math.exp(-12 * dt);
    }

    if (this.castTime >= 0) {
      const t = this.castTime / 0.3;

      if (t >= 1) this.castTime = -1;
      else {
        this.arms[0].rotation.x = -1.6 * Math.sin(t * Math.PI);
        this.castTime += dt;
      }
    }

    this.arms[1].rotation.x = swordRaise;
    this.arms[1].rotation.z = swordSweep;
    this.forearm.rotation.x = forearmBend;

    for (let i = 0; i < this.strands.length; i++) {
      this.strands[i].rotation.x = 0.1 + walk * 0.45 + Math.sin(this.time * 3 + i) * 0.06;
    }
    this.updateCloak(walk);

    this.flash = Math.max(0, this.flash - dt * 4);
    for (const surface of this.surfaces) surface.emissive.setRGB(this.flash, this.flash * 0.25, 0);
  }
}
