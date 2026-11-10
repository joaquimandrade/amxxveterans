/** What exists in the square: weapons, the cast, the objects and where they stand. */
export type Weapon = "molotov" | "bat" | "shotgun";

export const WEAPON_ORDER: Weapon[] = ["molotov", "bat", "shotgun"];

export const WEAPONS: Record<Weapon, {
  label: string; damage: number; reach: number; cooldown: number; duration: number; fireAt: number; hint: string;
}> = {
  molotov: { label: "Molotov", damage: 16, reach: 400, cooldown: 1.15, duration: 0.5, fireAt: 0.26, hint: "burns cars, wood and paper" },
  bat: { label: "Bat", damage: 17, reach: 82, cooldown: 0.42, duration: 0.36, fireAt: 0.17, hint: "shatters glass" },
  shotgun: { label: "Shotgun", damage: 27, reach: 400, cooldown: 0.82, duration: 0.42, fireAt: 0.12, hint: "pierces steel and stone" },
};

/** Damage multipliers: an object's weak spot, anything else, and a character's favourite weapon. */
export const WEAK = 2.2;
export const RESIST = 0.7;
export const SPECIALTY = 1.5;
export const ROUND_SECONDS = 100;
export const BURN_PER_SECOND = 10;
export const FIRE_SECONDS = 3.6;
export const FIRE_RADIUS = 105;

export interface CharDef { id: string; name: string; special: Weapon; color: string; bio: string }

export const CHARS: CharDef[] = [
  { id: "moussa", name: "Moussa", special: "bat", color: "#4f8dff", bio: "Fast hands, heavy swing." },
  { id: "yasmine", name: "Yasmine", special: "molotov", color: "#35c98a", bio: "Never misses a throw." },
  { id: "leo", name: "Léo", special: "shotgun", color: "#f0b93a", bio: "Steady aim, cold nerves." },
];

/** The fourth rioter reuses one of the cast with the jacket re-dyed: hue range to move, and by how much. */
export const DOUBLES: Record<string, { name: string; color: string; from: [number, number]; shift: number }> = {
  moussa: { name: "Kofi", color: "#ff6b5a", from: [195, 260], shift: 140 },
  yasmine: { name: "Inès", color: "#c77dff", from: [115, 180], shift: 140 },
};

export interface ObjDef {
  label: string; weak: Weapon; hp: number;
  /** Depth of the footprint on the ground, as a fraction of nothing: world units. */
  depth: number;
  /** Footprint width as a fraction of the sprite width. */
  foot?: number;
  /** Small things stop blocking the way once wrecked. */
  clears?: boolean;
  decor?: boolean;
  burns?: boolean;
}

const car = (label: string, hp: number): ObjDef => ({ label, weak: "molotov", hp, depth: 70, foot: 0.86, burns: true });
const shop = (label: string, weak: Weapon = "bat", hp = 360): ObjDef => ({ label, weak, hp, depth: 0 });

export const OBJECTS: Record<string, ObjDef> = {
  hatch: car("Hatchback", 250), saloon: car("Saloon", 270), van: car("Van", 330), taxi: car("Taxi", 270),
  suv: car("SUV", 300), scooter: { ...car("Scooter", 110), depth: 26, foot: 0.7, clears: true },
  morris: { label: "Poster column", weak: "molotov", hp: 170, depth: 44, foot: 0.8, burns: true },
  kiosk: { label: "Kiosk", weak: "molotov", hp: 240, depth: 80, foot: 0.85, burns: true },
  shelter: { label: "Bus shelter", weak: "bat", hp: 210, depth: 46, foot: 0.9 },
  booth: { label: "Phone booth", weak: "bat", hp: 150, depth: 44, foot: 0.8 },
  lamp: { label: "Street lamp", weak: "shotgun", hp: 120, depth: 18, foot: 0.35, clears: true },
  light: { label: "Traffic light", weak: "shotgun", hp: 110, depth: 16, foot: 0.4, clears: true },
  fountain: { label: "Fountain", weak: "shotgun", hp: 190, depth: 40, foot: 0.8 },
  tree: { label: "Tree", weak: "molotov", hp: 1, depth: 18, foot: 0.12, decor: true },
  terrace: { label: "Café terrace", weak: "bat", hp: 150, depth: 50, foot: 0.7, clears: true },
  stall: { label: "Fruit stall", weak: "molotov", hp: 190, depth: 60, foot: 0.85, burns: true },
  meter: { label: "Parking meter", weak: "shotgun", hp: 100, depth: 16, foot: 0.6, clears: true },
  bikes: { label: "Bike rack", weak: "bat", hp: 170, depth: 36, foot: 0.85, clears: true },
  bench: { label: "Bench", weak: "molotov", hp: 120, depth: 30, foot: 0.9, clears: true, burns: true },
  statue: { label: "Statue", weak: "shotgun", hp: 340, depth: 70, foot: 0.8 },
  bins: { label: "Bins", weak: "molotov", hp: 140, depth: 36, foot: 0.85, clears: true, burns: true },
  panel: { label: "Ad panel", weak: "bat", hp: 130, depth: 16, foot: 0.7, clears: true },
  boulangerie: shop("Boulangerie"), cafe: shop("Café"), pharmacie: shop("Pharmacie"),
  banque: shop("Bank", "shotgun", 440), boutique: shop("Boutique"), tabac: shop("Tabac"),
};

export const WORLD = { w: 2400, h: 1800, shopBase: 250 };

/** name, x of the centre, y of the base, mirrored */
export const LAYOUT: [string, number, number, boolean?][] = [
  ["boulangerie", 200, 250], ["cafe", 600, 250], ["banque", 1000, 250], ["boutique", 1400, 250],
  ["pharmacie", 1800, 250], ["tabac", 2200, 250],
  ["stall", 190, 420], ["terrace", 500, 400], ["terrace", 720, 410, true], ["meter", 880, 350],
  ["lamp", 400, 355], ["lamp", 1200, 355], ["lamp", 2000, 355], ["panel", 1185, 450], ["booth", 1560, 370],
  ["meter", 1690, 350], ["bins", 2260, 430],
  ["hatch", 420, 640], ["saloon", 800, 650, true], ["taxi", 1620, 640], ["van", 2010, 660, true],
  ["light", 150, 570], ["light", 2270, 610],
  ["fountain", 860, 820], ["statue", 1200, 920], ["bench", 990, 990], ["bench", 1420, 990, true],
  ["morris", 1560, 820], ["bikes", 400, 940], ["bins", 180, 820],
  ["kiosk", 690, 1140], ["scooter", 880, 1160], ["shelter", 1760, 1140], ["panel", 1500, 1210],
  ["scooter", 2090, 990, true], ["booth", 2180, 1190], ["terrace", 1960, 900],
  ["lamp", 500, 1310], ["lamp", 1200, 1290], ["lamp", 1900, 1310], ["meter", 1010, 1370],
  ["suv", 720, 1700], ["hatch", 1140, 1710, true], ["saloon", 1560, 1700], ["taxi", 1990, 1710, true],
  ["light", 330, 1660], ["light", 2240, 1640], ["stall", 250, 1210, true],
  ["tree", 60, 510], ["tree", 60, 1060], ["tree", 2340, 810], ["tree", 2340, 1370], ["tree", 60, 1740],
];
