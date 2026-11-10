"""Cuts the painted source sheets (see gen_art.py) into the sprites French Rebellion loads.

Usage: build_art.py RAW_DIR REPO_DIR [--check OUT_DIR]

Every sheet is painted on flat magenta. Character sheets are one row of 4 frames; this script keys them,
splits the frames and normalises them so that a character has the same body size in every frame of every
sheet: all sheets are scaled so the upright body is HERO_H pixels tall, feet sit on one baseline and the
hips sit on the cell centre. --check writes contact sheets to look at before committing.
"""
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

RAW, REPO = sys.argv[1], sys.argv[2]
CHECK = sys.argv[4] if len(sys.argv) > 4 and sys.argv[3] == "--check" else None
ART = f"{REPO}/client/public/art"

CELL_W, CELL_H, FEET_Y, HERO_H = 480, 420, 392, 264
PX_PER_UNIT = 2  # sprite pixels per world unit
CHARACTERS = ["moussa", "yasmine", "leo"]
WEAPONS = ["bat", "molotov", "shotgun"]

# Sheets that came back facing left instead of right get mirrored here, after looking at the contact sheets.
MIRROR: set[str] = set()
# Per-frame size corrections for sheets where one frame was painted bigger or smaller, e.g. {"leo_bat_back": [1, 1.06, 1, 1]}.
FRAME_SCALE: dict[str, list[float]] = {}
# Which frame of an attack sheet stands upright (the scale reference); frame 0 unless noted.
UPRIGHT: dict[str, int] = {}

# name: (sheet, column, row, world width)
OBJECTS = {
    "hatch": ("vehicles", 0, 0, 250), "saloon": ("vehicles", 1, 0, 290), "van": ("vehicles", 2, 0, 320),
    "taxi": ("vehicles", 0, 1, 290), "suv": ("vehicles", 1, 1, 290), "scooter": ("vehicles", 2, 1, 130),
    "morris": ("street_a", 0, 0, 105), "kiosk": ("street_a", 1, 0, 210), "shelter": ("street_a", 2, 0, 260),
    "booth": ("street_a", 3, 0, 100), "lamp": ("street_a", 0, 1, 80), "light": ("street_a", 1, 1, 70),
    "fountain": ("street_a", 2, 1, 95), "tree": ("street_a", 3, 1, 280),
    "terrace": ("street_b", 0, 0, 210), "stall": ("street_b", 1, 0, 240), "meter": ("street_b", 2, 0, 62),
    "bikes": ("street_b", 3, 0, 230), "bench": ("street_b", 0, 1, 180), "statue": ("street_b", 1, 1, 150),
    "bins": ("street_b", 2, 1, 200), "panel": ("street_b", 3, 1, 115),
    "boulangerie": ("shops_a", 0, 0, 400), "cafe": ("shops_a", 1, 0, 400), "pharmacie": ("shops_a", 2, 0, 400),
    "banque": ("shops_b", 0, 0, 400), "boutique": ("shops_b", 1, 0, 400), "tabac": ("shops_b", 2, 0, 400),
}
GRIDS = {"vehicles": (3, 2), "street_a": (4, 2), "street_b": (4, 2), "shops_a": (3, 1), "shops_b": (3, 1)}


def keyed(name, size=None):
    """Loads a sheet and returns (rgb, alpha), with the magenta backdrop removed and its spill cleaned off the edges."""
    image = Image.open(f"{RAW}/{name}.png").convert("RGB")
    if size and image.size != size:
        image = image.resize(size, Image.LANCZOS)
    rgb = np.asarray(image).astype(np.float32)
    magenta = np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]
    alpha = np.clip((150 - magenta) / 90, 0, 1)
    edge = (alpha > 0) & (alpha < 1)
    safe = np.maximum(alpha, 0.15)[..., None]
    clean = np.clip((rgb - (1 - safe) * np.array([255, 0, 255], np.float32)) / safe, 0, 255)
    rgb = np.where(edge[..., None], clean, rgb)
    # Whatever pink is left on soft edges: pull red and blue down to green.
    spill = np.clip(np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1] - 25, 0, None) * (alpha < 1)
    rgb[..., 0] -= spill
    rgb[..., 2] -= spill
    return rgb, alpha


def sprite(rgb, alpha):
    return Image.fromarray(np.dstack([rgb, alpha * 255]).clip(0, 255).astype(np.uint8), "RGBA")


def save(image, name, quality=84):
    image.save(f"{ART}/{name}.webp", quality=quality, method=6)


def split_columns(alpha, count):
    """Cuts a row of figures at the emptiest column near each equal division."""
    solid = alpha > 0.5
    mass = solid.sum(axis=0)
    width = alpha.shape[1]
    edges = [0]
    for index in range(1, count):
        middle = index * width // count
        low, high = middle - width // (count * 4), middle + width // (count * 4)
        window = mass[low:high]
        empty = np.where(window == window.min())[0]
        edges.append(low + int(empty[len(empty) // 2]))
    return edges + [width]


def figure_frames(name, count=4):
    """Returns per frame: rgb, mask, feet row, top row and hips column (all in frame coordinates)."""
    rgb, alpha = keyed(name)
    edges = split_columns(alpha, count)
    frames = []
    for index in range(count):
        left, right = edges[index], edges[index + 1]
        part = alpha[:, left:right]
        labels, found = ndimage.label(ndimage.binary_closing(part > 0.5, iterations=3))
        sizes = np.bincount(labels.ravel())
        sizes[0] = 0
        body = labels == sizes.argmax()
        # Keep what belongs to the figure (a muzzle flash, a wick flame) but not strays from the neighbours.
        keep = np.isin(labels, [l for l in range(1, found + 1) if sizes[l] > sizes.max() * 0.004])
        ys, xs = np.where(body)
        top, feet = ys.min(), ys.max() + 1
        frames.append(dict(rgb=rgb[:, left:right], mask=part * keep, body=body, top=top, feet=feet))
    if name in MIRROR:
        for frame in frames:
            for key in ("rgb", "mask", "body"):
                frame[key] = frame[key][:, ::-1]
    return frames


def hips(frame, standing):
    """Median column of the body between 40% and 58% of the standing height above the feet."""
    low, high = frame["feet"] - int(standing * 0.58), frame["feet"] - int(standing * 0.40)
    xs = np.where(frame["body"][max(low, 0):high])[1]
    return float(np.median(xs)) if len(xs) else frame["body"].shape[1] / 2


def head_width(frame, standing):
    rows = frame["body"][frame["top"]:frame["top"] + int(standing * 0.11)]
    return int(rows.any(axis=0).sum())


def place(frames, scales, standing_heights, out, report):
    sheet = Image.new("RGBA", (CELL_W * len(frames), CELL_H), (0, 0, 0, 0))
    for index, (frame, scale, standing) in enumerate(zip(frames, scales, standing_heights)):
        ys, xs = np.where(frame["mask"] > 0.02)
        left, right, top = xs.min(), xs.max() + 1, ys.min()
        cut = sprite(frame["rgb"][top:frame["feet"], left:right], frame["mask"][top:frame["feet"], left:right])
        size = (max(1, round(cut.width * scale)), max(1, round(cut.height * scale)))
        cut = cut.resize(size, Image.LANCZOS)
        x = round(CELL_W * index + CELL_W / 2 - (hips(frame, standing) - left) * scale)
        # Paste clipped to the cell so a long weapon never leaks into the next frame.
        layer = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
        layer.paste(cut, (x, FEET_Y - cut.height))
        box = (CELL_W * index, 0, CELL_W * (index + 1), CELL_H)
        sheet.alpha_composite(layer.crop(box), (CELL_W * index, 0))
        if x < box[0] or x + cut.width > box[2] or FEET_Y - cut.height < 0:
            report.append(f"  {out} frame {index}: clipped by the cell")
    save(sheet, out)
    return sheet


def character(who, report):
    sheets = {}
    # Idle frames and the scale reference come from the two standing views of the reference sheet.
    for side, frame in zip(("front", "back"), figure_frames(f"{who}_ref", 2)):
        height = frame["feet"] - frame["top"]
        sheets[f"idle_{side}"] = place([frame], [HERO_H / height], [height], f"{who}_idle_{side}", report)
        if side == "front":
            # Portrait for the character select screen: the whole standing figure, larger.
            ys, xs = np.where(frame["mask"] > 0.02)
            cut = sprite(frame["rgb"][ys.min():ys.max() + 1, xs.min():xs.max() + 1],
                         frame["mask"][ys.min():ys.max() + 1, xs.min():xs.max() + 1])
            cut.thumbnail((520, 760), Image.LANCZOS)
            save(cut, f"{who}_portrait", 88)

    for side in ("front", "back"):
        name = f"{who}_walk_{side}"
        frames = figure_frames(name)
        fix = FRAME_SCALE.get(name, [1] * 4)
        # Every walk frame is brought to the same height: no size jumps, whatever the painter did.
        heights = [(f["feet"] - f["top"]) for f in frames]
        scales = [HERO_H * 0.985 / h * k for h, k in zip(heights, fix)]
        report.append(f"{name}: heights {heights} head widths {[head_width(f, h) for f, h in zip(frames, heights)]}")
        sheets[f"walk_{side}"] = place(frames, scales, heights, name, report)

        for weapon in WEAPONS:
            name = f"{who}_{weapon}_{side}"
            frames = figure_frames(name)
            fix = FRAME_SCALE.get(name, [1] * 4)
            upright = frames[UPRIGHT.get(name, 0)]
            standing = upright["feet"] - upright["top"]
            # One scale for the whole sheet, taken from the upright frame, so the body keeps its size while the pose changes.
            scales = [HERO_H / standing * k for k in fix]
            widths = [head_width(f, standing) for f in frames]
            report.append(f"{name}: standing {standing} head widths {widths}")
            sheets[f"{weapon}_{side}"] = place(frames, scales, [standing] * 4, name, report)
    return sheets


def contact_sheet(who, sheets):
    """All frames of a character on one page with head and feet guide lines, to check sizes by eye."""
    order = [f"{kind}_{side}" for side in ("front", "back") for kind in ["idle", "walk"] + WEAPONS]
    page = Image.new("RGBA", (CELL_W * 4, CELL_H * len(order)), (70, 70, 80, 255))
    for row, key in enumerate(order):
        page.alpha_composite(sheets[key], (0, row * CELL_H))
        pixels = page.load()
        for x in range(page.width):
            pixels[x, row * CELL_H + FEET_Y] = (255, 255, 0, 255)
            pixels[x, row * CELL_H + FEET_Y - HERO_H] = (0, 255, 255, 255)
    page.convert("RGB").save(f"{CHECK}/check_{who}.jpg", quality=85)


def cell_sprite(rgb, alpha, grid, column, row):
    """The object painted in one grid cell: every blob whose centre falls in the cell."""
    cols, rows = grid
    height, width = alpha.shape
    labels, found = ndimage.label(alpha > 0.5)
    if not found:
        raise SystemExit("empty sheet")
    sizes = np.bincount(labels.ravel())
    centres = ndimage.center_of_mass(alpha > 0.5, labels, range(1, found + 1))
    mine = [
        index + 1 for index, (cy, cx) in enumerate(centres)
        if sizes[index + 1] > 150 and int(cx * cols / width) == column and int(cy * rows / height) == row
    ]
    mask = np.isin(labels, mine)
    ys, xs = np.where(mask)
    box = (ys.min(), ys.max() + 1, xs.min(), xs.max() + 1)
    return box, mask


def objects(manifest):
    cache = {}
    for name, (sheet, column, row, world_width) in OBJECTS.items():
        if sheet not in cache:
            intact = keyed(sheet)
            size = (intact[0].shape[1], intact[0].shape[0])
            cache[sheet] = (intact, keyed(f"{sheet}_wreck", size))
        entry = {}
        scale = None
        for suffix, (rgb, alpha) in zip(("", "_wreck"), cache[sheet]):
            (top, bottom, left, right), mask = cell_sprite(rgb, alpha, GRIDS[sheet], column, row)
            cut = sprite(rgb[top:bottom, left:right], (alpha * mask)[top:bottom, left:right])
            # The wreck keeps the scale of the intact sprite so the two line up when cross-faded.
            scale = scale or world_width * PX_PER_UNIT / cut.width
            cut = cut.resize((max(1, round(cut.width * scale)), max(1, round(cut.height * scale))), Image.LANCZOS)
            save(cut, f"obj_{name}{suffix}")
            entry["wreck" if suffix else "size"] = [cut.width, cut.height]
        manifest["objects"][name] = entry


def extras(manifest):
    ground = Image.open(f"{RAW}/ground.png").convert("RGB").resize((2400, 1800), Image.LANCZOS)
    ground.save(f"{ART}/ground.webp", quality=80, method=6)
    title = Image.open(f"{RAW}/title_bg.png").convert("RGB")
    title.thumbnail((1400, 1900), Image.LANCZOS)
    title.save(f"{ART}/title_bg.webp", quality=82, method=6)

    rgb, alpha = keyed("logo")
    ys, xs = np.where(alpha > 0.5)
    logo = sprite(rgb[ys.min():ys.max() + 1, xs.min():xs.max() + 1], alpha[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
    logo.thumbnail((1100, 700), Image.LANCZOS)
    save(logo, "logo", 90)

    rgb, alpha = keyed("icons")
    for column, weapon in enumerate(["molotov", "bat", "shotgun"]):
        (top, bottom, left, right), mask = cell_sprite(rgb, alpha, (3, 1), column, 0)
        icon = sprite(rgb[top:bottom, left:right], (alpha * mask)[top:bottom, left:right])
        icon.thumbnail((176, 176), Image.LANCZOS)
        square = Image.new("RGBA", (192, 192), (0, 0, 0, 0))
        square.alpha_composite(icon, ((192 - icon.width) // 2, (192 - icon.height) // 2))
        save(square, f"icon_{weapon}", 90)


if __name__ == "__main__":
    report = []
    manifest = {"cell": [CELL_W, CELL_H], "feet": FEET_Y, "hero": HERO_H, "px": PX_PER_UNIT, "objects": {}}
    for who in CHARACTERS:
        sheets = character(who, report)
        if CHECK:
            contact_sheet(who, sheets)
    objects(manifest)
    extras(manifest)
    with open(f"{REPO}/client/src/manifest.json", "w") as handle:
        json.dump(manifest, handle, indent=1)
    print("\n".join(report))
