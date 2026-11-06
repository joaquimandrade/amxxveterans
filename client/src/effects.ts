import * as THREE from "three";

const PARTICLES = 600;

type Particle = { life: number; maxLife: number; velocity: THREE.Vector3 };

/** Fixed pool of additive particles shared by trails and explosions. */
export class Effects {
  private positions = new Float32Array(PARTICLES * 3);
  private colors = new Float32Array(PARTICLES * 3);
  private particles: Particle[] = [];
  private next = 0;
  private points: THREE.Points;

  constructor(private scene: THREE.Scene) {
    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.5,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
    this.positions.fill(-1000);
    for (let i = 0; i < PARTICLES; i++) {
      this.particles.push({ life: 0, maxLife: 1, velocity: new THREE.Vector3() });
    }
    scene.add(this.points);
  }

  createFireball() {
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd27a }),
    );

    ball.add(new THREE.PointLight(0xff7a18, 24, 11));
    this.scene.add(ball);
    return ball;
  }

  private spawn(position: THREE.Vector3, velocity: THREE.Vector3, life: number) {
    const particle = this.particles[this.next];

    this.positions.set([position.x, position.y, position.z], this.next * 3);
    particle.velocity.copy(velocity);
    particle.life = particle.maxLife = life;
    this.next = (this.next + 1) % PARTICLES;
  }

  trail(position: THREE.Vector3) {
    for (let i = 0; i < 3; i++) {
      const velocity = new THREE.Vector3().randomDirection().multiplyScalar(1.2);

      this.spawn(position, velocity, 0.35 + Math.random() * 0.25);
    }
  }

  explode(x: number, z: number) {
    const center = new THREE.Vector3(x, 1, z);

    for (let i = 0; i < 70; i++) {
      const velocity = new THREE.Vector3().randomDirection().multiplyScalar(4 + Math.random() * 9);

      this.spawn(center, velocity, 0.4 + Math.random() * 0.5);
    }
  }

  update(dt: number) {
    for (let i = 0; i < PARTICLES; i++) {
      const particle = this.particles[i];

      if (particle.life <= 0) {
        this.colors.fill(0, i * 3, i * 3 + 3);
        continue;
      }
      particle.life -= dt;
      particle.velocity.multiplyScalar(Math.exp(-3 * dt));
      this.positions[i * 3] += particle.velocity.x * dt;
      this.positions[i * 3 + 1] += particle.velocity.y * dt;
      this.positions[i * 3 + 2] += particle.velocity.z * dt;

      const heat = Math.max(0, particle.life / particle.maxLife);

      this.colors.set([heat, heat * heat * 0.55, heat * heat * heat * 0.15], i * 3);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
