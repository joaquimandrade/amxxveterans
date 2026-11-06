import { AREAS, MANSION } from "../../shared/areas.ts";
import { OBJECTS, SPRITES } from "../../shared/forest.ts";

declare const __BUILD__: string;

const CELL_W = 340;
const CELL_H = 300;
const FEET_Y = 282;
const WALK_FRAMES = 8;
const SLASH_FRAMES = 5;
/* Distance covered by one full walk cycle, so the feet do not slide */
const WALK_STRIDE = 150;
const RUN_STRIDE = 215;
const SLASH_MS = 420;
const MAX_PARTICLES = 500;
const NIGHT = "rgba(7,9,22,0.84)";
const LIGHT_SCALE = 0.25;
const RAIN_DROPS = 150;
const LAMP_RADIUS = 330;
const HERO_LIGHT_RADIUS = 260;

export type PlayerView = {
  x: number;
  y: number;
  aim: number;
  moving: boolean;
  hue: number;
  name: string;
  weapon: string;
  isSelf: boolean;
  running: boolean;
  walkDistance: number;
  slashTime: number;
  flash: number;
};

type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number };

export type Camera = { x: number; y: number; zoom: number };

export type Pickable = { id: string; sprite?: string; label?: string; x: number; y: number };

function loadImage(url: string) {
  const image = new Image();

  image.src = url;
  return image.decode().then(() => image);
}

export const ITEM_KINDS = [
  "axe", "chest", "chest_open", "potion_mana", "potion_health", "sword", "coins", "ring", "helmet", "pouch",
];
const HERO_SHEETS = ["idle_front", "idle_back", "walk_front", "walk_back", "slash_front", "slash_back"];

export const artUrl = (base: string, name: string) => `${base}art/${name}.webp?v=${__BUILD__}`;

export async function loadArt(base: string) {
  const load = (names: string[]) =>
    Promise.all(names.map(async (name) => [name, await loadImage(artUrl(base, name))] as const));
  const sprites = new Map(
    await load([
      "ground",
      "mansion",
      "room_hall",
      "room_upper",
      ...SPRITES.map((sprite) => sprite.name),
      ...ITEM_KINDS.map((kind) => `item_${kind}`),
      ...HERO_SHEETS.flatMap((sheet) => [`hero_${sheet}`, `hero_axe_${sheet}`]),
    ]),
  );

  return { sprites };
}

export type Art = Awaited<ReturnType<typeof loadArt>>;

export class Renderer {
  private context: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private markerTime = 0;
  private markerX = 0;
  private markerY = 0;
  private time = 0;
  private bolts: { points: { x: number; y: number }[]; life: number }[] = [];
  private night = document.createElement("canvas");
  private nightContext = this.night.getContext("2d")!;
  private rain = Array.from({ length: RAIN_DROPS }, () => ({ x: Math.random(), y: Math.random(), speed: 0.9 + Math.random() * 0.8 }));

  constructor(
    private canvas: HTMLCanvasElement,
    private art: Art,
  ) {
    this.context = canvas.getContext("2d", { alpha: false })!;
  }

  resize() {
    const scale = Math.min(devicePixelRatio, 1.5);

    this.canvas.width = innerWidth * scale;
    this.canvas.height = innerHeight * scale;
    this.night.width = Math.ceil(this.canvas.width * LIGHT_SCALE);
    this.night.height = Math.ceil(this.canvas.height * LIGHT_SCALE);
  }

  viewScale(camera: Camera) {
    return (this.canvas.width / innerWidth) * camera.zoom;
  }

  /** Keeps the view inside the painting. */
  clampCamera(camera: Camera, areaName: string) {
    const { width: WORLD_W, height: WORLD_H } = AREAS[areaName];
    const scale = this.viewScale(camera);
    const halfW = this.canvas.width / scale / 2;
    const halfH = this.canvas.height / scale / 2;

    camera.x = halfW * 2 >= WORLD_W ? WORLD_W / 2 : Math.min(WORLD_W - halfW, Math.max(halfW, camera.x));
    camera.y = halfH * 2 >= WORLD_H ? WORLD_H / 2 : Math.min(WORLD_H - halfH, Math.max(halfH, camera.y));
  }

  toWorld(camera: Camera, screenX: number, screenY: number) {
    return {
      x: camera.x + (screenX - innerWidth / 2) / camera.zoom,
      y: camera.y + (screenY - innerHeight / 2) / camera.zoom,
    };
  }

  showMarker(x: number, y: number) {
    this.markerX = x;
    this.markerY = y;
    this.markerTime = 1;
  }

  private spawn(x: number, y: number, vx: number, vy: number, life: number, size: number) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({ x, y, vx, vy, life, maxLife: life, size });
  }

  trail(x: number, y: number) {
    for (let i = 0; i < 3; i++) {
      const angle = Math.random() * Math.PI * 2;

      this.spawn(x, y, Math.cos(angle) * 40, Math.sin(angle) * 40 - 30, 0.25 + Math.random() * 0.3, 9 + Math.random() * 9);
    }
  }

  explode(x: number, y: number) {
    for (let i = 0; i < 70; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 90 + Math.random() * 330;

      this.spawn(x, y - 40, Math.cos(angle) * speed, Math.sin(angle) * speed * 0.7, 0.35 + Math.random() * 0.45, 8 + Math.random() * 14);
    }
  }

  /** A jagged line between two points, redrawn as it fades. */
  addBolt(fromX: number, fromY: number, toX: number, toY: number) {
    const startY = fromY - 110;
    const endY = toY - 40;
    const length = Math.hypot(toX - fromX, endY - startY);
    const steps = Math.max(5, Math.round(length / 42));
    const normalX = -(endY - startY) / (length || 1);
    const normalY = (toX - fromX) / (length || 1);
    const points = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const offset = i === 0 || i === steps ? 0 : (Math.random() - 0.5) * 56;

      points.push({
        x: fromX + (toX - fromX) * t + normalX * offset,
        y: startY + (endY - startY) * t + normalY * offset,
      });
    }
    this.bolts.push({ points, life: 0.24 });
    for (let i = 0; i < 26; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 240;

      this.spawn(toX, endY, Math.cos(angle) * speed, Math.sin(angle) * speed * 0.7, 0.2 + Math.random() * 0.25, 5 + Math.random() * 7);
    }
  }

  private strokeBolt(points: { x: number; y: number }[], width: number, color: string) {
    const context = this.context;

    context.strokeStyle = color;
    context.lineWidth = width;
    context.beginPath();
    points.forEach((point, index) => (index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
    context.stroke();
  }

  private drawBolts(dt: number) {
    const context = this.context;

    context.globalCompositeOperation = "lighter";
    context.lineJoin = "round";
    this.bolts = this.bolts.filter((bolt) => {
      bolt.life -= dt;
      if (bolt.life <= 0) return false;
      const strength = bolt.life / 0.24;

      this.strokeBolt(bolt.points, 22, `rgba(90,130,255,${0.32 * strength})`);
      this.strokeBolt(bolt.points, 9, `rgba(150,190,255,${0.75 * strength})`);
      this.strokeBolt(bolt.points, 3, `rgba(245,250,255,${strength})`);
      return true;
    });
    context.globalCompositeOperation = "source-over";
  }

  private drawObject(object: (typeof OBJECTS)[number], heroes: PlayerView[]) {
    const context = this.context;
    const image = this.art.sprites.get(object.sprite)!;
    const width = image.width * object.scale;
    const height = image.height * object.scale;
    const left = object.x - width / 2;
    const top = object.y - height + 10;
    const self = heroes.find((hero) => hero.isSelf);

    /* Fade tall scenery that stands in front of your own hero */
    const covers = self && object.radius > 0 && height > 200 &&
      self.y < object.y && self.y > top && Math.abs(self.x - object.x) < width / 2;

    context.globalAlpha = covers ? 0.42 : 1;
    context.drawImage(image, left, top, width, height);
    context.globalAlpha = 1;
  }

  private drawMansion(heroes: PlayerView[]) {
    const context = this.context;
    const image = this.art.sprites.get("mansion")!;
    const left = MANSION.x - image.width / 2;
    const top = MANSION.y - image.height + 8;
    const self = heroes.find((hero) => hero.isSelf);
    const covers = self && self.y < MANSION.y - 40 && self.y > top && Math.abs(self.x - MANSION.x) < image.width / 2;

    context.globalAlpha = covers ? 0.42 : 1;
    context.drawImage(image, left, top);
    context.globalAlpha = 1;
  }

  private drawShadow(x: number, y: number, radiusX: number, radiusY: number, alpha: number) {
    const context = this.context;

    context.fillStyle = `rgba(30,22,10,${alpha})`;
    context.beginPath();
    context.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
    context.fill();
  }

  private drawHero(hero: PlayerView) {
    const context = this.context;
    const dx = Math.sin(hero.aim);
    const dy = Math.cos(hero.aim);
    const facesCamera = dy >= 0;
    const slashing = hero.slashTime >= 0;
    const prefix = hero.weapon === "axe" ? "hero_axe" : "hero";
    const action = slashing ? "slash" : hero.moving ? "walk" : "idle";
    const sheet = this.art.sprites.get(`${prefix}_${action}_${facesCamera ? "front" : "back"}`)!;
    const stride = hero.running ? RUN_STRIDE : WALK_STRIDE;
    const frame = slashing
      ? Math.min(SLASH_FRAMES - 1, Math.floor((hero.slashTime / SLASH_MS) * SLASH_FRAMES))
      : hero.moving ? Math.floor((hero.walkDistance / stride) * WALK_FRAMES) % WALK_FRAMES : 0;

    this.drawShadow(hero.x, hero.y, 46, 16, 0.32);

    context.strokeStyle = `hsl(${hero.hue * 360} 80% ${hero.isSelf ? 62 : 48}%)`;
    context.lineWidth = hero.isSelf ? 4 : 3;
    context.beginPath();
    context.ellipse(hero.x, hero.y, 52, 21, 0, 0, Math.PI * 2);
    context.stroke();

    context.save();
    context.translate(hero.x, hero.y);
    if (dx < 0) context.scale(-1, 1);
    context.drawImage(sheet, frame * CELL_W, 0, CELL_W, CELL_H, -CELL_W / 2, -FEET_Y, CELL_W, CELL_H);
    context.restore();

    if (hero.flash > 0) {
      context.fillStyle = `rgba(255,120,40,${hero.flash * 0.5})`;
      context.beginPath();
      context.ellipse(hero.x, hero.y - 80, 60, 94, 0, 0, Math.PI * 2);
      context.fill();
    }

    context.font = "600 22px ui-sans-serif, system-ui, sans-serif";
    context.textAlign = "center";
    context.fillStyle = "rgba(0,0,0,0.6)";
    context.fillText(hero.name, hero.x + 1, hero.y - 186);
    context.fillStyle = "#fff4dc";
    context.fillText(hero.name, hero.x, hero.y - 187);
  }

  private drawHotspot(item: Pickable, hovered: boolean) {
    const context = this.context;
    const pulse = 0.55 + Math.sin(this.time * 3) * 0.2;

    context.strokeStyle = `rgba(255,220,130,${hovered ? 1 : pulse})`;
    context.lineWidth = hovered ? 4 : 2;
    context.beginPath();
    context.ellipse(item.x, item.y, 46, 19, 0, 0, Math.PI * 2);
    context.stroke();
    if (!hovered || !item.label) return;
    context.font = "600 24px Georgia, serif";
    context.textAlign = "center";
    context.fillStyle = "rgba(0,0,0,0.75)";
    context.fillText(item.label, item.x + 1, item.y - 39);
    context.fillStyle = "#ffe9b0";
    context.fillText(item.label, item.x, item.y - 40);
  }

  private drawPickable(item: Pickable, hovered: boolean) {
    if (!item.sprite) return this.drawHotspot(item, hovered);
    const context = this.context;
    const image = this.art.sprites.get(item.sprite)!;

    this.drawShadow(item.x, item.y, image.width * 0.42, image.height * 0.16, 0.3);
    if (hovered) {
      context.strokeStyle = "rgba(255,236,150,0.95)";
      context.lineWidth = 3;
      context.beginPath();
      context.ellipse(item.x, item.y, image.width * 0.6, image.height * 0.3, 0, 0, Math.PI * 2);
      context.stroke();
    }
    context.drawImage(image, item.x - image.width / 2, item.y - image.height + 8);
  }

  private drawFireball(x: number, y: number) {
    const context = this.context;
    const pulse = 1 + Math.sin(this.time * 30) * 0.08;
    const glow = context.createRadialGradient(x, y - 60, 0, x, y - 60, 92 * pulse);

    this.drawShadow(x, y, 24, 9, 0.28);
    glow.addColorStop(0, "rgba(255,246,210,1)");
    glow.addColorStop(0.2, "rgba(255,190,70,0.95)");
    glow.addColorStop(0.5, "rgba(255,92,20,0.42)");
    glow.addColorStop(1, "rgba(255,50,0,0)");
    context.globalCompositeOperation = "lighter";
    context.fillStyle = glow;
    context.fillRect(x - 96, y - 156, 192, 192);
    context.globalCompositeOperation = "source-over";
  }

  private drawParticles(dt: number) {
    const context = this.context;

    context.globalCompositeOperation = "lighter";
    this.particles = this.particles.filter((particle) => {
      particle.life -= dt;
      if (particle.life <= 0) return false;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.exp(-3 * dt);
      particle.vy *= Math.exp(-3 * dt);

      const heat = particle.life / particle.maxLife;

      context.fillStyle = `rgba(255,${Math.round(90 + heat * 130)},${Math.round(heat * heat * 70)},${heat * 0.8})`;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size * (0.5 + heat * 0.5), 0, Math.PI * 2);
      context.fill();
      return true;
    });
    context.globalCompositeOperation = "source-over";
  }

  private drawMarker(dt: number) {
    if (this.markerTime <= 0) return;
    const context = this.context;

    this.markerTime -= dt * 1.5;
    context.strokeStyle = `rgba(180,255,120,${Math.max(0, this.markerTime)})`;
    context.lineWidth = 4;
    context.beginPath();
    context.ellipse(this.markerX, this.markerY, 16 + 30 * this.markerTime, 7 + 12 * this.markerTime, 0, 0, Math.PI * 2);
    context.stroke();
  }

  /** Paints darkness over the frame and cuts soft holes where there is light. */
  private drawNight(camera: Camera, heroes: PlayerView[], shots: { x: number; y: number }[]) {
    const night = this.nightContext;
    const { width, height } = this.night;
    const worldScale = this.viewScale(camera) * LIGHT_SCALE;
    const toX = (x: number) => (x - camera.x) * worldScale + width / 2;
    const toY = (y: number) => (y - camera.y) * worldScale + height / 2;
    const hole = (x: number, y: number, radius: number, strength: number) => {
      const size = radius * worldScale;
      const px = toX(x);
      const py = toY(y);

      if (px < -size || py < -size || px > width + size || py > height + size) return;
      const gradient = night.createRadialGradient(px, py, 0, px, py, size);

      gradient.addColorStop(0, `rgba(0,0,0,${strength})`);
      gradient.addColorStop(0.45, `rgba(0,0,0,${strength * 0.55})`);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      night.fillStyle = gradient;
      night.fillRect(px - size, py - size, size * 2, size * 2);
    };

    night.globalCompositeOperation = "source-over";
    night.clearRect(0, 0, width, height);
    night.fillStyle = NIGHT;
    night.fillRect(0, 0, width, height);
    night.globalCompositeOperation = "destination-out";

    for (const object of OBJECTS) {
      if (object.light) hole(object.x, object.y - 170, LAMP_RADIUS, 0.95);
      else if (object.radius > 60) hole(object.x, object.y - 170 * object.scale, 170, 0.5);
    }
    hole(MANSION.x - 170, MANSION.y - 60, 230, 0.8);
    hole(MANSION.x, MANSION.y - 320, 380, 0.45);
    for (const hero of heroes) hole(hero.x, hero.y - 80, HERO_LIGHT_RADIUS, hero.isSelf ? 0.9 : 0.7);
    for (const shot of shots) hole(shot.x, shot.y - 60, 300, 1);
    for (const bolt of this.bolts) {
      const middle = bolt.points[bolt.points.length >> 1];

      hole(middle.x, middle.y, 620, bolt.life / 0.24);
    }

    const context = this.context;

    context.imageSmoothingEnabled = true;
    context.drawImage(this.night, 0, 0, this.canvas.width, this.canvas.height);
  }

  private drawLampGlow() {
    const context = this.context;

    context.globalCompositeOperation = "lighter";
    for (const object of OBJECTS) {
      if (!object.light) continue;
      const y = object.y - 205;
      const flicker = 1 + Math.sin(this.time * 9 + object.x) * 0.04;
      const glow = context.createRadialGradient(object.x, y, 0, object.x, y, 150 * flicker);

      glow.addColorStop(0, "rgba(255,170,70,0.5)");
      glow.addColorStop(0.3, "rgba(255,120,40,0.16)");
      glow.addColorStop(1, "rgba(255,90,20,0)");
      context.fillStyle = glow;
      context.fillRect(object.x - 160, y - 160, 320, 320);
    }
    context.globalCompositeOperation = "source-over";
  }

  private drawRain(dt: number) {
    const context = this.context;
    const { width, height } = this.canvas;

    context.strokeStyle = "rgba(170,190,235,0.2)";
    context.lineWidth = 1;
    context.beginPath();
    for (const drop of this.rain) {
      drop.y = (drop.y + drop.speed * dt) % 1;
      drop.x = (drop.x - drop.speed * dt * 0.12 + 1) % 1;
      const x = drop.x * width;
      const y = drop.y * height;

      context.moveTo(x, y);
      context.lineTo(x - 4, y + 24);
    }
    context.stroke();
  }

  private drawVignette() {
    const context = this.context;
    const { width, height } = this.canvas;
    const shade = context.createRadialGradient(
      width / 2, height / 2, height * 0.45, width / 2, height / 2, Math.hypot(width, height) * 0.6,
    );

    shade.addColorStop(0, "rgba(20,12,5,0)");
    shade.addColorStop(1, "rgba(2,3,10,0.55)");
    context.fillStyle = shade;
    context.fillRect(0, 0, width, height);
  }

  draw(
    areaName: string,
    camera: Camera,
    heroes: PlayerView[],
    shots: { x: number; y: number }[],
    pickables: Pickable[],
    hovered: string | undefined,
    dt: number,
  ) {
    const context = this.context;
    const scale = this.viewScale(camera);

    this.time += dt;
    context.setTransform(scale, 0, 0, scale, this.canvas.width / 2 - camera.x * scale, this.canvas.height / 2 - camera.y * scale);
    const isCity = areaName === "city";
    const area = AREAS[areaName];

    context.fillStyle = "#0a0a10";
    context.fillRect(camera.x - 8192, camera.y - 8192, 16384, 16384);
    context.drawImage(this.art.sprites.get(isCity ? "ground" : `room_${areaName}`)!, 0, 0, area.width, area.height);
    this.drawMarker(dt);

    /* Painter's order: whatever stands lower on the map is drawn later */
    const items = [
      ...(isCity ? OBJECTS : []).map((object) => ({ y: object.y, draw: () => this.drawObject(object, heroes) })),
      ...(isCity ? [{ y: MANSION.y, draw: () => this.drawMansion(heroes) }] : []),
      ...pickables.map((item) => ({ y: item.y, draw: () => this.drawPickable(item, item.id === hovered) })),
      ...heroes.map((hero) => ({ y: hero.y, draw: () => this.drawHero(hero) })),
      ...shots.map((shot) => ({ y: shot.y, draw: () => this.drawFireball(shot.x, shot.y) })),
    ].sort((a, b) => a.y - b.y);

    for (const item of items) item.draw();

    context.setTransform(1, 0, 0, 1, 0, 0);
    if (isCity) this.drawNight(camera, heroes, shots);
    context.setTransform(scale, 0, 0, scale, this.canvas.width / 2 - camera.x * scale, this.canvas.height / 2 - camera.y * scale);
    if (isCity) this.drawLampGlow();
    this.drawBolts(dt);
    this.drawParticles(dt);

    context.setTransform(1, 0, 0, 1, 0, 0);
    if (isCity) this.drawRain(dt);
    this.drawVignette();
  }
}
