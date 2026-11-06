import { Client, Room } from "@colyseus/core";
import { CLEARING_RADIUS, MAP_SIZE, TREES } from "../../shared/forest.ts";
import { ArenaState, Player, Shot } from "./state.ts";

const TICK_MS = 33;
const WALK_SPEED = 6.5;
const ARRIVE_DISTANCE = 0.25;
const PLAYER_RADIUS = 0.5;
const SHOT_SPEED = 20;
const SHOT_LIFE_MS = 1400;
const SHOT_COOLDOWN_MS = 500;
const SLASH_COOLDOWN_MS = 450;
const SLASH_RANGE = 2.6;
const SLASH_ARC = 1.1;
const SHOT_HIT_RADIUS = 1.1;
const SHOT_KNOCKBACK = 16;
const SLASH_KNOCKBACK = 22;
const KNOCKBACK_DECAY = 6;

type Runtime = {
  targetX: number;
  targetZ: number;
  hasTarget: boolean;
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
    this.onMessage("move", (client, target: { x: number; z: number }) => {
      const runtime = this.runtime.get(client.sessionId);

      if (!runtime || !target) return;
      runtime.targetX = clamp(Number(target.x) || 0, -MAP_SIZE, MAP_SIZE);
      runtime.targetZ = clamp(Number(target.z) || 0, -MAP_SIZE, MAP_SIZE);
      runtime.hasTarget = true;
    });
    this.onMessage("fire", (client, aim: number) => this.fire(client.sessionId, Number(aim) || 0));
    this.onMessage("slash", (client, aim: number) => this.slash(client.sessionId, Number(aim) || 0));
    this.setSimulationInterval((dt) => this.step(dt), TICK_MS);
  }

  onJoin(client: Client) {
    const player = new Player();
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * (CLEARING_RADIUS - 3);

    player.name = `P${this.nextPlayer}`;
    player.hue = (this.nextPlayer * 0.381966) % 1;
    player.x = Math.cos(angle) * distance;
    player.z = Math.sin(angle) * distance;
    this.nextPlayer++;
    this.state.players.set(client.sessionId, player);
    this.runtime.set(client.sessionId, {
      targetX: player.x,
      targetZ: player.z,
      hasTarget: false,
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
    shot.vz = Math.cos(aim) * SHOT_SPEED;
    shot.x = player.x + Math.sin(aim);
    shot.z = player.z + Math.cos(aim);
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
      otherRuntime.pushZ += Math.cos(aim) * SLASH_KNOCKBACK;
      this.broadcast("hit", { id: otherId });
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
        moveX = (dx / distance) * WALK_SPEED;
        moveZ = (dz / distance) * WALK_SPEED;
        player.aim = Math.atan2(dx, dz);
      }
    }

    player.moving = runtime.hasTarget;
    player.x = clamp(player.x + (moveX + runtime.pushX) * dt, -MAP_SIZE, MAP_SIZE);
    player.z = clamp(player.z + (moveZ + runtime.pushZ) * dt, -MAP_SIZE, MAP_SIZE);
    runtime.pushX *= Math.exp(-KNOCKBACK_DECAY * dt);
    runtime.pushZ *= Math.exp(-KNOCKBACK_DECAY * dt);

    /* Slide around trunks instead of stopping dead */
    for (const tree of TREES) {
      const dx = player.x - tree.x;
      const dz = player.z - tree.z;
      const distance = Math.hypot(dx, dz) || 0.001;
      const minimum = tree.radius + PLAYER_RADIUS;

      if (distance >= minimum) continue;
      player.x = tree.x + (dx / distance) * minimum;
      player.z = tree.z + (dz / distance) * minimum;
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

      let hit = TREES.some((tree) => Math.hypot(tree.x - shot.x, tree.z - shot.z) < tree.radius + 0.3);

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
