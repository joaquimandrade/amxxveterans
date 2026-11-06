import { MapSchema, Schema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") name = "";
  @type("number") hue = 0;
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") aim = 0;
  @type("boolean") moving = false;
  @type("boolean") running = false;
  @type("number") hits = 0;
}

export class Shot extends Schema {
  @type("string") owner = "";
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") vx = 0;
  @type("number") vz = 0;
}

export class ArenaState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Shot }) shots = new MapSchema<Shot>();
}
