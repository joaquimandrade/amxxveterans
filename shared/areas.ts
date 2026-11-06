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
};

/* Room paintings were laid out on an 1100 wide preview, then drawn at this scale. */
const ROOM_SCALE = 1.3;
const ROOM_W = 1430;
const ROOM_H = 798;
const room = (points: Point[]): Point[] => points.map(([x, y]) => [x * ROOM_SCALE, y * ROOM_SCALE]);
const at = (x: number, y: number) => ({ x: x * ROOM_SCALE, y: y * ROOM_SCALE });

export const MANSION = { x: SPAWN.x + 60, y: SPAWN.y - 300 };

const door = { x: MANSION.x - 171, y: MANSION.y - 30 };
const hallDoor = at(345, 350);
const hallStairs = at(505, 318);
const upperStairs = at(860, 470);

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
    solids: [],
  },
};

export const HOTSPOTS: Hotspot[] = [
  { id: "enter", area: "city", x: door.x, y: door.y, label: "Enter the mansion", toArea: "hall", toX: hallDoor.x, toY: hallDoor.y },
  { id: "leave", area: "hall", ...at(335, 345), label: "Leave", toArea: "city", toX: door.x - 30, toY: door.y + 60 },
  { id: "up", area: "hall", ...at(490, 305), label: "Go upstairs", toArea: "upper", toX: upperStairs.x, toY: upperStairs.y },
  { id: "down", area: "upper", ...at(880, 460), label: "Go downstairs", toArea: "hall", toX: hallStairs.x, toY: hallStairs.y },
];

export function insideFloor(area: Area, x: number, y: number) {
  if (!area.floor) return x >= 0 && y >= 0 && x <= area.width && y <= area.height;
  let inside = false;

  for (let i = 0, j = area.floor.length - 1; i < area.floor.length; j = i++) {
    const [xi, yi] = area.floor[i];
    const [xj, yj] = area.floor[j];

    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
