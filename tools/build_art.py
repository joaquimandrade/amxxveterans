"""Cuts the French Rebellion paintings into game sprites and lays out the square.

Usage: build_art.py SOURCE_DIR REPO_DIR
Sources (in SOURCE_DIR/fr): title, chars4 (character select), ground, shops / shops_broken,
props / props_broken, and per character (pyro, brute, chasseur): walk_front, walk_back
(4x2 grids painted over motion capture) and atk_<weapon> / atkb_<weapon> (5 frames, front / back).
"""
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

SOURCE, REPO = sys.argv[1] + "/fr", sys.argv[2]
ART = f"{REPO}/client/public/art"
CELL_W, CELL_H, FEET_Y = 300, 260, 245
BODY_HEIGHT = 140          # head to feet of every character, in every sheet, so frames never jump in size
CHARACTERS = ["pyro", "brute", "chasseur"]
WEAPONS = ["molotov", "bat", "shotgun"]
WORLD_W = 3600
PREVIEW_W = 1100           # layout coordinates below were measured on an 1100 wide preview of the ground

# Every sprite must face right; the game mirrors it when moving or aiming left. Attack sheets are checked
# automatically (see faces_left); this table forces a sheet either way when the check gets it wrong.
MIRROR = {}


def load(name):
    return np.asarray(Image.open(f"{SOURCE}/{name}.png").convert("RGB")).astype(np.float32)


def key_alpha(rgb):
    """Magenta key that copes with the blotchy pink backdrops the painter sometimes returns."""
    corners = np.concatenate([rgb[:40, :40].reshape(-1, 3), rgb[-40:, -40:].reshape(-1, 3)])
    distance = np.linalg.norm(rgb - np.median(corners, axis=0), axis=2)
    alpha = np.clip((distance - 34) / 34, 0, 1)
    pink = np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]
    return np.minimum(alpha, np.clip((50 - pink) / 25, 0, 1))


def body_height(mask):
    """Head-to-feet height that ignores thin things held up high (bats, barrels, bottles)."""
    rows = (mask > 0.5).sum(axis=1)
    ys = np.where(rows > 0)[0]
    widest = rows.max()
    top = np.where(rows >= widest * 0.22)[0].min()
    return ys.max() - top


def main_blob(alpha):
    pieces, _ = ndimage.label(ndimage.binary_closing(alpha > 0.5, iterations=2))
    sizes = np.bincount(pieces.ravel())
    sizes[0] = 0
    return pieces == sizes.argmax()


def cells(rgb, alpha, columns, rows):
    height, width = alpha.shape
    frames = []
    for row in range(rows):
        for column in range(columns):
            left, top = column * width // columns, row * height // rows
            right, bottom = left + width // columns, top + height // rows
            part = alpha[top:bottom, left:right]
            blob = main_blob(part)
            # Keep blobs close to the main figure too (a bottle leaving the hand, a muzzle flash).
            near = ndimage.binary_dilation(blob, iterations=25) & (part > 0.5)
            mask = np.where(near, part, 0)
            ys, xs = np.where(mask > 0.5)
            lower = ys > ys.min() + (ys.max() - ys.min()) * 0.55
            center = float(np.median(xs[lower]))
            frames.append((rgb[top:bottom, left:right], mask, center, ys.max()))
    return frames


def row_cells(rgb, alpha, count):
    """Attack sheets are one row; cut between figures at the emptiest columns."""
    columns = np.where((alpha > 0.5).any(axis=0))[0]
    edges = np.linspace(columns.min(), columns.max() + 1, count + 1).round().astype(int)
    mass = (alpha > 0.5).sum(axis=0)
    for i in range(1, count):
        low, high = edges[i] - 60, edges[i] + 60
        edges[i] = low + int(np.argmin(mass[low:high]))
    frames = []
    for i in range(count):
        part = alpha[:, edges[i]:edges[i + 1]]
        blob = main_blob(part)
        near = ndimage.binary_dilation(blob, iterations=25) & (part > 0.5)
        mask = np.where(near, part, 0)
        ys, xs = np.where(mask > 0.5)
        lower = ys > ys.min() + (ys.max() - ys.min()) * 0.6
        center = float(np.median(xs[lower]))
        frames.append((rgb[:, edges[i]:edges[i + 1]], mask, center, ys.max()))
    return frames


def faces_left(frames):
    """In the strike frame the weapon, arm or muzzle flash reaches out in front: compare its mass either side of the feet."""
    rgb, mask, center, _ = frames[2]
    ys, xs = np.where(mask > 0.5)
    upper = ys < ys.min() + (ys.max() - ys.min()) * 0.6
    return float(np.mean(xs[upper])) < center


def write_sheet(frames, out, mirror):
    heights = [body_height(mask) for _, mask, _, _ in frames]
    scale = BODY_HEIGHT / float(np.median(heights))
    sheet = Image.new("RGBA", (CELL_W * len(frames), CELL_H), (0, 0, 0, 0))
    for index, (rgb, mask, center, bottom) in enumerate(frames):
        sprite = Image.fromarray(np.dstack([rgb, mask * 255]).astype(np.uint8), "RGBA")
        if mirror:
            sprite = sprite.transpose(Image.FLIP_LEFT_RIGHT)
            center = sprite.width - center
        sprite = sprite.resize((max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale))), Image.LANCZOS)
        x = round(CELL_W * index + CELL_W / 2 - center * scale)
        y = round(FEET_Y - (bottom + 1) * scale)
        sheet.alpha_composite(sprite, (max(0, x), max(0, y))) if x >= 0 and y >= 0 else sheet.paste(sprite, (x, y), sprite)
    sheet.save(f"{ART}/{out}.webp", quality=88, method=6)


def characters():
    for name in CHARACTERS:
        for side in ("front", "back"):
            rgb = load(f"{name}_walk_{side}")
            out = f"{name}_walk_{side}"
            write_sheet(cells(rgb, key_alpha(rgb), 4, 2), out, MIRROR.get(out, False))
        for weapon in WEAPONS:
            for side, prefix in (("front", "atk"), ("back", "atkb")):
                rgb = load(f"{name}_{prefix}_{weapon}")
                out = f"{name}_{weapon}_{side}"
                frames = row_cells(rgb, key_alpha(rgb), 5)
                write_sheet(frames, out, MIRROR.get(out, faces_left(frames)))


def cut_objects(name, count, rows):
    """Objects on magenta, grouped (fence pickets, glass) and read row by row."""
    rgb = load(name)
    pink = np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]
    mask = ndimage.binary_opening(pink < 60, iterations=1)
    groups, found = ndimage.label(ndimage.binary_dilation(mask, iterations=10))
    sizes = ndimage.sum(mask, groups, range(1, found + 1))
    largest = np.argsort(sizes)[-count:] + 1
    areas = ndimage.find_objects(groups)
    boxes = sorted([(label, areas[label - 1]) for label in largest], key=lambda b: (b[1][0].start + b[1][0].stop) / 2)
    per_row = count // rows
    ordered = []
    for r in range(rows):
        ordered += sorted(boxes[r * per_row:(r + 1) * per_row], key=lambda b: b[1][1].start)
    out = []
    for label, area in ordered:
        shape = (groups[area] == label) & mask[area]
        alpha = ndimage.gaussian_filter(shape.astype(np.float32), 0.9) * np.clip(1 - (pink[area] - 30) / 40, 0, 1)
        out.append(Image.fromarray(np.dstack([rgb[area], alpha * 255]).astype(np.uint8), "RGBA"))
    return out


# kind: (sprite index in its sheet, height in world pixels, solid radius as a share of width)
SHOP_KINDS = [("boulangerie", 560), ("cafe", 560), ("banque", 560), ("mobile", 560)]
PROP_KINDS = [("car_red", 120), ("car_white", 120), ("van", 170), ("kiosk", 230),
              ("atm", 190), ("shelter", 200), ("scooter", 100), ("bins", 110),
              ("light", 270), ("bench", 90), ("bikes", 110), ("column", 270)]


def objects():
    sprites = {}
    for sheet, kinds, count, rows in (("shops", SHOP_KINDS, 4, 1), ("props", PROP_KINDS, 12, 3)):
        intact = cut_objects(sheet, count, rows)
        broken = cut_objects(f"{sheet}_broken", count, rows)
        for (kind, height), a, b in zip(kinds, intact, broken):
            for state, image in (("", a), ("_broken", b)):
                scale = height / image.height
                image = image.resize((round(image.width * scale), height), Image.LANCZOS)
                image.save(f"{ART}/obj_{kind}{state}.webp", quality=88, method=6)
            sprites[kind] = {"w": round(a.width * height / a.height), "h": height}
    return sprites


# Where things stand on the ground painting (1100 wide preview coordinates).
LAYOUT = [
    ("boulangerie", 560, 95), ("cafe", 105, 330), ("banque", 995, 330), ("mobile", 560, 612),
    ("car_red", 300, 160), ("car_white", 800, 450), ("van", 250, 470), ("car_red", 830, 150),
    ("car_white", 690, 245), ("kiosk", 700, 560), ("atm", 1050, 445), ("shelter", 405, 545),
    ("scooter", 380, 260), ("bins", 170, 240), ("light", 300, 105), ("light", 790, 525),
    ("bench", 520, 330), ("bikes", 95, 455), ("column", 640, 335), ("scooter", 880, 330),
]


def ground():
    source = Image.open(f"{SOURCE}/ground.png").convert("RGB")
    height = round(WORLD_W * source.height / source.width)
    source.resize((WORLD_W, height), Image.LANCZOS).save(f"{ART}/ground.webp", quality=82, method=6)
    return height


def screens():
    title = Image.open(f"{SOURCE}/title.png").convert("RGB")
    title.resize((1600, round(1600 * title.height / title.width)), Image.LANCZOS).save(f"{ART}/title.webp", quality=86, method=6)
    cast = Image.open(f"{SOURCE}/chars4.png").convert("RGB")
    scale = cast.width / 1376
    for name, (left, right) in zip(CHARACTERS, ((60, 440), (480, 900), (920, 1360))):
        card = cast.crop((round(left * scale), round(40 * scale), round(right * scale), round(760 * scale)))
        card.thumbnail((420, 760), Image.LANCZOS)
        card.save(f"{ART}/card_{name}.webp", quality=86, method=6)
        face = cast.crop((round((left + right) / 2 * scale - 80 * scale), round(70 * scale), round((left + right) / 2 * scale + 80 * scale), round(230 * scale)))
        face.resize((128, 128), Image.LANCZOS).save(f"{ART}/face_{name}.webp", quality=88, method=6)


height = ground()
screens()
characters()
sprites = objects()
factor = WORLD_W / PREVIEW_W
placed = [{"kind": kind, "x": round(x * factor), "y": round(y * factor)} for kind, x, y in LAYOUT]
with open(f"{REPO}/client/src/layout.ts", "w") as out:
    out.write(
        "/* Generated by tools/build_art.py. */\n"
        f"export const WORLD_W = {WORLD_W};\nexport const WORLD_H = {height};\n"
        f"export const SPRITES: Record<string, {{ w: number; h: number }}> = {json.dumps(sprites)};\n"
        f"export const OBJECTS = {json.dumps(placed)};\n"
    )
print("ok", height, len(placed))
