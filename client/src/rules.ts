/* Game rules for French Rebellion: weapons, characters and what each object is weak to. */

export type Weapon = "molotov" | "bat" | "shotgun";
export const WEAPONS: Weapon[] = ["molotov", "bat", "shotgun"];

export const WEAPON_INFO: Record<Weapon, {
  label: string; icon: string; range: number; cooldown: number; damage: number;
  /** Seconds into the attack animation when the hit lands (or the bottle leaves the hand). */
  hitAt: number; splash: number;
}> = {
  molotov: { label: "Molotov", icon: "🔥", range: 430, cooldown: 1.3, damage: 34, hitAt: 0.27, splash: 115 },
  bat: { label: "Bat", icon: "🏏", range: 70, cooldown: 0.6, damage: 30, hitAt: 0.24, splash: 0 },
  shotgun: { label: "Shotgun", icon: "💥", range: 330, cooldown: 1.0, damage: 44, hitAt: 0.22, splash: 80 },
};

/** Fire keeps burning for this long and deals this much per second, credited to the thrower. */
export const BURN_SECONDS = 4;
export const BURN_DPS = 13;
export const SPECIALIST_BONUS = 1.5;
export const ROUND_SECONDS = 180;
export const ATTACK_MS = 450;

export type CharacterId = "pyro" | "brute" | "chasseur";
export const CHARACTERS: Record<CharacterId, { name: string; weapon: Weapon; blurb: string }> = {
  pyro: { name: "Le Pyromane", weapon: "molotov", blurb: "+50% with molotovs" },
  brute: { name: "La Brute", weapon: "bat", blurb: "+50% with the bat" },
  chasseur: { name: "Le Chasseur", weapon: "shotgun", blurb: "+50% with the shotgun" },
};

type Weakness = Record<Weapon, number>;
const W = (molotov: number, bat: number, shotgun: number): Weakness => ({ molotov, bat, shotgun });

/** Energy, damage taken per weapon, and the bonus for wrecking it. Points also come from every point of damage. */
export const KINDS: Record<string, { label: string; hp: number; weak: Weakness; bonus: number; solid: number }> = {
  boulangerie: { label: "Boulangerie", hp: 900, weak: W(1.3, 1.6, 1.0), bonus: 800, solid: 0.34 },
  cafe: { label: "Café", hp: 900, weak: W(1.3, 1.6, 1.0), bonus: 800, solid: 0.34 },
  banque: { label: "Banque", hp: 1100, weak: W(1.2, 1.4, 1.2), bonus: 1000, solid: 0.34 },
  mobile: { label: "Phone shop", hp: 900, weak: W(1.3, 1.6, 1.0), bonus: 800, solid: 0.34 },
  car_red: { label: "Car", hp: 300, weak: W(2.5, 0.6, 1.0), bonus: 300, solid: 0.36 },
  car_white: { label: "Car", hp: 320, weak: W(2.5, 0.6, 1.0), bonus: 300, solid: 0.36 },
  van: { label: "Van", hp: 380, weak: W(2.5, 0.6, 1.0), bonus: 350, solid: 0.36 },
  kiosk: { label: "Kiosk", hp: 260, weak: W(1.8, 1.0, 1.0), bonus: 250, solid: 0.32 },
  atm: { label: "Cash machine", hp: 220, weak: W(0.4, 0.8, 2.5), bonus: 300, solid: 0.3 },
  shelter: { label: "Bus shelter", hp: 200, weak: W(0.5, 2.0, 1.5), bonus: 200, solid: 0.3 },
  scooter: { label: "Scooter", hp: 120, weak: W(1.8, 1.2, 1.2), bonus: 120, solid: 0.3 },
  bins: { label: "Bins", hp: 90, weak: W(2.0, 1.0, 0.8), bonus: 60, solid: 0.32 },
  light: { label: "Traffic light", hp: 140, weak: W(0.3, 0.8, 2.2), bonus: 150, solid: 0.15 },
  bench: { label: "Bench", hp: 80, weak: W(1.6, 1.0, 1.0), bonus: 50, solid: 0.3 },
  bikes: { label: "Bikes", hp: 110, weak: W(0.8, 1.6, 1.0), bonus: 100, solid: 0.32 },
  column: { label: "Ad column", hp: 180, weak: W(1.6, 1.0, 1.2), bonus: 150, solid: 0.25 },
};

export function bestWeapon(kind: string, character: CharacterId): Weapon {
  const weak = KINDS[kind].weak;
  let best: Weapon = CHARACTERS[character].weapon;
  let value = 0;

  for (const weapon of WEAPONS) {
    const v = weak[weapon] * (CHARACTERS[character].weapon === weapon ? SPECIALIST_BONUS : 1);

    if (v > value) {
      value = v;
      best = weapon;
    }
  }
  return best;
}
