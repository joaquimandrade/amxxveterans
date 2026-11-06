import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") name = "";
  @type("number") hue = 0;
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") aim = 0;
  @type("boolean") moving = false;
  @type("boolean") running = false;
  @type("number") hits = 0;
  @type("number") mana = 100;
  @type("string") weapon = "sword";
  @type(["string"]) inventory = new ArraySchema<string>("sword");
}

export class GroundItem extends Schema {
  @type("string") kind = "";
  @type("number") x = 0;
  @type("number") z = 0;
}

export class Chest extends Schema {
  @type("number") x = 0;
  @type("number") z = 0;
  @type("boolean") open = false;
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
  @type({ map: GroundItem }) items = new MapSchema<GroundItem>();
  @type({ map: Chest }) chests = new MapSchema<Chest>();
}
