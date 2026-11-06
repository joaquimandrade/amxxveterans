import { OBJECTS, SPAWN, WORLD_H, WORLD_W } from "./forest.ts";

export type Point = [number, number];
export type Circle = { x: number; y: number; radius: number };
export type Area = {
  width: number;
  height: number;
  floor?: Point[];
  solids: Circle[];
};
export type Hotspot = {
  id: string;
  area: string;
  x: number;
  y: number;
  label: string;
  toArea: string;
  toX: number;
  toY: number;
  /** The clickable object's outline, in world coordinates. */
  outline: Point[];
  /** A door's central gap, where light leaks out when it is hovered. */
  seam?: { x: number; top: number; bottom: number };
};

/* Room paintings were laid out on an 1100 wide preview, then drawn at this scale. */
const ROOM_SCALE = 1.3;
const ROOM_W = 1430;
const ROOM_H = 798;
const room = (points: Point[]): Point[] => points.map(([x, y]) => [x * ROOM_SCALE, y * ROOM_SCALE]);
const at = (x: number, y: number) => ({ x: x * ROOM_SCALE, y: y * ROOM_SCALE });

export const MANSION = { x: SPAWN.x + 60, y: SPAWN.y - 300 };

/* The mansion sprite's door, measured on the same preview: 600 tall, drawn 640 tall */
const MANSION_LEFT = MANSION.x - 321;
const MANSION_TOP = MANSION.y - 632;
const onMansion = ([x, y]: Point): Point => [MANSION_LEFT + (x - 250) * 1.0667, MANSION_TOP + (y - 5) * 1.0667];

const door = { x: MANSION.x - 171, y: MANSION.y - 30 };
const hallDoor = at(345, 350);
const hallStairs = at(505, 318);
const upperStairs = at(860, 470);

export const NPCS = [{ sprite: "npc_woman", area: "upper", ...at(560, 395) }];

export const AREAS: Record<string, Area> = {
  city: {
    width: WORLD_W,
    height: WORLD_H,
    solids: [
      ...OBJECTS.filter((object) => object.radius > 0).map(({ x, y, radius }) => ({ x, y, radius })),
      { x: MANSION.x + 120, y: MANSION.y - 150, radius: 170 },
      { x: MANSION.x - 110, y: MANSION.y - 170, radius: 95 },
    ],
  },
  hall: {
    width: ROOM_W,
    height: ROOM_H,
    floor: room([[240, 368], [400, 295], [500, 305], [640, 345], [770, 400], [880, 440], [630, 585], [455, 510], [420, 525], [315, 465], [345, 440]]),
    solids: [{ ...at(715, 485), radius: 80 }],
  },
  upper: {
    width: ROOM_W,
    height: ROOM_H,
    floor: room([[215, 375], [400, 295], [450, 230], [620, 285], [690, 325], [700, 380], [850, 455], [905, 470], [740, 585], [470, 450], [385, 490]]),
    solids: [{ ...at(560, 395), radius: 26 }],
  },
};

const mansionDoor: Point[] = [[340, 545], [342, 455], [360, 425], [383, 413], [408, 428], [420, 458], [418, 562]];
const [doorSeamX, doorSeamTop] = onMansion([382, 420]);
const [, doorSeamBottom] = onMansion([382, 552]);

export const HOTSPOTS: Hotspot[] = [
  {
    id: "enter", area: "city", x: door.x, y: door.y, label: "Enter the mansion",
    toArea: "hall", toX: hallDoor.x, toY: hallDoor.y,
    outline: mansionDoor.map(onMansion),
    seam: { x: doorSeamX, top: doorSeamTop, bottom: doorSeamBottom },
  },
  {
    id: "leave", area: "hall", ...at(335, 345), label: "Leave",
    toArea: "city", toX: door.x - 30, toY: door.y + 60,
    outline: room([[278, 330], [278, 210], [300, 160], [330, 137], [362, 160], [385, 210], [385, 295]]),
    seam: { x: 332 * ROOM_SCALE, top: 142 * ROOM_SCALE, bottom: 312 * ROOM_SCALE },
  },
  {
    id: "up", area: "hall", ...at(490, 305), label: "Go upstairs",
    toArea: "upper", toX: upperStairs.x, toY: upperStairs.y,
    outline: room([[432, 272], [538, 150], [595, 150], [600, 250], [505, 305]]),
  },
  {
    id: "down", area: "upper", ...at(880, 460), label: "Go downstairs",
    toArea: "hall", toX: hallStairs.x, toY: hallStairs.y,
    outline: room([[815, 375], [1000, 365], [1005, 430], [925, 462], [850, 430]]),
  },
];

export function insidePolygon(polygon: Point[], x: number, y: number) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function insideFloor(area: Area, x: number, y: number) {
  if (!area.floor) return x >= 0 && y >= 0 && x <= area.width && y <= area.height;
  return insidePolygon(area.floor, x, y);
}
