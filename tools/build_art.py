"""Cuts the painted source sheets into game sprites and places the city.

Usage: build_art.py SOURCE_DIR REPO_DIR
Sources: city/ground.png, city/objects.png, items.png, walk_front, walk_back,
slash_front and slash_back (each also with an axe_ prefix), and the walk
cycles pw_front, pw_back, pa_front and pa_back.
"""
import json
import math
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


# Order follows the sheet: name, drawn height, collision radius as a share of the width.
OBJECT_KINDS = [
    ("house", 480, 0.4), ("house", 500, 0.4), ("house", 480, 0.4), ("house", 500, 0.4),
    ("tower", 590, 0.42), ("chapel", 500, 0.42), ("gate", 430, 0.42), ("tenement", 500, 0.42),
    ("lamp", 235, 0), ("lamp", 235, 0), ("well", 130, 0.32), ("crates", 118, 0.34),
]


def objects():
    rgb = load("city/objects.png")
    pink = np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]
    mask = ndimage.binary_opening(pink < 60, iterations=1)
    labels, found = ndimage.label(mask)
    sizes = ndimage.sum(np.ones_like(labels), labels, range(1, found + 1))
    largest = sorted(np.argsort(sizes)[-12:] + 1)
    areas = ndimage.find_objects(labels)
    boxes = [(label, areas[label - 1]) for label in largest]
    rows = sorted(boxes, key=lambda b: (b[1][0].start + b[1][0].stop) / 2)
    ordered = []
    for row in (rows[:4], rows[4:8], rows[8:]):
        ordered += sorted(row, key=lambda b: b[1][1].start)
    sprites = []

    for index, (label, area) in enumerate(ordered):
        kind, height, radius = OBJECT_KINDS[index]
        alpha = ndimage.gaussian_filter((labels[area] == label).astype(np.float32), 0.9)
        alpha *= np.clip(1 - (pink[area] - 30) / 40, 0, 1)
        sprite = Image.fromarray(np.dstack([rgb[area], alpha * 255]).astype(np.uint8), "RGBA")
        scale = height / sprite.height
        sprite = sprite.resize((round(sprite.width * scale), height), Image.LANCZOS)
        name = f"city_{kind}{index}"
        sprite.save(f"{ART}/{name}.webp", quality=88, method=6)
        sprites.append({"name": name, "kind": kind, "w": sprite.width, "h": sprite.height, "radius": round(sprite.width * radius)})
    return sprites


def mansion():
    rgb = load("city/mansion.png")
    pink = np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]
    labels, found = ndimage.label(ndimage.binary_opening(pink < 60))
    sizes = ndimage.sum(np.ones_like(labels), labels, range(1, found + 1))
    label = int(np.argmax(sizes)) + 1
    area = ndimage.find_objects(labels)[label - 1]
    alpha = ndimage.gaussian_filter((labels[area] == label).astype(np.float32), 0.9)
    alpha *= np.clip(1 - (pink[area] - 30) / 40, 0, 1)
    sprite = Image.fromarray(np.dstack([rgb[area], alpha * 255]).astype(np.uint8), "RGBA")
    scale = 640 / sprite.height
    sprite.resize((round(sprite.width * scale), 640), Image.LANCZOS).save(f"{ART}/mansion.webp", quality=88, method=6)


def woman():
    rgb = load("city/woman.png")
    pink = np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]
    labels, found = ndimage.label(ndimage.binary_opening(pink < 70))
    sizes = ndimage.sum(np.ones_like(labels), labels, range(1, found + 1))
    label = int(np.argmax(sizes)) + 1
    area = ndimage.find_objects(labels)[label - 1]
    alpha = ndimage.gaussian_filter((labels[area] == label).astype(np.float32), 0.8)
    alpha *= np.clip(1 - (pink[area] - 40) / 45, 0, 1)
    sprite = Image.fromarray(np.dstack([rgb[area], alpha * 255]).astype(np.uint8), "RGBA")
    scale = 170 / sprite.height
    sprite.resize((round(sprite.width * scale), 170), Image.LANCZOS).save(f"{ART}/npc_woman.webp", quality=90, method=6)


def ground():
    """Mirrors the street corner into a grid, so the sidewalks form city blocks."""
    source = Image.open(f"{SOURCE}/city/ground.png").convert("RGB")
    tile_w = round(WORLD_W / 3)
    tile_h = round(tile_w * source.height / source.width)
    tile = source.resize((tile_w, tile_h), Image.LANCZOS)
    height = tile_h * 3
    world = Image.new("RGB", (tile_w * 3, height))
    for column in range(3):
        for row in range(3):
            piece = tile
            if column % 2:
                piece = piece.transpose(Image.FLIP_LEFT_RIGHT)
            if row % 2:
                piece = piece.transpose(Image.FLIP_TOP_BOTTOM)
            world.paste(piece, (column * tile_w, row * tile_h))
    world.save(f"{ART}/ground.webp", quality=80, method=6)
    for room in ("hall", "upper"):
        painting = Image.open(f"{SOURCE}/city/{room}.png").convert("RGB").resize((1430, 798), Image.LANCZOS)
        pixels = np.asarray(painting).astype(np.float32)
        # The hall sits on flat grey. The upper room's backdrop is nearly as dark as
        # its walls, so keying it would eat into the painting.
        if room == "hall":
            backdrop = np.linalg.norm(pixels - pixels[4, 4], axis=2) < 26
            labels, _ = ndimage.label(backdrop)
            outside = labels == labels[4, 4]
            pixels[ndimage.binary_dilation(outside, iterations=2)] = (10, 10, 16)
        Image.fromarray(pixels.astype(np.uint8)).save(f"{ART}/room_{room}.webp", quality=84, method=6)
    return tile_w * 3, height, tile_w, tile_h


def place(sprites, width, height, tile_w, tile_h):
    random.seed(1998)
    spawn = (width // 2, height // 2)
    keep_clear = [(200, -30), (-170, 70), (520, 240), (70, 210), (-420, -130)]
    buildings = [s for s in sprites if s["kind"] in ("house", "tenement", "tower", "chapel", "gate")]
    placed = []

    def add(sprite, x, y, scale=1.0):
        placed.append({
            "sprite": sprite["name"], "x": round(x), "y": round(y), "scale": round(scale, 2),
            "radius": round(sprite["radius"] * scale), "light": sprite["kind"] == "lamp",
        })

    def free(x, y, gap):
        if not (30 < x < width - 30 and 60 < y < height - 10):
            return False
        if any((x - spawn[0] - dx) ** 2 + (y - spawn[1] - dy) ** 2 < 120**2 for dx, dy in keep_clear):
            return False
        if (x - spawn[0] - 60) ** 2 + ((y - spawn[1] + 330) * 1.3) ** 2 < 470**2:
            return False  # the mansion's plot
        return all((x - o["x"]) ** 2 + ((y - o["y"]) * 1.5) ** 2 >= gap**2 for o in placed)

    # City blocks sit on the sidewalks where four mirrored tiles meet.
    for column in range(4):
        for row in range(4):
            cx, cy = column * tile_w, row * tile_h
            for _ in range(36):
                angle = random.uniform(0, 6.283)
                distance = random.uniform(0, 290)
                x, y = cx + math.cos(angle) * distance, cy + math.sin(angle) * distance * 0.62
                if free(x, y, 165):
                    add(random.choice(buildings), x, y, random.uniform(0.9, 1.1))

    lamps = [s for s in sprites if s["kind"] == "lamp"]
    props = [s for s in sprites if s["kind"] in ("well", "crates")]

    # Lamps ring each street crossing; props sit along the kerbs.
    for column in range(3):
        for row in range(3):
            cx, cy = (column + 0.5) * tile_w, (row + 0.5) * tile_h
            for spot in range(5):
                angle = spot / 5 * 6.283 + 0.4
                x, y = cx + math.cos(angle) * tile_w * 0.3, cy + math.sin(angle) * tile_h * 0.33
                if free(x, y, 90):
                    add(random.choice(lamps), x, y)
            for _ in range(2):
                x, y = cx + random.uniform(-420, 420), cy + random.uniform(-260, 260)
                if free(x, y, 120):
                    add(random.choice(props), x, y)
    return spawn, placed


sprites = objects()
mansion()
woman()
hero()
items()
world_width, height, tile_w, tile_h = ground()
spawn, placed = place(sprites, world_width, height, tile_w, tile_h)

with open(f"{REPO}/shared/forest.ts", "w") as out:
    out.write(
        "/* Generated by tools/build_art.py. */\n"
        f"export const WORLD_W = {world_width};\nexport const WORLD_H = {height};\n"
        f"export const SPAWN = {{ x: {round(spawn[0])}, y: {round(spawn[1])} }};\n"
        f"export const SPRITES = {json.dumps(sprites)};\n"
        f"export const OBJECTS = {json.dumps(placed)};\n"
    )
print(height, len(placed))
