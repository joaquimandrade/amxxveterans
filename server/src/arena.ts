import { Client, Room } from "@colyseus/core";
import { AREAS, HOTSPOTS, insideFloor } from "../../shared/areas.ts";
import { ENEMY_GATE, SPAWN } from "../../shared/forest.ts";
import { ArenaState, Enemy, GroundItem, Player, Shot } from "./state.ts";

const TICK_MS = 33;
const WALK_SPEED = 190;
const RUN_SPEED = 360;
const ARRIVE_DISTANCE = 8;
const PLAYER_RADIUS = 22;
/* The ground is seen at an angle, so vertical distances look shorter */
const DEPTH_SCALE = 0.72;
const SHOT_SPEED = 720;
const SHOT_LIFE_MS = 1400;
const SHOT_COOLDOWN_MS = 500;
const SLASH_COOLDOWN_MS = 450;
const SLASH_RANGE = 120;
const SLASH_ARC = 1.1;
const SHOT_HIT_RADIUS = 56;
const SHOT_KNOCKBACK = 620;
const SLASH_KNOCKBACK = 840;
const BOLT_RANGE = 760;
const BOLT_WIDTH = 46;
const BOLT_COOLDOWN_MS = 550;
const BOLT_KNOCKBACK = 700;
const REACH = 70;
const HOTSPOT_REACH = 90;
const RESPAWN_MS = 30_000;
const CHEST_RESET_MS = 30_000;
const MAX_INVENTORY = 20;
const MANA_MAX = 100;
const MANA_REGEN = 3;
const FIRE_COST = 10;
const BOLT_COST = 15;
const POTION_MANA = 50;

const WEAPONS: Record<string, { range: number; knockback: number; cooldown: number; damage: number }> = {
  sword: { range: SLASH_RANGE, knockback: SLASH_KNOCKBACK, cooldown: SLASH_COOLDOWN_MS, damage: 12 },
  axe: { range: 145, knockback: 1250, cooldown: 800, damage: 22 },
};
const FIRE_DAMAGE = 15;
const BOLT_DAMAGE = 20;
const HEALTH_MAX = 300;

/* One fight against the policeman on his donkey. Both last long, so the fight does too. */
const ENEMY_KINDS: Record<string, {
  health: number; speed: number; radius: number; reach: number; damage: number;
  cooldown: number; windup: number; knockback: number;
}> = {
  cop: { health: 60, speed: 150, radius: 24, reach: 95, damage: 8, cooldown: 1300, windup: 260, knockback: 500 },
  donkey: { health: 600, speed: 230, radius: 40, reach: 115, damage: 14, cooldown: 1500, windup: 300, knockback: 700 },
};
const ENEMY_STUN_MS = 300;
const CHEST_LOOT = ["potion_mana", "potion_mana", "coins", "ring", "helmet", "pouch", "axe"];
const KNOCKBACK_DECAY = 6;

type Runtime = {
  targetX: number;
  targetZ: number;
  hasTarget: boolean;
  running: boolean;
  lastBolt: number;
  pending?: string;
  lastShot: number;
  lastSlash: number;
  pushX: number;
  pushZ: number;
};

type EnemyRuntime = {
  lastAttack: number;
  stunnedUntil: number;
  pushX: number;
  pushZ: number;
  lastX: number;
  lastZ: number;
  stuckFor: number;
  detourUntil: number;
  detourSide: number;
};

const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v));
const angleDifference = (a: number, b: number) =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export class Arena extends Room {
  /* Single player: every visitor gets a room of their own. */
  maxClients = 1;
  state = new ArenaState();

  private runtime = new Map<string, Runtime>();
  private shotLife = new Map<string, number>();
  private nextShot = 0;
  private nextItem = 0;
  private respawning = new Set<string>();
  private nextPlayer = 1;
  private enemyRuntime = new Map<string, EnemyRuntime>();
  private nextEnemy = 0;

  onCreate() {
    this.onMessage("ready", () => {
      if (this.state.phase === "intro") this.state.phase = "fight";
    });
    this.onMessage("move", (client, target: { x: number; z: number; run?: boolean }) => {
      const runtime = this.runtime.get(client.sessionId);

      if (!runtime || !target || this.state.phase !== "fight") return;
      const player = this.state.players.get(client.sessionId);
      const area = AREAS[player?.area ?? "city"];

      runtime.targetX = clamp(Number(target.x) || 0, 0, area.width);
      runtime.targetZ = clamp(Number(target.z) || 0, 0, area.height);
      runtime.hasTarget = true;
      runtime.running = Boolean(target.run);
      runtime.pending = undefined;
    });
    const fighting = (action: (id: string, aim: number) => void) => (client: Client, aim: number) => {
      if (this.state.phase === "fight") action.call(this, client.sessionId, Number(aim) || 0);
    };

    this.onMessage("fire", fighting(this.fire));
    this.onMessage("slash", fighting(this.slash));
    this.onMessage("bolt", fighting(this.bolt));
    this.onMessage("interact", (client, id: string) => {
      if (this.state.phase === "fight") this.interact(client.sessionId, String(id));
    });
    this.onMessage("equip", (client, kind: string) => {
      const player = this.state.players.get(client.sessionId);

      if (player && kind in WEAPONS && player.inventory.includes(kind)) player.weapon = kind;
    });
    this.onMessage("use", (client, index: number) => this.useItem(client.sessionId, Number(index)));
    this.setSimulationInterval((dt) => this.step(dt), TICK_MS);
  }

  onJoin(client: Client) {
    const player = new Player();
    player.name = "VIRGILIU";
    player.hue = (this.nextPlayer * 0.381966) % 1;
    player.x = SPAWN.x;
    player.z = SPAWN.y;
    player.aim = Math.atan2(ENEMY_GATE.x - SPAWN.x, ENEMY_GATE.y - SPAWN.y);
    this.nextPlayer++;
    this.state.players.set(client.sessionId, player);
    this.runtime.set(client.sessionId, {
      targetX: player.x,
      targetZ: player.z,
      hasTarget: false,
      running: false,
      lastBolt: 0,
      lastShot: 0,
      lastSlash: 0,
      pushX: 0,
      pushZ: 0,
    });
    if (this.state.enemies.size === 0) this.spawnEnemy("donkey");
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.runtime.delete(client.sessionId);
  }

  private placeItem(kind: string, x: number, z: number, respawns: boolean) {
    const item = new GroundItem();
    const id = `item${this.nextItem++}`;

    item.kind = kind;
    item.x = x;
    item.z = z;
    this.state.items.set(id, item);
    if (respawns) this.respawning.add(id);
  }

  private interact(playerId: string, targetId: string) {
    const runtime = this.runtime.get(playerId);
    const player = this.state.players.get(playerId);
    const hotspot = HOTSPOTS.find((spot) => spot.id === targetId);
    const scenery = this.state.items.get(targetId) ?? this.state.chests.get(targetId);
    const target = hotspot ? { x: hotspot.x, z: hotspot.y } : scenery;

    if (!runtime || !player || !target) return;
    if (player.area !== (hotspot?.area ?? "city")) return;
    runtime.pending = targetId;
    runtime.targetX = target.x;
    runtime.targetZ = target.z;
    runtime.hasTarget = true;
  }

  /** Runs when a hero reaches the thing it was sent to. */
  private finishInteraction(player: Player, runtime: Runtime) {
    const id = runtime.pending!;
    const hotspot = HOTSPOTS.find((spot) => spot.id === id);

    if (hotspot) {
      if (Math.hypot(player.x - hotspot.x, player.z - hotspot.y) > HOTSPOT_REACH) return;
      player.area = hotspot.toArea;
      player.x = hotspot.toX;
      player.z = hotspot.toY;
      runtime.pending = undefined;
      runtime.hasTarget = false;
      return;
    }

    const item = this.state.items.get(id);
    const chest = this.state.chests.get(id);
    const target = item ?? chest;

    if (!target) {
      runtime.pending = undefined;
      return;
    }
    if (Math.hypot(player.x - target.x, player.z - target.z) > REACH) return;
    runtime.pending = undefined;
    runtime.hasTarget = false;

    if (item && player.inventory.length < MAX_INVENTORY) {
      const respawns = this.respawning.delete(id);

      player.inventory.push(item.kind);
      this.state.items.delete(id);
      if (respawns) {
        const { kind, x, z } = item;

        this.clock.setTimeout(() => this.placeItem(kind, x, z, true), RESPAWN_MS);
      }
    }
    if (chest && !chest.open) {
      const angle = Math.random() * Math.PI * 2;
      const loot = CHEST_LOOT[Math.floor(Math.random() * CHEST_LOOT.length)];

      chest.open = true;
      this.placeItem(loot, chest.x + Math.cos(angle) * 85, chest.z + 34 + Math.abs(Math.sin(angle)) * 50, false);
      this.clock.setTimeout(() => (chest.open = false), CHEST_RESET_MS);
    }
  }

  private useItem(id: string, index: number) {
    const player = this.state.players.get(id);

    if (!player || player.inventory[index] !== "potion_mana") return;
    player.inventory.splice(index, 1);
    player.mana = Math.min(MANA_MAX, player.mana + POTION_MANA);
  }

  private fire(id: string, aim: number) {
    const player = this.state.players.get(id);
    const runtime = this.runtime.get(id);
    const now = this.clock.currentTime;

    if (!player?.alive || !runtime || now - runtime.lastShot < SHOT_COOLDOWN_MS || player.mana < FIRE_COST) return;
    runtime.lastShot = now;
    player.mana -= FIRE_COST;
    player.aim = aim;

    const shot = new Shot();
    const shotId = String(this.nextShot++);

    shot.owner = id;
    shot.area = player.area;
    shot.vx = Math.sin(aim) * SHOT_SPEED;
    shot.vz = Math.cos(aim) * SHOT_SPEED * DEPTH_SCALE;
    shot.x = player.x + Math.sin(aim) * 40;
    shot.z = player.z + Math.cos(aim) * 40;
    this.state.shots.set(shotId, shot);
    this.shotLife.set(shotId, SHOT_LIFE_MS);
    this.broadcast("cast", { id });
  }

  private slash(id: string, aim: number) {
    const player = this.state.players.get(id);
    const runtime = this.runtime.get(id);
    const now = this.clock.currentTime;

    if (!player?.alive || !runtime) return;
    const weapon = WEAPONS[player.weapon] ?? WEAPONS.sword;

    if (now - runtime.lastSlash < weapon.cooldown) return;
    runtime.lastSlash = now;
    player.aim = aim;
    this.broadcast("slash", { id });

    this.state.players.forEach((other, otherId) => {
      const otherRuntime = this.runtime.get(otherId);
      const dx = other.x - player.x;
      const dz = other.z - player.z;

      if (otherId === id || !otherRuntime || other.area !== player.area || Math.hypot(dx, dz) > weapon.range) return;
      if (angleDifference(Math.atan2(dx, dz), aim) > SLASH_ARC) return;
      player.hits++;
      otherRuntime.pushX += Math.sin(aim) * weapon.knockback;
      otherRuntime.pushZ += Math.cos(aim) * weapon.knockback * DEPTH_SCALE;
      this.broadcast("hit", { id: otherId });
    });

    this.state.enemies.forEach((enemy, enemyId) => {
      const dx = enemy.x - player.x;
      const dz = enemy.z - player.z;
      const reach = weapon.range + ENEMY_KINDS[enemy.kind].radius - PLAYER_RADIUS;

      if (player.area !== "city" || Math.hypot(dx, dz) > reach) return;
      if (angleDifference(Math.atan2(dx, dz), aim) > SLASH_ARC) return;
      this.hurtEnemy(enemyId, enemy, player, weapon.damage, Math.sin(aim) * weapon.knockback, Math.cos(aim) * weapon.knockback * DEPTH_SCALE);
    });
  }

  /** Instant strike: stops at the first player or tree on its way. */
  private bolt(id: string, aim: number) {
    const player = this.state.players.get(id);
    const runtime = this.runtime.get(id);
    const now = this.clock.currentTime;

    if (!player?.alive || !runtime || now - runtime.lastBolt < BOLT_COOLDOWN_MS || player.mana < BOLT_COST) return;
    runtime.lastBolt = now;
    player.mana -= BOLT_COST;
    player.aim = aim;

    const directionX = Math.sin(aim);
    const directionZ = Math.cos(aim) * DEPTH_SCALE;
    let reach = BOLT_RANGE;
    let target: string | undefined;

    const along = (x: number, z: number) => (x - player.x) * directionX + (z - player.z) * directionZ;
    const across = (x: number, z: number) => Math.abs((x - player.x) * directionZ - (z - player.z) * directionX);

    for (const object of AREAS[player.area].solids) {
      const distance = along(object.x, object.y);

      if (distance > 0 && distance < reach && across(object.x, object.y) < object.radius) reach = distance;
    }
    this.state.players.forEach((other, otherId) => {
      const distance = along(other.x, other.z);

      if (otherId === id || other.area !== player.area || distance <= 0 || distance >= reach) return;
      if (across(other.x, other.z) > BOLT_WIDTH) return;
      reach = distance;
      target = otherId;
    });
    let enemyTarget: string | undefined;

    this.state.enemies.forEach((enemy, enemyId) => {
      const distance = along(enemy.x, enemy.z);

      if (player.area !== "city" || distance <= 0 || distance >= reach) return;
      if (across(enemy.x, enemy.z) > BOLT_WIDTH + ENEMY_KINDS[enemy.kind].radius) return;
      reach = distance;
      enemyTarget = enemyId;
      target = undefined;
    });

    if (enemyTarget) {
      const enemy = this.state.enemies.get(enemyTarget)!;

      this.hurtEnemy(enemyTarget, enemy, player, BOLT_DAMAGE, directionX * BOLT_KNOCKBACK, directionZ * BOLT_KNOCKBACK);
    }
    if (target) {
      const victim = this.runtime.get(target);

      player.hits++;
      if (victim) {
        victim.pushX += directionX * BOLT_KNOCKBACK;
        victim.pushZ += directionZ * BOLT_KNOCKBACK;
      }
      this.broadcast("hit", { id: target });
    }
    this.broadcast("bolt", {
      id,
      area: player.area,
      fromX: player.x,
      fromZ: player.z,
      toX: player.x + directionX * reach,
      toZ: player.z + directionZ * reach,
    });
  }

  private removeShot(id: string, shot: Shot, exploded: boolean) {
    if (exploded) this.broadcast("explode", { x: shot.x, z: shot.z, area: shot.area });
    this.state.shots.delete(id);
    this.shotLife.delete(id);
  }

  private stepPlayer(player: Player, runtime: Runtime, dt: number) {
    let moveX = 0;
    let moveZ = 0;

    if (!player.alive) return;
    player.mana = Math.min(MANA_MAX, player.mana + MANA_REGEN * dt);
    if (runtime.pending) this.finishInteraction(player, runtime);

    if (runtime.hasTarget) {
      const dx = runtime.targetX - player.x;
      const dz = runtime.targetZ - player.z;
      const distance = Math.hypot(dx, dz);

      if (distance < ARRIVE_DISTANCE) {
        runtime.hasTarget = false;
      } else {
        const speed = runtime.running ? RUN_SPEED : WALK_SPEED;

        moveX = (dx / distance) * speed;
        moveZ = (dz / distance) * speed * DEPTH_SCALE;
        player.aim = Math.atan2(dx, dz);
      }
    }

    player.moving = runtime.hasTarget;
    player.running = runtime.hasTarget && runtime.running;
    const area = AREAS[player.area];
    const nextX = clamp(player.x + (moveX + runtime.pushX) * dt, 0, area.width);
    const nextZ = clamp(player.z + (moveZ + runtime.pushZ) * dt, 0, area.height);

    /* Walls stop one axis at a time, so heroes slide along them */
    if (insideFloor(area, nextX, player.z)) player.x = nextX;
    if (insideFloor(area, player.x, nextZ)) player.z = nextZ;
    runtime.pushX *= Math.exp(-KNOCKBACK_DECAY * dt);
    runtime.pushZ *= Math.exp(-KNOCKBACK_DECAY * dt);

    /* Slide around trunks and rocks instead of stopping dead */
    for (const object of area.solids) {
      const dx = player.x - object.x;
      const dz = player.z - object.y;
      const distance = Math.hypot(dx, dz) || 0.001;
      const minimum = object.radius + PLAYER_RADIUS;

      if (distance >= minimum) continue;
      player.x = object.x + (dx / distance) * minimum;
      player.z = object.y + (dz / distance) * minimum;
    }
  }

  private step(dtMs: number) {
    const dt = dtMs / 1000;

    this.state.players.forEach((player, id) => {
      const runtime = this.runtime.get(id);

      if (runtime) this.stepPlayer(player, runtime, dt);
    });

    this.state.enemies.forEach((enemy, id) => this.stepEnemy(id, enemy, dt));

    this.state.shots.forEach((shot, id) => {
      const life = (this.shotLife.get(id) ?? 0) - dtMs;

      shot.x += shot.vx * dt;
      shot.z += shot.vz * dt;
      this.shotLife.set(id, life);

      const area = AREAS[shot.area];
      let hit =
        !insideFloor(area, shot.x, shot.z) ||
        area.solids.some((object) => Math.hypot(object.x - shot.x, object.y - shot.z) < object.radius + 10);

      if (!hit && shot.area === "city") {
        this.state.enemies.forEach((enemy, enemyId) => {
          if (hit || Math.hypot(enemy.x - shot.x, enemy.z - shot.z) > SHOT_HIT_RADIUS + ENEMY_KINDS[enemy.kind].radius - PLAYER_RADIUS) return;
          const owner = this.state.players.get(shot.owner);

          hit = true;
          if (owner) this.hurtEnemy(enemyId, enemy, owner, FIRE_DAMAGE, (shot.vx / SHOT_SPEED) * SHOT_KNOCKBACK, (shot.vz / SHOT_SPEED) * SHOT_KNOCKBACK);
        });
      }

      this.state.players.forEach((player, playerId) => {
        const runtime = this.runtime.get(playerId);

        if (hit || playerId === shot.owner || !runtime || player.area !== shot.area) return;
        if (Math.hypot(player.x - shot.x, player.z - shot.z) > SHOT_HIT_RADIUS) return;

        const owner = this.state.players.get(shot.owner);

        hit = true;
        if (owner) owner.hits++;
        runtime.pushX += (shot.vx / SHOT_SPEED) * SHOT_KNOCKBACK;
        runtime.pushZ += (shot.vz / SHOT_SPEED) * SHOT_KNOCKBACK;
        this.broadcast("hit", { id: playerId });
      });

      if (hit || life <= 0) this.removeShot(id, shot, true);
    });
  }

  private spawnEnemy(kind: string) {
    const stats = ENEMY_KINDS[kind];
    const enemy = new Enemy();
    const id = `enemy${this.nextEnemy++}`;

    enemy.kind = kind;
    enemy.x = ENEMY_GATE.x;
    enemy.z = ENEMY_GATE.y;
    enemy.aim = Math.atan2(SPAWN.x - ENEMY_GATE.x, SPAWN.y - ENEMY_GATE.y);
    enemy.health = enemy.maxHealth = stats.health;
    this.state.enemies.set(id, enemy);
    this.enemyRuntime.set(id, {
      lastAttack: 0, stunnedUntil: 0, pushX: 0, pushZ: 0,
      lastX: enemy.x, lastZ: enemy.z, stuckFor: 0, detourUntil: 0, detourSide: 1,
    });
  }

  private hurtEnemy(id: string, enemy: Enemy, attacker: Player, damage: number, pushX: number, pushZ: number) {
    const runtime = this.enemyRuntime.get(id);

    if (!runtime || enemy.health <= 0) return;
    enemy.health = Math.max(0, enemy.health - damage);
    runtime.pushX += pushX;
    runtime.pushZ += pushZ;
    runtime.stunnedUntil = this.clock.currentTime + ENEMY_STUN_MS;
    attacker.hits++;
    this.broadcast("enemyHit", { id });
    if (enemy.health > 0) return;
    attacker.kills++;
    this.broadcast("enemyDown", { id, kind: enemy.kind, x: enemy.x, z: enemy.z, aim: enemy.aim });
    this.state.enemies.delete(id);
    this.enemyRuntime.delete(id);
    if (this.state.enemies.size === 0) this.state.phase = "won";
  }

  private hurtPlayer(id: string, player: Player, damage: number, pushX: number, pushZ: number) {
    const runtime = this.runtime.get(id);

    if (!runtime || !player.alive) return;
    player.health = Math.max(0, player.health - damage);
    runtime.pushX += pushX;
    runtime.pushZ += pushZ;
    this.broadcast("hit", { id });
    if (player.health > 0) return;
    player.alive = false;
    player.moving = player.running = false;
    runtime.hasTarget = false;
    runtime.pending = undefined;
    this.state.phase = "lost";
  }

  /** Walks at the nearest living hero, side-stepping when a house blocks the way, and strikes when close. */
  private stepEnemy(id: string, enemy: Enemy, dt: number) {
    const runtime = this.enemyRuntime.get(id);

    if (!runtime || this.state.phase !== "fight") {
      enemy.moving = false;
      return;
    }
    const stats = ENEMY_KINDS[enemy.kind];
    const now = this.clock.currentTime;
    let target: { id: string; player: Player } | undefined;
    let best = Infinity;

    this.state.players.forEach((player, playerId) => {
      const distance = Math.hypot(player.x - enemy.x, player.z - enemy.z);

      if (player.alive && player.area === "city" && distance < best) {
        best = distance;
        target = { id: playerId, player };
      }
    });

    let moveX = 0;
    let moveZ = 0;
    const stunned = now < runtime.stunnedUntil;

    enemy.moving = false;
    if (target && !stunned) {
      const dx = target.player.x - enemy.x;
      const dz = target.player.z - enemy.z;
      const reach = stats.reach + stats.radius - 24;

      enemy.aim = Math.atan2(dx, dz);
      if (best > reach * 0.85) {
        let directionX = dx / best;
        let directionZ = dz / best;

        if (now < runtime.detourUntil) {
          const sideX = -directionZ * runtime.detourSide;
          const sideZ = directionX * runtime.detourSide;

          directionX = directionX * 0.3 + sideX;
          directionZ = directionZ * 0.3 + sideZ;
          const length = Math.hypot(directionX, directionZ);

          directionX /= length;
          directionZ /= length;
        }
        moveX = directionX * stats.speed;
        moveZ = directionZ * stats.speed * DEPTH_SCALE;
        enemy.moving = true;
      } else if (now - runtime.lastAttack > stats.cooldown) {
        runtime.lastAttack = now;
        this.broadcast("enemyAttack", { id });
        const victim = target;

        this.clock.setTimeout(() => {
          const still = this.state.enemies.get(id);

          if (!still || this.clock.currentTime < runtime.stunnedUntil) return;
          const hx = victim.player.x - still.x;
          const hz = victim.player.z - still.z;

          if (Math.hypot(hx, hz) > reach * 1.15) return;
          const length = Math.hypot(hx, hz) || 1;

          this.hurtPlayer(victim.id, victim.player, stats.damage, (hx / length) * stats.knockback, (hz / length) * stats.knockback * DEPTH_SCALE);
        }, stats.windup);
      }
    }

    const area = AREAS.city;

    enemy.x = clamp(enemy.x + (moveX + runtime.pushX) * dt, 0, area.width);
    enemy.z = clamp(enemy.z + (moveZ + runtime.pushZ) * dt, 0, area.height);
    runtime.pushX *= Math.exp(-KNOCKBACK_DECAY * dt);
    runtime.pushZ *= Math.exp(-KNOCKBACK_DECAY * dt);
    for (const object of area.solids) {
      const dx = enemy.x - object.x;
      const dz = enemy.z - object.y;
      const distance = Math.hypot(dx, dz) || 0.001;
      const minimum = object.radius + stats.radius;

      if (distance >= minimum) continue;
      enemy.x = object.x + (dx / distance) * minimum;
      enemy.z = object.y + (dz / distance) * minimum;
    }

    /* Barely moving while trying to walk means something is in the way: go round it for a moment. */
    const progress = Math.hypot(enemy.x - runtime.lastX, enemy.z - runtime.lastZ);

    runtime.lastX = enemy.x;
    runtime.lastZ = enemy.z;
    runtime.stuckFor = enemy.moving && progress < stats.speed * dt * 0.35 ? runtime.stuckFor + dt : 0;
    if (runtime.stuckFor > 0.4 && now >= runtime.detourUntil) {
      runtime.detourSide = Math.random() < 0.5 ? -1 : 1;
      runtime.detourUntil = now + 900;
      runtime.stuckFor = 0;
    }
  }
}
