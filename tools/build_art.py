"""Cuts the painted source sheets into game sprites and lays out the village.

Usage: build_art.py SOURCE_DIR REPO_DIR
Sources: vil/ground.png, vil/objects.png, items.png, walk_front, walk_back,
slash_front and slash_back (each also with an axe_ prefix), and the walk
cycles pw_front, pw_back, pa_front and pa_back. The current hero's sheets live in ju/,
the police in cop/.
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


# Some sheets come back with a blotchy magenta backdrop, so for those the key also drops anything pinkish.
KEY_PINK = False


def hero_alpha(rgb):
    corners = np.concatenate([rgb[:40, :40].reshape(-1, 3), rgb[-40:, -40:].reshape(-1, 3)])
    distance = np.linalg.norm(rgb - np.median(corners, axis=0), axis=2)
    alpha = np.clip((distance - 34) / 34, 0, 1)
    if KEY_PINK:
        pink = np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]
        alpha = np.minimum(alpha, np.clip((50 - pink) / 25, 0, 1))
    return alpha


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


def grid_frames(name, anchor="torso"):
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
        center = float(np.median(xs[torso]))
        if anchor == "body":
            # A rider sits on the back of his mount: centre on the whole figure, like the attack sheets do.
            center = float(np.median(xs[ys > top_y + (bottom_y - top_y) * 0.55]))
        frames.append((rgb[top:bottom, left:right], main * alpha[top:bottom, left:right], center, bottom_y))
    return frames


def walk_sheet(name, out, scale, replace_first, anchor="torso"):
    frames = grid_frames(name, anchor)
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


def single_sheet(frame, out, scale):
    """One-cell sheet (idle pose) from a single frame."""
    rgb, mask, center = frame[:3]
    ys = np.where(mask > 0.5)[0]
    pixels = np.dstack([rgb, mask * 255]).astype(np.uint8)
    sprite = Image.fromarray(pixels, "RGBA")
    sprite = sprite.resize((round(sprite.width * scale), round(sprite.height * scale)), Image.LANCZOS)
    sheet = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    bottom = (ys.max() + 1) * scale
    sheet.paste(sprite, (round(CELL_W / 2 - center * scale), round(FEET_Y - bottom)), sprite)
    sheet.save(f"{ART}/{out}.webp", quality=88, method=6)


def slash_sheet(name, out, standing_height):
    """Scaled so the recovering pose, with the weapon low, matches the walking height."""
    frames = frames_of(name, 5)
    recover = frames[3][1]
    ys = np.where(recover > 0.5)[0]
    scale = standing_height / (ys.max() - ys.min())
    hero_sheet(name, out, 5, scale)


def hero():
    """Julião the shepherd: walks over motion capture, swings his crook, idles."""
    global KEY_PINK
    KEY_PINK = True  # the thin crook picks up a magenta fringe otherwise
    folder = "ju/"
    walk = grid_frames(f"{folder}pw_front.png")[0]
    ys = np.where(walk[1] > 0.5)[0]
    walk_scale = HERO_HEIGHT / (ys.max() - ys.min())

    for walk_prefix, slash_prefix, out in (("pw", "", "hero"),):
        walk_sheet(f"{folder}{walk_prefix}_front.png", f"{out}_walk_front", walk_scale, False)
        walk_sheet(f"{folder}{walk_prefix}_back.png", f"{out}_walk_back", walk_scale, False)
        slash_sheet(f"{folder}{slash_prefix}slash_front.png", f"{out}_slash_front", HERO_HEIGHT)
        # The painted back-facing attacks turned to face the camera, so both directions use the front one.
        slash_sheet(f"{folder}{slash_prefix}slash_front.png", f"{out}_slash_back", HERO_HEIGHT)

    for side, source in (("front", "ref_front"), ("back", "ref_back_idle")):
        reference = frames_of(f"{folder}{source}.png", 1)[0]
        ys = np.where(reference[1] > 0.5)[0]
        single_sheet(reference, f"hero_idle_{side}", HERO_HEIGHT / (ys.max() - ys.min()))
    KEY_PINK = False


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
# Village sheet, read row by row: (kind, height in world pixels, solid radius as a share of the width).
OBJECT_KINDS = [
    ("house", 400, 0.36), ("house", 400, 0.36), ("house", 400, 0.36), ("house", 400, 0.36),
    ("church", 640, 0.34), ("barn", 420, 0.38), ("haystack", 250, 0.34), ("well", 270, 0.16),
    ("cart", 150, 0.3), ("fence", 115, 0.3), ("bush", 70, 0.25), ("tree", 330, 0.1), ("tree", 440, 0.1),
]


def objects():
    """Cuts the village sheet. Fence pickets and haystack poles are separate blobs, so they are grouped first."""
    rgb = load("vil/objects.png")
    pink = np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]
    mask = ndimage.binary_opening(pink < 60, iterations=1)
    groups, found = ndimage.label(ndimage.binary_dilation(mask, iterations=10))
    sizes = ndimage.sum(mask, groups, range(1, found + 1))
    largest = sorted(np.argsort(sizes)[-len(OBJECT_KINDS):] + 1)
    areas = ndimage.find_objects(groups)
    boxes = [(label, areas[label - 1]) for label in largest]
    rows = sorted(boxes, key=lambda b: (b[1][0].start + b[1][0].stop) / 2)
    ordered = []
    for row in (rows[:4], rows[4:8], rows[8:]):
        ordered += sorted(row, key=lambda b: b[1][1].start)
    sprites = []

    for index, (label, area) in enumerate(ordered):
        kind, height, radius = OBJECT_KINDS[index]
        shape = (groups[area] == label) & mask[area]
        alpha = ndimage.gaussian_filter(shape.astype(np.float32), 0.9)
        alpha *= np.clip(1 - (pink[area] - 30) / 40, 0, 1)
        sprite = Image.fromarray(np.dstack([rgb[area], alpha * 255]).astype(np.uint8), "RGBA")
        scale = height / sprite.height
        sprite = sprite.resize((round(sprite.width * scale), height), Image.LANCZOS)
        name = f"village_{kind}{index}"
        sprite.save(f"{ART}/{name}.webp", quality=88, method=6)
        sprites.append({"name": name, "kind": kind, "w": sprite.width, "h": sprite.height, "radius": round(sprite.width * radius)})
    return sprites


ENEMY_HEIGHTS = {"cop": 175, "donkey": 215}


def enemies():
    """Police on foot and on a donkey: walk both ways, one strike reused for both directions, and the donkey's rest."""
    global KEY_PINK
    KEY_PINK = True
    for kind, height in ENEMY_HEIGHTS.items():
        walk = grid_frames(f"cop/{kind}_walk_front.png")[0]
        ys = np.where(walk[1] > 0.5)[0]
        walk_scale = height / (ys.max() - ys.min())
        anchor = "body" if kind == "donkey" else "torso"
        walk_sheet(f"cop/{kind}_walk_front.png", f"enemy_{kind}_walk_front", walk_scale, False, anchor)
        back = grid_frames(f"cop/{kind}_walk_back.png")[0]
        ys = np.where(back[1] > 0.5)[0]
        walk_sheet(f"cop/{kind}_walk_back.png", f"enemy_{kind}_walk_back", height / (ys.max() - ys.min()), False, anchor)
        slash_sheet(f"cop/{kind}_attack.png", f"enemy_{kind}_attack", height)
    # The worn-out rest was repainted over the donkey's attack sheet, so it shares its scale.
    recover = frames_of("cop/donkey_attack.png", 5)[3][1]
    ys = np.where(recover > 0.5)[0]
    hero_sheet("cop/donkey_tired.png", "enemy_donkey_tired", 5, ENEMY_HEIGHTS["donkey"] / (ys.max() - ys.min()))
    KEY_PINK = False


def portrait(name, out, head_share):
    """A square crop around the head of a reference figure, for the arcade health bars."""
    rgb = load(name)
    alpha = hero_alpha(rgb)
    ys, xs = np.where(alpha > 0.5)
    top, bottom = ys.min(), ys.max()
    size = int((bottom - top) * head_share)
    head = xs[ys < top + size * 0.8]
    center = int(np.median(head))
    left = max(0, center - size // 2)
    crop = Image.fromarray(rgb[max(0, top - size // 10):top - size // 10 + size, left:left + size].astype(np.uint8))
    crop.resize((112, 112), Image.LANCZOS).save(f"{ART}/portrait_{out}.webp", quality=90, method=6)


def talk_scene():
    """The painted face-off shown under the dialogue, and the two portraits cut from it."""
    painting = Image.open(f"{SOURCE}/ju/talk.png").convert("RGB")
    painting.resize((1600, round(1600 * painting.height / painting.width)), Image.LANCZOS).save(
        f"{ART}/scene_talk.webp", quality=86, method=6)
    tall = Image.open(f"{SOURCE}/ju/talk_tall.png").convert("RGB")
    tall.resize((900, round(900 * tall.height / tall.width)), Image.LANCZOS).save(
        f"{ART}/scene_talk_tall.webp", quality=86, method=6)
    scale = painting.width / 1100
    half = 62
    # Face centres, measured on an 1100 wide preview of the painting.
    for name, (x, y) in {"donkey": (445, 112), "hero": (770, 192)}.items():
        box = [round(v * scale) for v in (x - half, y - half, x + half, y + half)]
        painting.crop(box).resize((160, 160), Image.LANCZOS).save(f"{ART}/portrait_{name}.webp", quality=90, method=6)


def knife_icon():
    rgb = load("ju/crook.png")
    pink = np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]
    labels, found = ndimage.label(ndimage.binary_opening(pink < 60))
    sizes = ndimage.sum(np.ones_like(labels), labels, range(1, found + 1))
    label = int(np.argmax(sizes)) + 1
    area = ndimage.find_objects(labels)[label - 1]
    alpha = ndimage.gaussian_filter((labels[area] == label).astype(np.float32), 0.8)
    alpha *= np.clip(1 - (pink[area] - 30) / 40, 0, 1)
    icon = Image.fromarray(np.dstack([rgb[area], alpha * 255]).astype(np.uint8), "RGBA")
    icon.thumbnail((128, 128), Image.LANCZOS)
    icon.save(f"{ART}/icon_sword.webp", quality=88, method=6)


# Grass spots of the village ground painting, on its 1100 x 614 preview, where something can stand.
SPOTS = [
    (120, 250), (95, 135), (420, 110), (580, 105), (650, 75), (880, 205), (1050, 95),
    (110, 335), (60, 470), (250, 565), (480, 470), (640, 420), (1040, 470), (900, 600),
]


GRID = 3
# How much of a tile to trim off each edge of the 3 x 3 village; its middle is the crossroads square.
CROP = 0.0


def ground():
    """Mirrors the crossroads into a 3 x 3 grid and keeps the middle, a small village around one square."""
    source = Image.open(f"{SOURCE}/vil/ground.png").convert("RGB")
    tile_w = round(WORLD_W / 3)  # the same scale as the old 3 x 3 village
    tile_h = round(tile_w * source.height / source.width)
    tile = source.resize((tile_w, tile_h), Image.LANCZOS)
    height = tile_h * GRID
    world = Image.new("RGB", (tile_w * GRID, height))
    for column in range(GRID):
        for row in range(GRID):
            piece = tile
            if column % 2:
                piece = piece.transpose(Image.FLIP_LEFT_RIGHT)
            if row % 2:
                piece = piece.transpose(Image.FLIP_TOP_BOTTOM)
            world.paste(piece, (column * tile_w, row * tile_h))
    left, top = round(tile_w * CROP), round(tile_h * CROP)
    world = world.crop((left, top, tile_w * GRID - left, height - top))
    world.save(f"{ART}/ground.webp", quality=80, method=6)
    return world.width, world.height, tile_w, tile_h


def place(sprites, width, height, tile_w, tile_h):
    random.seed(1998)
    # Julião and the policeman start face to face on the square where the four tiles meet.
    spawn = (round(width / 2 + 230), round(height / 2))
    gate = (round(width / 2 - 230), round(height / 2 + 20))
    by_kind = {}
    for sprite in sprites:
        by_kind.setdefault(sprite["kind"], []).append(sprite)
    placed = []

    def add(sprite, x, y, scale=1.0):
        placed.append({
            "sprite": sprite["name"], "x": round(x), "y": round(y), "scale": round(scale, 2),
            "radius": round(sprite["radius"] * scale), "light": False,
        })

    def free(x, y, gap):
        if not (30 < x < width - 30 and 60 < y < height - 10):
            return False
        if (x - width / 2) ** 2 + ((y - height / 2) * 1.5) ** 2 < 640**2:
            return False  # the fighting ground
        return all((x - o["x"]) ** 2 + ((y - o["y"]) * 1.5) ** 2 >= gap**2 for o in placed)

    def spot(column, row, sx, sy):
        x, y = sx / 1100 * tile_w, sy / 614 * tile_h
        if column % 2:
            x = tile_w - x
        if row % 2:
            y = tile_h - y
        return column * tile_w + x - round(tile_w * CROP), row * tile_h + y - round(tile_h * CROP)

    # The church watches the square from behind.
    add(by_kind["church"][0], width / 2 - 120, height / 2 - 440)

    farm = ["house", "house", "barn", "haystack", "haystack", "well", "cart", "tree", "tree", "bush"]
    for column in range(GRID):
        for row in range(GRID):
            for sx, sy in SPOTS:
                if random.random() > 0.45:
                    continue
                x, y = spot(column, row, sx + random.uniform(-25, 25), sy + random.uniform(-20, 20))
                kind = random.choice(farm)
                gap = 230 if kind in ("house", "barn") else 140
                if free(x, y, gap):
                    add(random.choice(by_kind[kind]), x, y, random.uniform(0.92, 1.08))
                    # Each yard gets a fence, a bush or a tree beside it.
                    for extra in random.sample(["fence", "bush", "tree", "tree"], 2):
                        ex = x + random.choice((-1, 1)) * random.uniform(150, 230)
                        ey = y + random.uniform(-40, 70)
                        if free(ex, ey, 90):
                            add(random.choice(by_kind[extra]), ex, ey, random.uniform(0.85, 1.1))
    return spawn, gate, placed


sprites = objects()
hero()
items()
knife_icon()
enemies()
portrait("cop/cop_ref_front.png", "cop", 0.3)
talk_scene()
world_width, height, tile_w, tile_h = ground()
spawn, gate, placed = place(sprites, world_width, height, tile_w, tile_h)

with open(f"{REPO}/shared/forest.ts", "w") as out:
    out.write(
        "/* Generated by tools/build_art.py. */\n"
        f"export const WORLD_W = {world_width};\nexport const WORLD_H = {height};\n"
        f"export const SPAWN = {{ x: {round(spawn[0])}, y: {round(spawn[1])} }};\n"
        f"export const ENEMY_GATE = {{ x: {round(gate[0])}, y: {round(gate[1])} }};\n"
        f"export const SPRITES = {json.dumps(sprites)};\n"
        f"export const OBJECTS = {json.dumps(placed)};\n"
    )
print(height, len(placed))
