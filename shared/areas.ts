import { OBJECTS, WORLD_H, WORLD_W } from "./forest.ts";

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
  /** The painting the glow is cut from, and where its top left corner sits. */
  image: { sprite: string; x: number; y: number };
  /** A door's central gap, where light leaks out when it is hovered. */
  seam?: { x: number; top: number; bottom: number };
};

export type Npc = { sprite: string; area: string; x: number; y: number };

export const NPCS: Npc[] = [];

export const AREAS: Record<string, Area> = {
  city: {
    width: WORLD_W,
    height: WORLD_H,
    solids: OBJECTS.filter((object) => object.radius > 0).map(({ x, y, radius }) => ({ x, y, radius })),
  },
};

export const HOTSPOTS: Hotspot[] = [];

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
