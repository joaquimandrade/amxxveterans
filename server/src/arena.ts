import { Client, Room } from "@colyseus/core";
import { OBJECTS, SPAWN, WORLD_H, WORLD_W } from "../../shared/forest.ts";
import { ArenaState, Player, Shot } from "./state.ts";

const TICK_MS = 33;
const WALK_SPEED = 240;
const RUN_SPEED = 430;
const ARRIVE_DISTANCE = 8;
const PLAYER_RADIUS = 22;
/* The ground is seen at an angle, so vertical distances look shorter */
const DEPTH_SCALE = 0.72;
const SOLID = OBJECTS.filter((object) => object.radius > 0);
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
const KNOCKBACK_DECAY = 6;

type Runtime = {
  targetX: number;
  targetZ: number;
  hasTarget: boolean;
  running: boolean;
  lastBolt: number;
  lastShot: number;
  lastSlash: number;
  pushX: number;
  pushZ: number;
};

const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v));
const angleDifference = (a: number, b: number) =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export class Arena extends Room {
  maxClients = 16;
  state = new ArenaState();

  private runtime = new Map<string, Runtime>();
  private shotLife = new Map<string, number>();
  private nextShot = 0;
  private nextPlayer = 1;

  onCreate() {
    this.onMessage("move", (client, target: { x: number; z: number; run?: boolean }) => {
      const runtime = this.runtime.get(client.sessionId);

      if (!runtime || !target) return;
      runtime.targetX = clamp(Number(target.x) || 0, 0, WORLD_W);
      runtime.targetZ = clamp(Number(target.z) || 0, 0, WORLD_H);
      runtime.hasTarget = true;
      runtime.running = Boolean(target.run);
    });
    this.onMessage("fire", (client, aim: number) => this.fire(client.sessionId, Number(aim) || 0));
    this.onMessage("slash", (client, aim: number) => this.slash(client.sessionId, Number(aim) || 0));
    this.onMessage("bolt", (client, aim: number) => this.bolt(client.sessionId, Number(aim) || 0));
    this.setSimulationInterval((dt) => this.step(dt), TICK_MS);
  }

  onJoin(client: Client) {
    const player = new Player();
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * 240;

    player.name = `P${this.nextPlayer}`;
    player.hue = (this.nextPlayer * 0.381966) % 1;
    player.x = SPAWN.x + Math.cos(angle) * distance;
    player.z = SPAWN.y + Math.sin(angle) * distance * DEPTH_SCALE;
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
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.runtime.delete(client.sessionId);
  }

  private fire(id: string, aim: number) {
    const player = this.state.players.get(id);
    const runtime = this.runtime.get(id);
    const now = this.clock.currentTime;

    if (!player || !runtime || now - runtime.lastShot < SHOT_COOLDOWN_MS) return;
    runtime.lastShot = now;
    player.aim = aim;

    const shot = new Shot();
    const shotId = String(this.nextShot++);

    shot.owner = id;
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

    if (!player || !runtime || now - runtime.lastSlash < SLASH_COOLDOWN_MS) return;
    runtime.lastSlash = now;
    player.aim = aim;
    this.broadcast("slash", { id });

    this.state.players.forEach((other, otherId) => {
      const otherRuntime = this.runtime.get(otherId);
      const dx = other.x - player.x;
      const dz = other.z - player.z;

      if (otherId === id || !otherRuntime || Math.hypot(dx, dz) > SLASH_RANGE) return;
      if (angleDifference(Math.atan2(dx, dz), aim) > SLASH_ARC) return;
      player.hits++;
      otherRuntime.pushX += Math.sin(aim) * SLASH_KNOCKBACK;
      otherRuntime.pushZ += Math.cos(aim) * SLASH_KNOCKBACK * DEPTH_SCALE;
      this.broadcast("hit", { id: otherId });
    });
  }

  /** Instant strike: stops at the first player or tree on its way. */
  private bolt(id: string, aim: number) {
    const player = this.state.players.get(id);
    const runtime = this.runtime.get(id);
    const now = this.clock.currentTime;

    if (!player || !runtime || now - runtime.lastBolt < BOLT_COOLDOWN_MS) return;
    runtime.lastBolt = now;
    player.aim = aim;

    const directionX = Math.sin(aim);
    const directionZ = Math.cos(aim) * DEPTH_SCALE;
    let reach = BOLT_RANGE;
    let target: string | undefined;

    const along = (x: number, z: number) => (x - player.x) * directionX + (z - player.z) * directionZ;
    const across = (x: number, z: number) => Math.abs((x - player.x) * directionZ - (z - player.z) * directionX);

    for (const object of SOLID) {
      const distance = along(object.x, object.y);

      if (distance > 0 && distance < reach && across(object.x, object.y) < object.radius) reach = distance;
    }
    this.state.players.forEach((other, otherId) => {
      const distance = along(other.x, other.z);

      if (otherId === id || distance <= 0 || distance >= reach) return;
      if (across(other.x, other.z) > BOLT_WIDTH) return;
      reach = distance;
      target = otherId;
    });

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
      fromX: player.x,
      fromZ: player.z,
      toX: player.x + directionX * reach,
      toZ: player.z + directionZ * reach,
    });
  }

  private removeShot(id: string, shot: Shot, exploded: boolean) {
    if (exploded) this.broadcast("explode", { x: shot.x, z: shot.z });
    this.state.shots.delete(id);
    this.shotLife.delete(id);
  }

  private stepPlayer(player: Player, runtime: Runtime, dt: number) {
    let moveX = 0;
    let moveZ = 0;

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
    player.x = clamp(player.x + (moveX + runtime.pushX) * dt, 0, WORLD_W);
    player.z = clamp(player.z + (moveZ + runtime.pushZ) * dt, 0, WORLD_H);
    runtime.pushX *= Math.exp(-KNOCKBACK_DECAY * dt);
    runtime.pushZ *= Math.exp(-KNOCKBACK_DECAY * dt);

    /* Slide around trunks and rocks instead of stopping dead */
    for (const object of SOLID) {
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

    this.state.shots.forEach((shot, id) => {
      const life = (this.shotLife.get(id) ?? 0) - dtMs;

      shot.x += shot.vx * dt;
      shot.z += shot.vz * dt;
      this.shotLife.set(id, life);

      let hit = SOLID.some((object) => Math.hypot(object.x - shot.x, object.y - shot.z) < object.radius + 10);

      this.state.players.forEach((player, playerId) => {
        const runtime = this.runtime.get(playerId);

        if (hit || playerId === shot.owner || !runtime) return;
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
}
