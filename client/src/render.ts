/** Loads the painted art and draws the square: ground, depth-sorted sprites, energy bars and effects. */
import { CHARS, DOUBLES, FIRE_RADIUS, OBJECTS, WEAPONS, WEAPON_ORDER, WORLD } from "./data.ts";
import type { Actor, Game, Obj } from "./game.ts";
import manifest from "./manifest.json";

type Picture = HTMLImageElement | HTMLCanvasElement;

const art = new Map<string, Picture>();
const [CELL_W, CELL_H] = manifest.cell;
const PX = manifest.px;
const SIDES = ["front", "back"];
const KINDS = ["idle", "walk", ...WEAPON_ORDER];

export const artUrl = (name: string) => `${import.meta.env.BASE_URL}art/${name}.webp`;

function load(name: string) {
  return new Promise<void>((resolve) => {
    const image = new Image();

    image.onload = () => { art.set(name, image); resolve(); };
    image.onerror = () => resolve();
    image.src = artUrl(name);
  });
}

export async function loadArt(progress: (done: number) => void) {
  const names = ["ground", ...WEAPON_ORDER.map((w) => `icon_${w}`)];

  for (const name of Object.keys(OBJECTS)) names.push(`obj_${name}`, `obj_${name}_wreck`);
  for (const char of CHARS) for (const kind of KINDS) for (const side of SIDES) names.push(`${char.id}_${kind}_${side}`);
  let done = 0;

  await Promise.all(names.map((name) => load(name).then(() => progress(++done / names.length))));
}

/** Re-dyes one hue range of a sheet, so the fourth rioter does not look like a twin. */
function dyed(source: Picture, from: [number, number], shift: number) {
  const canvas = document.createElement("canvas");

  canvas.width = source.width; canvas.height = source.height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;

  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;

    if (delta < 0.12) continue;
    let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
    if (hue < from[0] || hue > from[1]) continue;
    const light = (max + min) / 2, chroma = delta, h = ((hue + shift) % 360) / 60;
    const x = chroma * (1 - Math.abs((h % 2) - 1)), m = light - chroma / 2;
    const [nr, ng, nb] = h < 1 ? [chroma, x, 0] : h < 2 ? [x, chroma, 0] : h < 3 ? [0, chroma, x] : h < 4 ? [0, x, chroma] : h < 5 ? [x, 0, chroma] : [chroma, 0, x];

    data[i] = (nr + m) * 255; data[i + 1] = (ng + m) * 255; data[i + 2] = (nb + m) * 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

export function prepareDouble(sheet: string) {
  const base = sheet.replace("_double", "");
  const recipe = DOUBLES[base];

  if (!recipe || art.has(`${sheet}_idle_front`)) return;
  for (const kind of KINDS) for (const side of SIDES) {
    const source = art.get(`${base}_${kind}_${side}`);
    if (source) art.set(`${sheet}_${kind}_${side}`, dyed(source, recipe.from, recipe.shift));
  }
}

/** Soft brush dabs for fire and smoke, painted once. */
function dab(inner: string, outer: string) {
  const canvas = document.createElement("canvas");

  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;

  for (let i = 0; i < 5; i++) {
    const x = 32 + Math.cos(i * 2.4) * 7, y = 32 + Math.sin(i * 2.4) * 7;
    const gradient = context.createRadialGradient(x, y, 2, x, y, 22);

    gradient.addColorStop(0, inner); gradient.addColorStop(1, outer);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  return canvas;
}

const flames = [dab("rgba(255,240,170,.55)", "rgba(255,150,30,0)"), dab("rgba(255,170,60,.5)", "rgba(230,60,10,0)"), dab("rgba(255,110,40,.45)", "rgba(150,20,0,0)")];
const smoke = dab("rgba(60,54,50,.3)", "rgba(40,36,34,0)");

export const camera = { x: WORLD.w / 2, y: WORLD.h / 2, zoom: 1, left: 0, top: 0 };

export function toWorld(sx: number, sy: number) {
  return { x: camera.left + sx / camera.zoom, y: camera.top + sy / camera.zoom };
}

function actorFrame(a: Actor): [string, number] {
  const side = a.back ? "back" : "front";

  if (a.attack) {
    const stats = WEAPONS[a.attack.weapon];
    const t = a.attack.t;
    const frame = t < stats.fireAt * 0.9 ? 1 : t < stats.fireAt + (stats.duration - stats.fireAt) * 0.5 ? 2 : 3;

    return [`${a.sheet}_${a.attack.weapon}_${side}`, frame];
  }
  if (a.moving) return [`${a.sheet}_walk_${side}`, Math.floor(a.walk / 30) % 4];
  // Standing still shows the ready stance of the weapon in hand.
  return [`${a.sheet}_${a.weapon}_${side}`, 0];
}

function drawActor(c: CanvasRenderingContext2D, a: Actor, time: number) {
  const [sheet, frame] = actorFrame(a);
  const image = art.get(sheet) ?? art.get(`${a.sheet}_idle_front`);

  c.fillStyle = "rgba(20,14,10,.34)";
  c.beginPath(); c.ellipse(a.x, a.y, 30, 11, 0, 0, 7); c.fill();
  c.strokeStyle = a.color; c.lineWidth = a.isPlayer ? 3.5 : 2; c.globalAlpha = a.isPlayer ? 0.95 : 0.6;
  c.beginPath(); c.ellipse(a.x, a.y, 34, 13, 0, 0, 7); c.stroke();
  c.globalAlpha = 1;
  if (!image) return;
  const bob = a.moving ? Math.abs(Math.sin((a.walk / 30) * Math.PI)) * 2 : Math.sin(time * 2.4 + a.id) * 0.8;

  c.save();
  c.translate(a.x, a.y - bob);
  if (a.flip) c.scale(-1, 1);
  c.drawImage(image, frame * CELL_W, 0, CELL_W, CELL_H, -CELL_W / PX / 2, -manifest.feet / PX, CELL_W / PX, CELL_H / PX);
  c.restore();
}

function drawObject(c: CanvasRenderingContext2D, o: Obj) {
  const intact = art.get(`obj_${o.name}`), wreck = art.get(`obj_${o.name}_wreck`);
  const size = manifest.objects[o.name as keyof typeof manifest.objects];
  const damage = 1 - o.hp / o.def.hp;
  const shift = o.shake > 0 ? Math.sin(o.shake * 90) * 3 * (o.shake / 0.18) : 0;

  if (o.def.depth > 0) {
    c.fillStyle = "rgba(20,14,10,.3)";
    c.beginPath(); c.ellipse(o.x, o.y - o.def.depth * 0.35, (o.x1 - o.x0) * 0.58, Math.max(10, o.def.depth * 0.6), 0, 0, 7); c.fill();
  }
  c.save();
  c.translate(o.x + shift, o.y);
  if (o.flip) c.scale(-1, 1);
  if (!o.dead && intact) c.drawImage(intact, -o.w / 2, -o.h, o.w, o.h);
  if (wreck && (o.dead || damage > 0.02)) {
    const w = size.wreck[0] / PX, h = size.wreck[1] / PX;

    c.globalAlpha = o.dead ? 1 : Math.pow(damage, 1.3) * 0.8;
    c.drawImage(wreck, -w / 2, -h, w, h);
  }
  if (o.flash > 0 && intact && !o.dead) {
    c.globalCompositeOperation = "lighter";
    c.globalAlpha = 0.4 * (o.flash / 0.12);
    c.drawImage(intact, -o.w / 2, -o.h, o.w, o.h);
  }
  c.restore();
}

function drawBar(c: CanvasRenderingContext2D, o: Obj, game: Game) {
  const width = Math.max(40, Math.min(o.w * 0.5, 120)), height = 8;
  const x = o.x - width / 2 + 14, y = o.y - Math.min(o.h, 210) - 16;
  const ratio = o.hp / o.def.hp;
  const close = Math.hypot(o.x - game.player.x, o.y - game.player.y) < 460 || ratio < 1;

  c.globalAlpha = close ? 1 : 0.5;
  c.fillStyle = "rgba(18,12,10,.8)";
  c.beginPath(); c.roundRect(x - 2, y - 2, width + 4, height + 4, 4); c.fill();
  c.fillStyle = ratio > 0.5 ? "#7fd14e" : ratio > 0.25 ? "#f0b93a" : "#e8503a";
  c.beginPath(); c.roundRect(x, y, Math.max(2, width * ratio), height, 3); c.fill();
  // The weapon this object is weak to sits at the left end of its bar.
  const icon = art.get(`icon_${o.def.weak}`);
  const lit = o.def.weak === game.player.weapon;

  c.fillStyle = lit ? "#ffd84a" : "rgba(18,12,10,.8)";
  c.beginPath(); c.arc(x - 17, y + height / 2, 16, 0, 7); c.fill();
  if (icon) c.drawImage(icon, x - 31, y + height / 2 - 14, 28, 28);
  c.globalAlpha = 1;
}

export function draw(c: CanvasRenderingContext2D, game: Game, width: number, height: number, dpr: number, time: number, dt: number) {
  const zoom = Math.max(0.5, Math.min(0.95, Math.sqrt(width * height) / 950));
  const p = game.player;
  const viewW = width / zoom, viewH = height / zoom;
  const follow = 1 - Math.exp(-dt * 7);

  camera.zoom = zoom;
  camera.x += (p.x - camera.x) * follow;
  camera.y += (p.y - 60 - camera.y) * follow;
  const topLimit = WORLD.shopBase - 400;
  let left = viewW >= WORLD.w ? (WORLD.w - viewW) / 2 : Math.max(0, Math.min(WORLD.w - viewW, camera.x - viewW / 2));
  let top = viewH >= WORLD.h - topLimit ? (WORLD.h + topLimit - viewH) / 2 : Math.max(topLimit, Math.min(WORLD.h - viewH, camera.y - viewH / 2));

  if (game.shake > 0) {
    left += Math.sin(time * 97) * game.shake * 22;
    top += Math.cos(time * 83) * game.shake * 22;
  }
  camera.left = left; camera.top = top;

  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = "#1a1412";
  c.fillRect(0, 0, width, height);
  c.setTransform(dpr * zoom, 0, 0, dpr * zoom, -left * dpr * zoom, -top * dpr * zoom);

  const ground = art.get("ground");
  if (ground) c.drawImage(ground, 0, 0, WORLD.w, WORLD.h);
  for (const s of game.scorch) {
    const gradient = c.createRadialGradient(s.x, s.y, 4, s.x, s.y, s.r);
    gradient.addColorStop(0, "rgba(14,10,8,.5)"); gradient.addColorStop(1, "rgba(14,10,8,0)");
    c.save(); c.translate(0, s.y * 0.45); c.scale(1, 0.55);
    c.fillStyle = gradient; c.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
    c.restore();
  }
  c.globalCompositeOperation = "lighter";
  for (const f of game.fires) {
    const glow = Math.min(1, f.life / 0.6) * (0.75 + Math.sin(time * 18 + f.x) * 0.12);
    const gradient = c.createRadialGradient(f.x, f.y, 4, f.x, f.y, FIRE_RADIUS * 1.25);
    gradient.addColorStop(0, `rgba(255,150,40,${0.5 * glow})`); gradient.addColorStop(1, "rgba(255,90,0,0)");
    c.save(); c.translate(0, f.y * 0.45); c.scale(1, 0.55);
    c.fillStyle = gradient; c.fillRect(f.x - 140, f.y - 140, 280, 280);
    c.restore();
  }
  c.globalCompositeOperation = "source-over";

  const target = game.autoTarget;
  if (target && !game.over && !game.demo) {
    c.strokeStyle = "rgba(255,216,74,.85)"; c.lineWidth = 3; c.setLineDash([10, 8]); c.lineDashOffset = -time * 30;
    c.beginPath(); c.ellipse(target.x, target.y - target.def.depth / 2, (target.x1 - target.x0) / 2 + 14, Math.max(16, target.def.depth / 2 + 12), 0, 0, 7); c.stroke();
    c.setLineDash([]);
  }

  const visible = (x: number, y: number, w: number, h: number) => x + w > left && x - w < left + viewW && y > top - 20 && y - h < top + viewH;
  const sprites: { y: number; o?: Obj; a?: Actor }[] = [];

  for (const o of game.objs) if (visible(o.x, o.y, o.w, o.h + 60)) sprites.push({ y: o.def.depth ? o.y - o.def.depth * 0.3 : o.y, o });
  for (const a of game.actors) sprites.push({ y: a.y, a });
  sprites.sort((m, n) => m.y - n.y);
  for (const s of sprites) s.o ? drawObject(c, s.o) : drawActor(c, s.a!, time);

  for (const q of game.particles) {
    const fade = q.life / q.max;

    if (q.kind === "flame") {
      const size = q.size * (0.5 + fade) * 2.4;
      c.globalCompositeOperation = "lighter";
      c.globalAlpha = Math.min(1, fade * 1.6);
      c.drawImage(flames[fade > 0.6 ? 0 : fade > 0.3 ? 1 : 2], q.x - size / 2, q.y - q.z - size * 0.6, size, size);
      c.globalCompositeOperation = "source-over";
    } else if (q.kind === "smoke") {
      const size = q.size * (2.2 - fade) * 2.2;
      c.globalAlpha = Math.min(1, fade * 1.4);
      c.drawImage(smoke, q.x - size / 2, q.y - q.z - size / 2, size, size);
    } else {
      c.globalAlpha = Math.min(1, q.life * 3);
      c.fillStyle = q.kind === "shard" ? `hsl(${185 + q.hue * 25},60%,${70 + q.hue * 22}%)` : q.kind === "spark" ? `hsl(${35 + q.hue * 20},100%,${60 + q.hue * 30}%)` : `hsl(${20 + q.hue * 15},30%,${14 + q.hue * 22}%)`;
      c.save(); c.translate(q.x, q.y - q.z); c.rotate(q.hue * 6 + q.life * 9);
      if (q.kind === "spark") c.fillRect(-q.size, -1.2, q.size * 2, 2.4);
      else { c.beginPath(); c.moveTo(-q.size, -q.size * 0.4); c.lineTo(q.size * 0.7, -q.size * 0.7); c.lineTo(q.size * 0.3, q.size * 0.8); c.fill(); }
      c.restore();
    }
  }
  c.globalAlpha = 1;

  for (const b of game.bottles) {
    const x = b.x0 + (b.x1 - b.x0) * b.t, y = b.y0 + (b.y1 - b.y0) * b.t, z = 70 * (1 - b.t) + Math.sin(b.t * Math.PI) * 130;

    c.fillStyle = "rgba(20,14,10,.3)";
    c.beginPath(); c.ellipse(x, y, 9, 4, 0, 0, 7); c.fill();
    c.save(); c.translate(x, y - z); c.rotate(b.t * 14);
    c.fillStyle = "#3f7d4f"; c.beginPath(); c.roundRect(-5, -9, 10, 18, 3); c.fill();
    c.fillStyle = "#2f5f3c"; c.fillRect(-2.5, -15, 5, 7);
    c.globalCompositeOperation = "lighter";
    c.drawImage(flames[0], -16, -36, 32, 32);
    c.restore();
  }
  c.strokeStyle = "rgba(255,236,170,.9)"; c.lineWidth = 2;
  for (const t of game.tracers) {
    c.globalAlpha = t.life / 0.09;
    c.beginPath(); c.moveTo(t.x0 + (t.x1 - t.x0) * 0.25, t.y0 + (t.y1 - t.y0) * 0.25); c.lineTo(t.x1, t.y1); c.stroke();
  }
  c.globalAlpha = 1;

  for (const o of game.objs) if (!o.dead && !o.def.decor && visible(o.x, o.y, o.w, o.h + 60)) drawBar(c, o, game);

  c.textAlign = "center";
  for (const a of game.actors) {
    c.font = "700 17px system-ui, sans-serif";
    c.lineWidth = 4; c.strokeStyle = "rgba(18,12,10,.85)"; c.fillStyle = a.color;
    const label = a.isPlayer ? "YOU" : a.name;
    c.strokeText(label, a.x, a.y - 142); c.fillText(label, a.x, a.y - 142);
    if (a.isPlayer) { c.beginPath(); c.moveTo(a.x - 7, a.y - 137); c.lineTo(a.x + 7, a.y - 137); c.lineTo(a.x, a.y - 128); c.fill(); }
  }
  for (const f of game.floaters) {
    c.globalAlpha = Math.min(1, f.life * 2.5);
    c.font = `800 ${f.big ? 30 : 19}px system-ui, sans-serif`;
    c.lineWidth = 5; c.strokeStyle = "rgba(18,12,10,.9)"; c.fillStyle = f.color;
    c.strokeText(f.text, f.x, f.y); c.fillText(f.text, f.x, f.y);
  }
  c.globalAlpha = 1;
}
