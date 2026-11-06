"""Cuts the painted source sheets into game sprites and places the forest.

Usage: build_art.py SOURCE_DIR REPO_DIR
Sources: ground.png, objects2.png, items.png, walk_front, walk_back,
slash_front and slash_back (each also with an axe_ prefix), and the walk
cycles pw_front, pw_back, pa_front and pa_back.
"""
import json
import random
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

SOURCE, REPO = sys.argv[1], sys.argv[2]
ART = f"{REPO}/client/public/art"
WORLD_W = 4096
CELL_W, CELL_H, FEET_Y = 340, 300, 282
HERO_HEIGHT = 170


def load(name):
    return np.asarray(Image.open(f"{SOURCE}/{name}").convert("RGB")).astype(np.float32)


def hero_alpha(rgb):
    corners = np.concatenate([rgb[:40, :40].reshape(-1, 3), rgb[-40:, -40:].reshape(-1, 3)])
    distance = np.linalg.norm(rgb - np.median(corners, axis=0), axis=2)
    return np.clip((distance - 34) / 34, 0, 1)


def frames_of(name, count):
    rgb = load(name)
    alpha = hero_alpha(rgb)
    labels, found = ndimage.label(ndimage.binary_closing(alpha > 0.5, iterations=2))
    sizes = ndimage.sum(np.ones_like(labels), labels, range(1, found + 1))
    big = [index + 1 for index, size in enumerate(sizes) if size > 4000]

    if len(big) != count:
        # Swords touch the next figure, so cut the row into equal columns instead.
        columns = np.where((alpha > 0.5).any(axis=0))[0]
        edges = np.linspace(columns.min(), columns.max() + 1, count + 1).round().astype(int)
        mass = (alpha > 0.5).sum(axis=0)
        for index in range(1, count):
            low, high = edges[index] - 60, edges[index] + 60
            edges[index] = low + int(np.argmin(mass[low:high]))
        labels = np.zeros_like(labels)
        for index in range(count):
            part = alpha[:, edges[index]:edges[index + 1]] > 0.5
            pieces, _ = ndimage.label(part)
            sizes = np.bincount(pieces.ravel())
            sizes[0] = 0
            labels[:, edges[index]:edges[index + 1]][pieces == sizes.argmax()] = index + 1
        big = list(range(1, count + 1))

    keep = sorted(big, key=lambda l: np.where(labels == l)[1].mean())
    frames = []

    for label in keep:
        ys, xs = np.where(labels == label)
        top, bottom, left, right = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        mask = (labels[top:bottom, left:right] == label) * alpha[top:bottom, left:right]
        lower = ys > top + (bottom - top) * 0.55
        center = float(np.median(xs[lower])) - left
        frames.append((rgb[top:bottom, left:right], mask, center))
    return frames


def hero_sheet(name, out, count, scale, keep=None):
    keep = keep or count
    sheet = Image.new("RGBA", (CELL_W * keep, CELL_H), (0, 0, 0, 0))

    for index, (rgb, mask, center) in enumerate(frames_of(name, count)[:keep]):
        pixels = np.dstack([rgb, mask * 255]).astype(np.uint8)
        sprite = Image.fromarray(pixels, "RGBA")
        size = (max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale)))
        sprite = sprite.resize(size, Image.LANCZOS)
        sheet.alpha_composite(sprite, (
            max(0, round(CELL_W * index + CELL_W / 2 - center * scale)),
            max(0, FEET_Y - sprite.height),
        ))
    sheet.save(f"{ART}/{out}.webp", quality=88, method=6)


def grid_frames(name):
    """Walk sheets are a 4 by 2 grid painted over motion-captured poses."""
    rgb = load(name)
    alpha = hero_alpha(rgb)
    height, width = alpha.shape
    frames = []

    for index in range(8):
        left, top = (index % 4) * width // 4, (index // 4) * height // 2
        right, bottom = left + width // 4, top + height // 2
        cell = alpha[top:bottom, left:right] > 0.5
        pieces, _ = ndimage.label(ndimage.binary_closing(cell, iterations=2))
        sizes = np.bincount(pieces.ravel())
        sizes[0] = 0
        main = pieces == sizes.argmax()
        ys, xs = np.where(main)
        top_y, bottom_y = ys.min(), ys.max() + 1
        torso = (ys > top_y + (bottom_y - top_y) * 0.15) & (ys < top_y + (bottom_y - top_y) * 0.5)
        frames.append((rgb[top:bottom, left:right], main * alpha[top:bottom, left:right], float(np.median(xs[torso])), bottom_y))
    return frames


def walk_sheet(name, out, scale, replace_first):
    frames = grid_frames(name)
    if replace_first:
        frames[0] = frames[4]
    baseline = np.median([frame[3] for frame in frames])
    sheet = Image.new("RGBA", (CELL_W * 8, CELL_H), (0, 0, 0, 0))

    for index, (rgb, mask, center, _) in enumerate(frames):
        pixels = np.dstack([rgb, mask * 255]).astype(np.uint8)
        sprite = Image.fromarray(pixels, "RGBA")
        sprite = sprite.resize((round(sprite.width * scale), round(sprite.height * scale)), Image.LANCZOS)
        x = round(CELL_W * index + CELL_W / 2 - center * scale)
        y = round(FEET_Y - baseline * scale)
        sheet.paste(sprite, (x, y), sprite)
    sheet.save(f"{ART}/{out}.webp", quality=88, method=6)


def hero():
    standing = grid_frames("pw_front.png")[0]
    ys = np.where(standing[1] > 0.5)[0]
    walk_scale = HERO_HEIGHT / (ys.max() - ys.min())

    for walk_prefix, prefix, out in (("pw", "", "hero"), ("pa", "axe_", "hero_axe")):
        walk_sheet(f"{walk_prefix}_front.png", f"{out}_walk_front", walk_scale, False)
        walk_sheet(f"{walk_prefix}_back.png", f"{out}_walk_back", walk_scale, True)

        scale = HERO_HEIGHT / frames_of(f"{prefix}walk_front.png", 6)[0][1].shape[0]

        for name, sheet, count in (
            ("walk_front", "idle_front", 1),
            ("walk_back", "idle_back", 1),
            ("slash_front", "slash_front", 5),
            ("slash_back", "slash_back", 5),
        ):
            source = 6 if count == 1 else count
            hero_sheet(f"{prefix}{name}.png", f"{out}_{sheet}", source, scale, count)


# Item centres on a 1376 by 386 preview, and the height each one is drawn at.
ITEMS = {
    "axe": (180, 180, 84), "chest": (540, 95, 96), "chest_open": (930, 105, 112),
    "potion_mana": (1245, 70, 52), "potion_health": (1245, 185, 52), "sword": (490, 215, 30),
    "coins": (515, 300, 52), "ring": (810, 285, 44), "helmet": (1030, 290, 60), "pouch": (1250, 300, 56),
}


def items():
    rgb = load("items.png")
    pink = np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]
    mask = ndimage.binary_opening(pink < 40, iterations=2)
    labels, found = ndimage.label(mask)
    sizes = ndimage.sum(np.ones_like(labels), labels, range(1, found + 1))
    factor_x, factor_y = rgb.shape[1] / 1376, rgb.shape[0] / 386
    areas = ndimage.find_objects(labels)

    for name, (x, y, height) in ITEMS.items():
        best, best_distance = None, None
        for index, area in enumerate(areas):
            if sizes[index] < 1500:
                continue
            center_y = (area[0].start + area[0].stop) / 2 / factor_y
            center_x = (area[1].start + area[1].stop) / 2 / factor_x
            distance = (center_x - x) ** 2 + (center_y - y) ** 2
            if best is None or distance < best_distance:
                best, best_distance = index, distance
        area = areas[best]
        alpha = ndimage.gaussian_filter((labels[area] == best + 1).astype(np.float32), 1)
        alpha *= np.clip(1 - (pink[area] - 18) / 26, 0, 1)
        pixels = np.dstack([rgb[area], alpha * 255]).astype(np.uint8)
        sprite = Image.fromarray(pixels, "RGBA")
        icon = sprite.copy()
        icon.thumbnail((128, 128), Image.LANCZOS)
        icon.save(f"{ART}/icon_{name}.webp", quality=88, method=6)
        scale = height / sprite.height
        sprite.resize((max(1, round(sprite.width * scale)), height), Image.LANCZOS).save(
            f"{ART}/item_{name}.webp", quality=88, method=6
        )


# Object boxes in the source sheet, as left, top, right, bottom on a 1100 wide preview.
OBJECT_BOXES = [
    ("oak", 112, 5, 312, 258), ("oak", 383, 18, 568, 262), ("oak", 592, 12, 792, 268), ("oak", 842, 8, 1002, 267),
    ("pine", 92, 268, 268, 592), ("pine", 296, 258, 448, 588), ("pine", 452, 328, 584, 588), ("pine", 586, 362, 698, 588),
    ("bush", 722, 303, 866, 430), ("bush", 894, 300, 1032, 428), ("rock", 712, 460, 882, 585), ("rock", 884, 440, 1052, 598),
]


def objects():
    """The sheet has a pink haze behind the objects: key it out, then keep the main shape."""
    rgb = load("objects2.png")
    factor = rgb.shape[1] / 1100
    target = {"oak": 340, "pine": 360, "bush": 120, "rock": 110}
    sprites = []

    for index, (kind, left, top, right, bottom) in enumerate(OBJECT_BOXES):
        left, top, right, bottom = [round(v * factor) for v in (left, top, right, bottom)]
        area = rgb[top:bottom, left:right]
        red, green, blue = area[..., 0], area[..., 1], area[..., 2]
        pink = np.minimum(red, blue) - green
        solid = (pink < 12) & (blue < green * 1.02)
        if kind == "rock":
            solid = pink < 22
        solid = ndimage.binary_opening(solid, iterations=2)
        labels, found = ndimage.label(solid)
        sizes = ndimage.sum(np.ones_like(labels), labels, range(1, found + 1))
        main = labels == (np.argmax(sizes) + 1)
        main = ndimage.binary_fill_holes(ndimage.binary_closing(main, iterations=3))
        alpha = ndimage.gaussian_filter(ndimage.binary_erosion(main).astype(np.float32), 1.1)
        alpha *= np.clip(1 - (pink - 14) / 22, 0, 1)
        ys, xs = np.where(main)
        box = (ys.min(), ys.max() + 1, xs.min(), xs.max() + 1)
        pixels = np.dstack([area, alpha * 255])[box[0]:box[1], box[2]:box[3]].astype(np.uint8)
        sprite = Image.fromarray(pixels, "RGBA")
        scale = target[kind] / sprite.height
        sprite = sprite.resize((round(sprite.width * scale), round(sprite.height * scale)), Image.LANCZOS)
        name = f"{kind}{index}"
        sprite.save(f"{ART}/{name}.webp", quality=88, method=6)
        sprites.append({"name": name, "kind": kind, "w": sprite.width, "h": sprite.height})
    return sprites


def ground():
    image = Image.open(f"{SOURCE}/ground.png").convert("RGB")
    height = round(image.height * WORLD_W / image.width)
    image = image.resize((WORLD_W, height), Image.LANCZOS)
    image.save(f"{ART}/ground.webp", quality=82, method=6)
    pixels = np.asarray(image.resize((WORLD_W // 8, height // 8), Image.BOX)).astype(np.float32)
    return height, pixels[..., 1] / (pixels[..., 0] + 1)


def place(sprites, height, greenness):
    random.seed(1998)
    spawn = (WORLD_W * 0.6, height * 0.47)
    placed = []

    def free(x, y, gap):
        return all((x - o["x"]) ** 2 + (y - o["y"]) ** 2 >= gap**2 for o in placed)

    def scatter(kinds, count, gap, on_grass):
        choices = [s for s in sprites if s["kind"] in kinds]

        for _ in range(count * 60):
            if not count:
                return
            x, y = random.uniform(40, WORLD_W - 40), random.uniform(70, height - 20)
            if (x - spawn[0]) ** 2 + ((y - spawn[1]) * 1.4) ** 2 < 560**2:
                continue
            if on_grass and greenness[int(y / 8) - 1, int(x / 8) - 1] < 0.86:
                continue
            if not free(x, y, gap):
                continue
            sprite = random.choice(choices)
            scale = random.uniform(0.8, 1.15)
            radius = {"oak": 26, "pine": 22, "rock": 44, "bush": 0}[sprite["kind"]] * scale
            placed.append({"sprite": sprite["name"], "x": round(x), "y": round(y), "scale": round(scale, 2), "radius": round(radius)})
            count -= 1

    scatter({"oak", "pine"}, 72, 130, True)
    scatter({"rock"}, 14, 150, True)
    scatter({"bush"}, 34, 90, True)
    return spawn, placed


sprites = objects()
hero()
items()
height, greenness = ground()
spawn, placed = place(sprites, height, greenness)

with open(f"{REPO}/shared/forest.ts", "w") as out:
    out.write(
        "/* Generated by tools/build_art.py. */\n"
        f"export const WORLD_W = {WORLD_W};\nexport const WORLD_H = {height};\n"
        f"export const SPAWN = {{ x: {round(spawn[0])}, y: {round(spawn[1])} }};\n"
        f"export const SPRITES = {json.dumps(sprites)};\n"
        f"export const OBJECTS = {json.dumps(placed)};\n"
    )
print(height, len(placed))
