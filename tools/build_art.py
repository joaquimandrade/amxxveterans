"""Cuts the painted source sheets into game sprites and places the forest.

Usage: build_art.py SOURCE_DIR REPO_DIR
Sources: ground.png, objects2.png, walk_front.png, walk_back.png,
slash_front.png, slash_back.png.
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
    keep = sorted(np.argsort(sizes)[-count:] + 1, key=lambda l: np.where(labels == l)[1].mean())
    frames = []

    for label in keep:
        ys, xs = np.where(labels == label)
        top, bottom, left, right = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        mask = (labels[top:bottom, left:right] == label) * alpha[top:bottom, left:right]
        lower = ys > top + (bottom - top) * 0.55
        center = float(np.median(xs[lower])) - left
        frames.append((rgb[top:bottom, left:right], mask, center))
    return frames


def hero_sheet(name, out, count, scale):
    sheet = Image.new("RGBA", (CELL_W * count, CELL_H), (0, 0, 0, 0))

    for index, (rgb, mask, center) in enumerate(frames_of(name, count)):
        pixels = np.dstack([rgb, mask * 255]).astype(np.uint8)
        sprite = Image.fromarray(pixels, "RGBA")
        size = (max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale)))
        sprite = sprite.resize(size, Image.LANCZOS)
        sheet.alpha_composite(sprite, (
            max(0, round(CELL_W * index + CELL_W / 2 - center * scale)),
            max(0, FEET_Y - sprite.height),
        ))
    sheet.save(f"{ART}/{out}.webp", quality=88, method=6)


def hero():
    standing = frames_of("walk_front.png", 6)[0][1]
    scale = HERO_HEIGHT / standing.shape[0]

    for name, out, count in (
        ("walk_front.png", "hero_walk_front", 6),
        ("walk_back.png", "hero_walk_back", 6),
        ("slash_front.png", "hero_slash_front", 5),
        ("slash_back.png", "hero_slash_back", 5),
    ):
        hero_sheet(name, out, count, scale)


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
