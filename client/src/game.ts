/* The simulation: four rioters (you and three bots) wrecking the square for points. Runs in the browser. */
import { OBJECTS, SPRITES, WORLD_H, WORLD_W } from "./layout.ts";
import {
  ATTACK_MS, BURN_DPS, BURN_SECONDS, CHARACTERS, type CharacterId, KINDS, ROUND_SECONDS, SPECIALIST_BONUS,
  WEAPON_INFO, type Weapon, bestWeapon,
} from "./rules.ts";

const WALK_SPEED = 230;
/* The ground is seen at an angle, so vertical distances look shorter */
export const DEPTH = 0.75;
const RIOTER_RADIUS = 20;
const BOT_THINK_SECONDS = 0.5;
const MOLOTOV_FLIGHT = 0.55;

export type Thing = {
  index: number; kind: string; x: number; y: number; w: number; h: number; radius: number;
  hp: number; maxHp: number; broken: boolean; burn: number; burnBy: number; flash: number;
};

export type Rioter = {
  id: number; name: string; character: CharacterId; isPlayer: boolean;
  x: number; y: number; aim: number; moving: boolean; walkDistance: number;
  weapon: Weapon; cooldown: number; attackTime: number; struck: boolean;
  goal?: { x: number; y: number }; target: number; score: number; think: number;
};

export type Bottle = { x: number; y: number; fromX: number; fromY: number; toX: number; toY: number; t: number; owner: number };

export type GameEvent =
  | { type: "hit"; x: number; y: number; weapon: Weapon; points: number; owner: number }
  | { type: "wreck"; thing: Thing; owner: number; points: number }
  | { type: "shot"; owner: number; fromX: number; fromY: number; toX: number; toY: number }
  | { type: "splash"; x: number; y: number };

const distance = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, (ay - by) / DEPTH);

export class Game {
  things: Thing[];
  rioters: Rioter[] = [];
  bottles: Bottle[] = [];
  events: GameEvent[] = [];
  timeLeft = ROUND_SECONDS;
  over = false;

  constructor(player: CharacterId) {
    this.things = OBJECTS.map((o, index) => {
      const sprite = SPRITES[o.kind];
      const kind = KINDS[o.kind];

      return {
        index, kind: o.kind, x: o.x, y: o.y, w: sprite.w, h: sprite.h, radius: sprite.w * kind.solid,
        hp: kind.hp, maxHp: kind.hp, broken: false, burn: 0, burnBy: -1, flash: 0,
      };
    });

    const others = (["pyro", "brute", "chasseur"] as CharacterId[]).filter((c) => c !== player);
    const cast: CharacterId[] = [player, ...others, others[Math.floor(Math.random() * 2)]];
    const spawnX = WORLD_W / 2;
    const spawnY = WORLD_H / 2;

    cast.forEach((character, id) => {
      const angle = (id / cast.length) * Math.PI * 2;

      this.rioters.push({
        id, character, isPlayer: id === 0,
        name: id === 0 ? "YOU" : `${CHARACTERS[character].name}${id === 3 ? " II" : ""}`,
        x: spawnX + Math.cos(angle) * 90, y: spawnY + Math.sin(angle) * 60, aim: 0, moving: false, walkDistance: 0,
        weapon: CHARACTERS[character].weapon, cooldown: 0, attackTime: -1, struck: false, target: -1, score: 0,
        think: Math.random() * BOT_THINK_SECONDS,
      });
    });
  }

  get player() {
    return this.rioters[0];
  }

  /** The intact thing whose painting covers this point, nearest the front. */
  thingAt(x: number, y: number) {
    let best: Thing | undefined;

    for (const thing of this.things) {
      if (thing.broken) continue;
      const inside = Math.abs(x - thing.x) < thing.w * 0.45 && y < thing.y + 10 && y > thing.y - thing.h * 0.9;

      if (inside && (!best || thing.y > best.y)) best = thing;
    }
    return best;
  }

  order(x: number, y: number) {
    const player = this.player;
    const thing = this.thingAt(x, y);

    if (thing) {
      player.target = thing.index;
      player.goal = undefined;
    } else {
      player.target = -1;
      player.goal = { x, y };
    }
  }

  step(dt: number) {
    if (this.over) return;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0 || this.things.every((t) => t.broken)) {
      this.timeLeft = Math.max(0, this.timeLeft);
      this.over = true;
      return;
    }

    for (const rioter of this.rioters) {
      if (!rioter.isPlayer) this.thinkBot(rioter, dt);
      this.stepRioter(rioter, dt);
    }
    this.stepBottles(dt);

    for (const thing of this.things) {
      thing.flash = Math.max(0, thing.flash - dt * 4);
      if (thing.burn > 0 && !thing.broken) {
        thing.burn -= dt;
        this.damage(thing, BURN_DPS * dt * KINDS[thing.kind].weak.molotov, thing.burnBy, "molotov", false);
      }
    }
  }

  private thinkBot(bot: Rioter, dt: number) {
    bot.think -= dt;
    const current = this.things[bot.target];

    if (current && !current.broken && bot.think > 0) return;
    bot.think = BOT_THINK_SECONDS;
    if (current && !current.broken) return;

    // Value per distance, avoiding what the other bots are already on.
    let best = -1;
    let bestValue = 0;

    for (const thing of this.things) {
      if (thing.broken) continue;
      const taken = this.rioters.some((r) => r !== bot && r.target === thing.index);
      const kind = KINDS[thing.kind];
      const value = (kind.bonus + thing.hp * 0.5) / (distance(bot.x, bot.y, thing.x, thing.y) + 250) * (taken ? 0.35 : 1) * (0.8 + Math.random() * 0.4);

      if (value > bestValue) {
        bestValue = value;
        best = thing.index;
      }
    }
    bot.target = best;
    if (best >= 0) bot.weapon = Math.random() < 0.8 ? bestWeapon(this.things[best].kind, bot.character) : CHARACTERS[bot.character].weapon;
  }

  private stepRioter(r: Rioter, dt: number) {
    r.cooldown = Math.max(0, r.cooldown - dt);
    let moveX = 0;
    let moveY = 0;
    const target = this.things[r.target];

    if (r.attackTime >= 0) {
      r.attackTime += dt * 1000;
      const info = WEAPON_INFO[r.weapon];

      if (!r.struck && r.attackTime >= info.hitAt * 1000) {
        r.struck = true;
        if (target && !target.broken) this.strike(r, target);
      }
      if (r.attackTime >= ATTACK_MS) r.attackTime = -1;
    } else if (target && !target.broken) {
      const info = WEAPON_INFO[r.weapon];
      const reach = info.range + target.radius;
      const aimY = target.y - 20;
      const d = distance(r.x, r.y, target.x, aimY);

      r.aim = Math.atan2(target.x - r.x, aimY - r.y);
      if (d > reach) {
        const len = Math.hypot(target.x - r.x, (aimY - r.y) / DEPTH) || 1;

        moveX = ((target.x - r.x) / len) * WALK_SPEED;
        moveY = ((aimY - r.y) / len) * WALK_SPEED * DEPTH;
      } else if (r.cooldown <= 0) {
        r.attackTime = 0;
        r.struck = false;
        r.cooldown = info.cooldown;
      }
    } else if (r.goal) {
      const len = Math.hypot(r.goal.x - r.x, (r.goal.y - r.y) / DEPTH);

      if (len < 8) r.goal = undefined;
      else {
        moveX = ((r.goal.x - r.x) / len) * WALK_SPEED;
        moveY = ((r.goal.y - r.y) / len) * WALK_SPEED * DEPTH;
        r.aim = Math.atan2(moveX, moveY);
      }
    } else if (target?.broken) {
      r.target = -1;
    }

    r.moving = moveX !== 0 || moveY !== 0;
    const before = { x: r.x, y: r.y };

    r.x = Math.min(WORLD_W - 30, Math.max(30, r.x + moveX * dt));
    r.y = Math.min(WORLD_H - 20, Math.max(80, r.y + moveY * dt));

    /* Slide around whatever is still standing (wrecks too: they are still in the way) */
    for (const thing of this.things) {
      const dx = r.x - thing.x;
      const dy = (r.y - thing.y) / DEPTH;
      const d = Math.hypot(dx, dy) || 0.001;
      const min = thing.radius + RIOTER_RADIUS;

      if (d < min) {
        r.x = thing.x + (dx / d) * min;
        r.y = thing.y + (dy / d) * min * DEPTH;
      }
    }
    if (r.moving) r.walkDistance += Math.hypot(r.x - before.x, (r.y - before.y) / DEPTH);
  }

  private power(r: Rioter) {
    const info = WEAPON_INFO[r.weapon];

    return info.damage * (CHARACTERS[r.character].weapon === r.weapon ? SPECIALIST_BONUS : 1);
  }

  private strike(r: Rioter, target: Thing) {
    const tx = target.x;
    const ty = target.y - target.h * 0.25;

    if (r.weapon === "molotov") {
      this.bottles.push({ x: r.x, y: r.y - 90, fromX: r.x, fromY: r.y - 90, toX: tx, toY: ty, t: 0, owner: r.id });
      return;
    }
    if (r.weapon === "shotgun") this.events.push({ type: "shot", owner: r.id, fromX: r.x, fromY: r.y - 85, toX: tx, toY: ty });
    this.damage(target, this.power(r) * KINDS[target.kind].weak[r.weapon], r.id, r.weapon, true, tx, ty);
    if (r.weapon === "shotgun") this.splash(target, tx, ty, r, 0.5);
  }

  private splash(center: Thing, x: number, y: number, r: Rioter, share: number) {
    const radius = WEAPON_INFO[r.weapon].splash;

    for (const thing of this.things) {
      if (thing === center || thing.broken) continue;
      if (distance(thing.x, thing.y - thing.h * 0.25, x, y) > radius + thing.radius) continue;
      this.damage(thing, this.power(r) * share * KINDS[thing.kind].weak[r.weapon], r.id, r.weapon, true);
      if (r.weapon === "molotov") {
        thing.burn = BURN_SECONDS * share;
        thing.burnBy = r.id;
      }
    }
  }

  private stepBottles(dt: number) {
    for (const b of this.bottles) {
      b.t += dt / MOLOTOV_FLIGHT;
      const t = Math.min(1, b.t);

      b.x = b.fromX + (b.toX - b.fromX) * t;
      b.y = b.fromY + (b.toY - b.fromY) * t - Math.sin(t * Math.PI) * 140;
      if (b.t < 1) continue;

      const owner = this.rioters[b.owner];
      const hit = this.thingAt(b.toX, b.toY + 30) ?? this.things.find((t) => !t.broken && distance(t.x, t.y - t.h * 0.25, b.toX, b.toY) < t.radius + 40);

      this.events.push({ type: "splash", x: b.toX, y: b.toY });
      if (hit) {
        this.damage(hit, this.power(owner) * KINDS[hit.kind].weak.molotov, owner.id, "molotov", true, b.toX, b.toY);
        hit.burn = BURN_SECONDS;
        hit.burnBy = owner.id;
        this.splash(hit, b.toX, b.toY, { ...owner, weapon: "molotov" }, 0.5);
      }
    }
    this.bottles = this.bottles.filter((b) => b.t < 1);
  }

  private damage(thing: Thing, amount: number, owner: number, weapon: Weapon, visible: boolean, x = thing.x, y = thing.y - thing.h * 0.4) {
    if (thing.broken || owner < 0) return;
    const dealt = Math.min(thing.hp, amount);
    const rioter = this.rioters[owner];

    thing.hp -= dealt;
    rioter.score += dealt;
    if (visible) {
      thing.flash = 1;
      this.events.push({ type: "hit", x, y, weapon, points: Math.round(dealt), owner });
    }
    if (thing.hp <= 0) {
      const bonus = KINDS[thing.kind].bonus;

      thing.broken = true;
      thing.burn = 0;
      rioter.score += bonus;
      this.events.push({ type: "wreck", thing, owner, points: bonus });
    }
  }
}
