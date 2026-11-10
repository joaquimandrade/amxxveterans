/** The round: four rioters, the objects of the square, weapons, damage, scores and the bots. No drawing here. */
import {
  BURN_PER_SECOND, CHARS, DOUBLES, FIRE_RADIUS, FIRE_SECONDS, LAYOUT, OBJECTS, RESIST, ROUND_SECONDS,
  SPECIALTY, WEAK, WEAPONS, WORLD,
} from "./data.ts";
import type { CharDef, ObjDef, Weapon } from "./data.ts";
import manifest from "./manifest.json";

export interface Obj {
  name: string; def: ObjDef; x: number; y: number; flip: boolean;
  /** Sprite size in world units. */
  w: number; h: number;
  x0: number; x1: number; y0: number; y1: number;
  hp: number; dead: boolean; flash: number; shake: number; burn: number;
}

export interface Attack { weapon: Weapon; t: number; fired: boolean; tx: number; ty: number }

interface Bot { target: Obj | null; weapon: Weapon; wait: number; retarget: number; stuck: number; lastX: number; lastY: number; side: number; sideT: number }

export interface Actor {
  id: number; name: string; char: CharDef; sheet: string; color: string; isPlayer: boolean;
  x: number; y: number; back: boolean; flip: boolean; moving: boolean; walk: number;
  weapon: Weapon; cooldown: number; attack: Attack | null; score: number; kills: number; bot: Bot | null;
}

export interface Particle {
  kind: "flame" | "smoke" | "spark" | "shard" | "debris";
  x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; hue: number;
}
export interface Floater { x: number; y: number; text: string; color: string; life: number; big: boolean }
export interface Bottle { owner: Actor; x0: number; y0: number; x1: number; y1: number; t: number }
export interface Fire { owner: Actor; x: number; y: number; life: number; tick: number }
export interface Tracer { x0: number; y0: number; x1: number; y1: number; life: number }
export interface Input { mx: number; my: number; attack: boolean; aim: { x: number; y: number } | null }

const sizes = manifest.objects as Record<string, { size: number[]; wreck: number[] }>;
const RADIUS = 14;
const SPEED = 235;
/** Stretches every energy bar so four rioters need about the whole round to flatten the square. */
const TOUGHNESS = 2.2;
const rand = (low: number, high: number) => low + Math.random() * (high - low);

export class Game {
  objs: Obj[] = [];
  actors: Actor[] = [];
  player: Actor;
  particles: Particle[] = [];
  floaters: Floater[] = [];
  bottles: Bottle[] = [];
  fires: Fire[] = [];
  tracers: Tracer[] = [];
  scorch: { x: number; y: number; r: number }[] = [];
  sounds: string[] = [];
  time = ROUND_SECONDS;
  over = false;
  shake = 0;
  autoTarget: Obj | null = null;
  /** Lets the test harness hand the player's character to a bot. */
  demo = false;

  constructor(playerChar: string) {
    for (const [name, x, y, flip] of LAYOUT) {
      const def = { ...OBJECTS[name], hp: Math.round(OBJECTS[name].hp * TOUGHNESS) };
      const w = sizes[name].size[0] / manifest.px, h = sizes[name].size[1] / manifest.px;
      const half = (w * (def.foot ?? 1)) / 2;

      this.objs.push({
        name, def, x, y, flip: !!flip, w, h, x0: x - half, x1: x + half, y0: y - def.depth, y1: y,
        hp: def.hp, dead: false, flash: 0, shake: 0, burn: 0,
      });
    }
    const mine = CHARS.find((c) => c.id === playerChar) ?? CHARS[0];
    const others = CHARS.filter((c) => c !== mine);
    const doubleOf = mine.id === "moussa" ? "yasmine" : "moussa";
    const double = CHARS.find((c) => c.id === doubleOf)!;
    const cast: [CharDef, string, string, string][] = [
      [mine, mine.name, mine.id, mine.color],
      ...others.map((c) => [c, c.name, c.id, c.color] as [CharDef, string, string, string]),
      [double, DOUBLES[doubleOf].name, `${doubleOf}_double`, DOUBLES[doubleOf].color],
    ];
    const starts = [[1200, 900], [520, 980], [1880, 960], [1200, 1420]];

    cast.forEach(([char, name, sheet, color], id) => {
      this.actors.push({
        id, name, char, sheet, color, isPlayer: id === 0, x: starts[id][0], y: starts[id][1], back: false,
        flip: id % 2 === 1, moving: false, walk: 0, weapon: char.special, cooldown: 0, attack: null, score: 0, kills: 0,
        bot: id === 0 ? null : this.newBot(char.special),
      });
    });
    this.player = this.actors[0];
  }

  private newBot(weapon: Weapon): Bot {
    return { target: null, weapon, wait: rand(0.3, 1.2), retarget: 0, stuck: 0, lastX: 0, lastY: 0, side: 1, sideT: 0 };
  }

  get alive() { return this.objs.filter((o) => !o.dead && !o.def.decor); }

  ranking() { return [...this.actors].sort((a, b) => b.score - a.score); }

  /** Distance from a point to an object's footprint, and the nearest point of it. */
  private nearest(o: Obj, x: number, y: number) {
    const px = Math.max(o.x0, Math.min(x, o.x1)), py = Math.max(o.y0, Math.min(y, o.y1));

    return { px, py, d: Math.hypot(x - px, y - py) };
  }

  private blocked(x: number, y: number) {
    if (x < 30 || x > WORLD.w - 30 || y < WORLD.shopBase + RADIUS || y > WORLD.h - 24) return true;
    for (const o of this.objs) {
      if (o.def.depth === 0 || (o.dead && o.def.clears)) continue;
      if (x > o.x0 - RADIUS && x < o.x1 + RADIUS && y > o.y0 - RADIUS && y < o.y1 + RADIUS) return true;
    }
    return false;
  }

  private move(a: Actor, dx: number, dy: number, dt: number, speed: number) {
    const length = Math.hypot(dx, dy);

    a.moving = length > 0.15 && !a.attack;
    if (!a.moving) return;
    const step = speed * dt * Math.min(1, length);
    const nx = a.x + (dx / length) * step, ny = a.y + (dy / length) * step;

    // Someone caught inside a footprint may always walk out of it.
    const stuck = this.blocked(a.x, a.y);
    if (stuck || !this.blocked(nx, a.y)) a.x = Math.max(30, Math.min(WORLD.w - 30, nx));
    if (stuck || !this.blocked(a.x, ny)) a.y = Math.max(WORLD.shopBase + RADIUS, Math.min(WORLD.h - 24, ny));
    a.walk += step;
    this.face(a, dx, dy);
  }

  private face(a: Actor, dx: number, dy: number) {
    const length = Math.hypot(dx, dy) || 1;

    if (Math.abs(dx / length) > 0.2) a.flip = dx < 0;
    // A little hysteresis so walking sideways does not flicker between front and back.
    if (dy / length < -0.3) a.back = true;
    else if (dy / length > -0.1) a.back = false;
  }

  /** The object the attack button would go for with this weapon, nearest and most in front first. */
  private pickAuto(a: Actor): Obj | null {
    const reach = WEAPONS[a.weapon].reach;
    let best: Obj | null = null, bestScore = Infinity;

    for (const o of this.objs) {
      if (o.dead || o.def.decor) continue;
      const { px, py, d } = this.nearest(o, a.x, a.y);
      if (d > reach * (a.weapon === "bat" ? 1.6 : 1)) continue;
      const ahead = ((px - a.x) * (a.flip ? -1 : 1)) / (d || 1);
      const score = d - ahead * 40 - (o.def.weak === a.weapon ? 70 : 0) + (a.weapon !== "bat" && d < 60 ? 80 : 0);

      if (score < bestScore) { best = o; bestScore = score; }
    }
    return best;
  }

  private aimPoint(a: Actor, o: Obj) {
    if (a.weapon === "bat") {
      const { px, py } = this.nearest(o, a.x, a.y);
      return { x: px, y: py };
    }
    return { x: o.x, y: (o.y0 + o.y1) / 2 };
  }

  startAttack(a: Actor, tx: number, ty: number) {
    if (a.cooldown > 0 || a.attack || this.over) return;
    a.attack = { weapon: a.weapon, t: 0, fired: false, tx, ty };
    a.cooldown = WEAPONS[a.weapon].cooldown;
    a.moving = false;
    const dx = tx - a.x, dy = ty - a.y;
    const length = Math.hypot(dx, dy) || 1;

    if (Math.abs(dx) > 4) a.flip = dx < 0;
    a.back = dy / length < -0.25;
    if (a.weapon === "bat") this.sounds.push("swing");
  }

  private hurt(o: Obj, amount: number, weapon: Weapon, by: Actor, x: number, y: number, quiet = false) {
    if (o.dead || o.def.decor) return;
    const weak = o.def.weak === weapon;
    const dealt = Math.min(o.hp, amount * (weak ? WEAK : RESIST) * (by.char.special === weapon ? SPECIALTY : 1));

    o.hp -= dealt;
    by.score += dealt;
    o.flash = 0.12;
    o.shake = 0.18;
    if (weapon === "molotov" && o.def.burns) o.burn = Math.max(o.burn, 1.2);
    if (!quiet) {
      this.floaters.push({ x: x + rand(-14, 14), y: y - 30, text: `${Math.round(dealt)}${weak ? "!" : ""}`, color: weak ? "#ffd84a" : "#d9d2c4", life: 0.8, big: false });
      this.burst(o, x, y, weak ? 7 : 3);
      if (by.isPlayer || this.near(x, y)) this.sounds.push(o.def.weak === "bat" ? "glass" : o.def.weak === "shotgun" ? "clang" : "thud");
    }
    if (o.hp <= 0.01) this.destroy(o, by);
  }

  private near(x: number, y: number) { return Math.hypot(x - this.player.x, y - this.player.y) < 520; }

  private destroy(o: Obj, by: Actor) {
    const bonus = Math.round(o.def.hp * 0.5 / 10) * 10;

    o.dead = true;
    o.hp = 0;
    o.burn = o.def.burns ? 6 : o.burn;
    by.score += bonus;
    by.kills++;
    this.floaters.push({ x: o.x, y: o.y - Math.min(o.h, 200) * 0.6, text: `+${bonus}`, color: by.color, life: 1.4, big: true });
    for (let i = 0; i < 26; i++) this.burst(o, o.x + rand(-o.w, o.w) * 0.35, o.y - rand(0, Math.min(o.h, 220)) * 0.7, 1);
    for (let i = 0; i < 8; i++) this.puff("smoke", o.x + rand(-o.w, o.w) * 0.3, o.y - 6, rand(20, 90));
    if (this.near(o.x, o.y)) {
      this.sounds.push("crash");
      this.shake = Math.max(this.shake, by.isPlayer ? 0.35 : 0.15);
    }
  }

  private burst(o: Obj, x: number, y: number, count: number) {
    const kind = o.def.weak === "bat" ? "shard" : o.def.weak === "shotgun" ? "spark" : "debris";

    for (let i = 0; i < count; i++) {
      this.particles.push({
        kind, x, y: Math.max(y, o.y0) + rand(0, 8), z: Math.max(8, o.y - y + rand(0, 30)), vx: rand(-150, 150), vy: rand(-30, 50),
        vz: rand(60, 260), life: rand(0.5, 1), max: 1, size: rand(3, 8), hue: rand(0, 1),
      });
    }
  }

  private puff(kind: "flame" | "smoke", x: number, y: number, z: number) {
    const life = kind === "flame" ? rand(0.35, 0.7) : rand(0.9, 1.8);

    this.particles.push({
      kind, x, y, z, vx: rand(-14, 14), vy: 0, vz: kind === "flame" ? rand(50, 120) : rand(40, 80), life, max: life,
      size: kind === "flame" ? rand(14, 30) : rand(22, 44), hue: rand(0, 1),
    });
  }

  private fire(a: Actor, attack: Attack) {
    const dx = attack.tx - a.x, dy = attack.ty - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length, uy = dy / length;
    const stats = WEAPONS[attack.weapon];

    if (attack.weapon === "bat") {
      let hit = false;
      for (const o of this.objs) {
        if (o.dead || o.def.decor) continue;
        const { px, py, d } = this.nearest(o, a.x, a.y);
        if (d > stats.reach) continue;
        if (d > 34 && ((px - a.x) * ux + (py - a.y) * uy) / d < 0.2) continue;
        this.hurt(o, stats.damage, "bat", a, px, py - Math.min(o.h * 0.4, 70));
        hit = true;
      }
      if (hit && a.isPlayer) this.shake = Math.max(this.shake, 0.08);
    } else if (attack.weapon === "shotgun") {
      const hits: { o: Obj; d: number }[] = [];
      for (const o of this.objs) {
        if (o.dead || o.def.decor) continue;
        const cx = o.x, cy = (o.y0 + o.y1) / 2;
        const d = Math.hypot(cx - a.x, cy - a.y);
        const near = this.nearest(o, a.x, a.y).d;
        if (near > stats.reach) continue;
        const along = (cx - a.x) * ux + (cy - a.y) * uy;
        const off = Math.abs((cx - a.x) * -uy + (cy - a.y) * ux);
        if (near > 30 && (along < 0 || off > (o.x1 - o.x0) / 2 + 26 + d * 0.12)) continue;
        hits.push({ o, d: near });
      }
      hits.sort((p, q) => p.d - q.d);
      const end = hits.length ? Math.max(hits[0].d + 40, 90) : stats.reach;
      hits.slice(0, 2).forEach(({ o, d }, index) => {
        this.hurt(o, stats.damage * (1 - 0.45 * d / stats.reach) * (index ? 0.5 : 1), "shotgun", a, o.x + rand(-20, 20), o.y - Math.min(o.h * 0.45, 90));
      });
      const mx = a.x + ux * 46, my = a.y + uy * 30 - 62;
      for (let i = 0; i < 7; i++) {
        const spread = rand(-0.13, 0.13), cos = Math.cos(spread), sin = Math.sin(spread);
        const reach = end * rand(0.8, 1.05);
        this.tracers.push({ x0: mx, y0: my, x1: mx + (ux * cos - uy * sin) * reach, y1: my + (ux * sin + uy * cos) * reach + 30, life: 0.09 });
      }
      for (let i = 0; i < 3; i++) this.puff("flame", mx + ux * 10, a.y + uy * 30, 62);
      this.puff("smoke", mx, a.y + uy * 30, 62);
      if (a.isPlayer || this.near(a.x, a.y)) this.sounds.push("shot");
      if (a.isPlayer) this.shake = Math.max(this.shake, 0.14);
    } else {
      const reach = Math.max(90, Math.min(length, stats.reach));
      this.bottles.push({ owner: a, x0: a.x + ux * 20, y0: a.y, x1: a.x + ux * reach, y1: Math.max(WORLD.shopBase - 30, a.y + uy * reach), t: 0 });
      if (a.isPlayer || this.near(a.x, a.y)) this.sounds.push("throw");
    }
  }

  private land(b: Bottle) {
    for (const o of this.objs) {
      const { d } = this.nearest(o, b.x1, b.y1);
      if (d < FIRE_RADIUS) this.hurt(o, WEAPONS.molotov.damage, "molotov", b.owner, o.x, o.y - Math.min(o.h * 0.4, 70));
    }
    this.fires.push({ owner: b.owner, x: b.x1, y: b.y1, life: FIRE_SECONDS, tick: 0.3 });
    this.scorch.push({ x: b.x1, y: b.y1, r: FIRE_RADIUS * 0.9 });
    if (this.scorch.length > 40) this.scorch.shift();
    for (let i = 0; i < 14; i++) this.puff("flame", b.x1 + rand(-60, 60), b.y1 + rand(-30, 30), rand(0, 30));
    for (let i = 0; i < 6; i++) {
      this.particles.push({ kind: "shard", x: b.x1, y: b.y1, z: 6, vx: rand(-120, 120), vy: rand(-40, 40), vz: rand(60, 180), life: 0.6, max: 1, size: 4, hue: 0.3 });
    }
    if (this.near(b.x1, b.y1)) this.sounds.push("whoosh");
  }

  private think(a: Actor, dt: number) {
    const bot = a.bot!;

    bot.retarget -= dt;
    if (!bot.target || bot.target.dead || bot.retarget <= 0) {
      let best: Obj | null = null, bestScore = Infinity;
      for (const o of this.objs) {
        if (o.dead || o.def.decor) continue;
        const d = this.nearest(o, a.x, a.y).d;
        const crowd = this.actors.filter((other) => other !== a && other.bot?.target === o).length;
        const score = d * (o.def.weak === a.char.special ? 0.55 : 1) * (1 + crowd * 0.6) + rand(0, 160) - (o === bot.target ? 200 : 0);
        if (score < bestScore) { best = o; bestScore = score; }
      }
      if (best !== bot.target) bot.wait = Math.max(bot.wait, rand(0.15, 0.5));
      bot.target = best;
      bot.retarget = rand(4, 7);
      if (best) bot.weapon = Math.random() < 0.72 ? best.def.weak : a.char.special;
    }
    const o = bot.target;
    if (!o) return;
    a.weapon = bot.weapon;
    const { px, py, d } = this.nearest(o, a.x, a.y);
    const [low, high] = a.weapon === "bat" ? [0, 54] : a.weapon === "shotgun" ? [70, 230] : [150, 330];
    let dx = 0, dy = 0;

    if (d > high) { dx = px - a.x; dy = py - a.y; }
    else if (d < low) { dx = a.x - px; dy = a.y - py + 0.01; }
    if (dx || dy) {
      const length = Math.hypot(dx, dy);
      dx /= length; dy /= length;
      if (bot.sideT > 0) {
        // Slide around whatever is in the way.
        bot.sideT -= dt;
        [dx, dy] = [-dy * bot.side + dx * 0.25, dx * bot.side + dy * 0.25];
      }
      this.move(a, dx, dy, dt, SPEED * 0.86);
      bot.stuck += dt;
      if (bot.stuck > 0.4) {
        if (Math.hypot(a.x - bot.lastX, a.y - bot.lastY) < 30) {
          bot.side = bot.sideT > 0 ? -bot.side : (Math.random() < 0.5 ? 1 : -1);
          bot.sideT = rand(0.5, 1.1);
        }
        bot.stuck = 0; bot.lastX = a.x; bot.lastY = a.y;
      }
      if (d > high + 40) return;
    } else {
      a.moving = false;
    }
    bot.wait -= dt;
    if (bot.wait <= 0 && a.cooldown <= 0 && !a.attack && d <= high + 40) {
      const aim = this.aimPoint(a, o);
      this.startAttack(a, aim.x, aim.y);
      bot.wait = rand(0.25, 0.8);
    }
  }

  update(dt: number, input: Input) {
    if (this.over) dt *= 0.25;
    else {
      this.time -= dt;
      if (this.time <= 0 || this.alive.length === 0) {
        this.time = Math.max(0, this.time);
        this.over = true;
        this.sounds.push("end");
      }
    }
    const p = this.player;

    if (!this.over) {
      if (this.demo) {
        p.bot ??= this.newBot(p.char.special);
        this.think(p, dt);
      } else {
        this.move(p, input.mx, input.my, dt, SPEED);
        this.autoTarget = this.pickAuto(p);
        if (input.attack && p.cooldown <= 0 && !p.attack) {
          if (input.aim) this.startAttack(p, input.aim.x, input.aim.y);
          else if (this.autoTarget) {
            const aim = this.aimPoint(p, this.autoTarget);
            this.startAttack(p, aim.x, aim.y);
          } else {
            const reach = p.weapon === "bat" ? 60 : 260;
            this.startAttack(p, p.x + (p.flip ? -reach : reach), p.y + (p.back ? -reach * 0.6 : reach * 0.25));
          }
        }
      }
      for (const a of this.actors) if (a.bot && a !== p) this.think(a, dt);
    }

    for (const a of this.actors) {
      a.cooldown -= dt;
      if (a.attack) {
        const stats = WEAPONS[a.attack.weapon];
        a.attack.t += dt;
        if (!a.attack.fired && a.attack.t >= stats.fireAt) { a.attack.fired = true; this.fire(a, a.attack); }
        if (a.attack.t >= stats.duration) a.attack = null;
      }
    }
    for (const b of this.bottles) {
      b.t += dt / 0.5;
      if (b.t >= 1) this.land(b);
    }
    this.bottles = this.bottles.filter((b) => b.t < 1);
    for (const f of this.fires) {
      f.life -= dt;
      f.tick -= dt;
      if (Math.random() < dt * 26) this.puff("flame", f.x + rand(-1, 1) * FIRE_RADIUS * 0.75, f.y + rand(-1, 1) * FIRE_RADIUS * 0.4, 0);
      if (Math.random() < dt * 5) this.puff("smoke", f.x + rand(-50, 50), f.y, 40);
      if (f.tick <= 0) {
        f.tick += 0.3;
        for (const o of this.objs) {
          if (!o.dead && this.nearest(o, f.x, f.y).d < FIRE_RADIUS) this.hurt(o, BURN_PER_SECOND * 0.3, "molotov", f.owner, o.x, o.y, true);
        }
      }
    }
    this.fires = this.fires.filter((f) => f.life > 0);
    for (const o of this.objs) {
      o.flash -= dt; o.shake -= dt;
      if (o.burn > 0) {
        o.burn -= dt;
        const top = Math.min(o.h, 150);
        if (Math.random() < dt * 14) this.puff("flame", o.x + rand(-0.35, 0.35) * o.w, o.y - 4, rand(0.2, 0.8) * top);
        if (Math.random() < dt * 5) this.puff("smoke", o.x + rand(-0.3, 0.3) * o.w, o.y - 4, top);
      } else if (o.dead && !o.def.clears && Math.random() < dt * 1.2) {
        this.puff("smoke", o.x + rand(-0.3, 0.3) * o.w, o.y - 4, Math.min(o.h, 150) * 0.8);
      }
    }
    for (const q of this.particles) {
      q.life -= dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.kind === "shard" || q.kind === "spark" || q.kind === "debris") {
        q.vz -= 620 * dt;
        if (q.z < 0) { q.z = 0; q.vz *= -0.35; q.vx *= 0.5; q.vy *= 0.5; }
      }
    }
    this.particles = this.particles.filter((q) => q.life > 0);
    if (this.particles.length > 700) this.particles.splice(0, this.particles.length - 700);
    for (const f of this.floaters) { f.life -= dt; f.y -= 46 * dt; }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    for (const t of this.tracers) t.life -= dt;
    this.tracers = this.tracers.filter((t) => t.life > 0);
    this.shake = Math.max(0, this.shake - dt);
  }
}
