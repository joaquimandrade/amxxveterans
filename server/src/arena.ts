import { Client, Room } from "@colyseus/core";
import { ArenaState, Player, Shot } from "./state.ts";

export const ARENA_SIZE = 20;

const TICK_MS = 33;
const WALK_SPEED = 7;
const SHOT_SPEED = 22;
const SHOT_LIFE_MS = 1400;
const SHOT_COOLDOWN_MS = 350;
const HIT_RADIUS = 1.1;
const KNOCKBACK = 16;
const KNOCKBACK_DECAY = 6;

type Input = { dx: number; dz: number; aim: number };

type Runtime = {
  input: Input;
  lastShot: number;
  pushX: number;
  pushZ: number;
};

const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v));

export class Arena extends Room {
  maxClients = 16;
  state = new ArenaState();

  private runtime = new Map<string, Runtime>();
  private shotLife = new Map<string, number>();
  private nextShot = 0;
  private nextPlayer = 1;

  onCreate() {
    this.onMessage("input", (client, input: Input) => {
      const runtime = this.runtime.get(client.sessionId);

      if (!runtime || !input) return;
      runtime.input = {
        dx: clamp(Number(input.dx) || 0, -1, 1),
        dz: clamp(Number(input.dz) || 0, -1, 1),
        aim: Number(input.aim) || 0,
      };
    });
    this.onMessage("fire", (client) => this.fire(client.sessionId));
    this.setSimulationInterval((dt) => this.step(dt), TICK_MS);
  }

  onJoin(client: Client) {
    const player = new Player();

    player.name = `P${this.nextPlayer}`;
    player.hue = (this.nextPlayer * 0.381966) % 1;
    player.x = (Math.random() - 0.5) * 16;
    player.z = (Math.random() - 0.5) * 16;
    this.nextPlayer++;
    this.state.players.set(client.sessionId, player);
    this.runtime.set(client.sessionId, {
      input: { dx: 0, dz: 0, aim: 0 },
      lastShot: 0,
      pushX: 0,
      pushZ: 0,
    });
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.runtime.delete(client.sessionId);
  }

  private fire(id: string) {
    const player = this.state.players.get(id);
    const runtime = this.runtime.get(id);
    const now = this.clock.currentTime;

    if (!player || !runtime || now - runtime.lastShot < SHOT_COOLDOWN_MS) return;
    runtime.lastShot = now;

    const shot = new Shot();
    const shotId = String(this.nextShot++);

    shot.owner = id;
    shot.vx = Math.sin(player.aim) * SHOT_SPEED;
    shot.vz = Math.cos(player.aim) * SHOT_SPEED;
    shot.x = player.x + Math.sin(player.aim);
    shot.z = player.z + Math.cos(player.aim);
    this.state.shots.set(shotId, shot);
    this.shotLife.set(shotId, SHOT_LIFE_MS);
  }

  private removeShot(id: string, shot: Shot, exploded: boolean) {
    if (exploded) this.broadcast("explode", { x: shot.x, z: shot.z });
    this.state.shots.delete(id);
    this.shotLife.delete(id);
  }

  private step(dtMs: number) {
    const dt = dtMs / 1000;

    this.state.players.forEach((player, id) => {
      const runtime = this.runtime.get(id);

      if (!runtime) return;
      const { dx, dz, aim } = runtime.input;
      const length = Math.hypot(dx, dz);
      const scale = length > 1 ? 1 / length : 1;

      player.aim = aim;
      player.moving = length > 0;
      player.x = clamp(
        player.x + (dx * scale * WALK_SPEED + runtime.pushX) * dt,
        -ARENA_SIZE,
        ARENA_SIZE,
      );
      player.z = clamp(
        player.z + (dz * scale * WALK_SPEED + runtime.pushZ) * dt,
        -ARENA_SIZE,
        ARENA_SIZE,
      );
      runtime.pushX *= Math.exp(-KNOCKBACK_DECAY * dt);
      runtime.pushZ *= Math.exp(-KNOCKBACK_DECAY * dt);
    });

    this.state.shots.forEach((shot, id) => {
      const life = (this.shotLife.get(id) ?? 0) - dtMs;

      shot.x += shot.vx * dt;
      shot.z += shot.vz * dt;
      this.shotLife.set(id, life);

      let hit = false;

      this.state.players.forEach((player, playerId) => {
        const runtime = this.runtime.get(playerId);

        if (hit || playerId === shot.owner || !runtime) return;
        if (Math.hypot(player.x - shot.x, player.z - shot.z) > HIT_RADIUS) return;

        const owner = this.state.players.get(shot.owner);

        hit = true;
        if (owner) owner.hits++;
        runtime.pushX += (shot.vx / SHOT_SPEED) * KNOCKBACK;
        runtime.pushZ += (shot.vz / SHOT_SPEED) * KNOCKBACK;
        this.broadcast("hit", { id: playerId });
      });

      if (hit || life <= 0) this.removeShot(id, shot, true);
    });
  }
}
