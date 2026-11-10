"""Draws stand-in source sheets with the same names and layouts gen_art.py asks Gemini for.

Usage: placeholder_art.py RAW_DIR
They exist so the game and build_art.py can be built and tested before (or without) paying for the painted
sheets. Anything already in RAW_DIR is left alone, so painted sheets always win over stand-ins.
"""
import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAW = sys.argv[1]
MAGENTA = (255, 0, 255)
FONT = next(p for p in (
    "/usr/share/fonts/noto/NotoSans-Bold.ttf", "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
) if os.path.exists(p))
random.seed(7)


def font(size):
    return ImageFont.truetype(FONT, size)


def out(image, name):
    path = f"{RAW}/{name}.png"
    if not os.path.exists(path):
        image.save(path)


# ---------------------------------------------------------------- people
PEOPLE = {
    "moussa": dict(skin=(92, 60, 42), hair=(25, 20, 18), top=(38, 84, 190), legs=(74, 76, 84), shoes=(235, 235, 230)),
    "yasmine": dict(skin=(190, 140, 100), hair=(40, 28, 24), top=(24, 150, 96), legs=(34, 34, 38), shoes=(225, 225, 225)),
    "leo": dict(skin=(232, 190, 160), hair=(20, 20, 22), top=(214, 168, 40), legs=(120, 150, 190), shoes=(30, 30, 34)),
}
H = 520  # standing height of a stand-in figure


def polar(origin, angle, length):
    """A point `length` away from origin; angle 0 points down, positive swings toward the facing side (right)."""
    radians = math.radians(angle)
    return (origin[0] + math.sin(radians) * length, origin[1] + math.cos(radians) * length)


def limb(draw, a, b, width, colour):
    draw.line([a, b], fill=colour, width=width)
    for point in (a, b):
        draw.ellipse([point[0] - width / 2, point[1] - width / 2, point[0] + width / 2, point[1] + width / 2], fill=colour)


def figure(draw, cx, feet, look, back, pose, weapon=None):
    thigh, shin, torso, arm = H * 0.24, H * 0.25, H * 0.31, H * 0.17
    drop = max(math.cos(math.radians(pose["legs"][0][0])) * thigh + math.cos(math.radians(pose["legs"][0][1])) * shin,
               math.cos(math.radians(pose["legs"][1][0])) * thigh + math.cos(math.radians(pose["legs"][1][1])) * shin)
    hip = (cx, feet - drop - 12)
    neck = polar(hip, 180 - pose.get("lean", 0), torso)
    head = polar(neck, 180 - pose.get("lean", 0), H * 0.085)
    shade = tuple(int(c * 0.75) for c in look["top"])
    dark = tuple(int(c * 0.8) for c in look["legs"])

    def leg(index, colour):
        knee = polar(hip, pose["legs"][index][0], thigh)
        foot = polar(knee, pose["legs"][index][1], shin)
        limb(draw, hip, knee, 34, colour)
        limb(draw, knee, foot, 28, colour)
        draw.ellipse([foot[0] - 16, foot[1] - 10, foot[0] + 30, foot[1] + 12], fill=look["shoes"])

    def hand_of(index):
        elbow = polar(neck, pose["arms"][index][0], arm)
        return elbow, polar(elbow, pose["arms"][index][1], arm)

    def do_arm(index, colour):
        elbow, hand = hand_of(index)
        limb(draw, (neck[0], neck[1] + 10), elbow, 26, colour)
        limb(draw, elbow, hand, 22, colour)
        draw.ellipse([hand[0] - 12, hand[1] - 12, hand[0] + 12, hand[1] + 12], fill=look["skin"])

    leg(1, dark)
    do_arm(1, shade)
    leg(0, look["legs"])
    draw.rounded_rectangle([min(hip[0], neck[0]) - 46, neck[1] - 4, max(hip[0], neck[0]) + 46, hip[1] + 14], 26, fill=look["top"])
    radius = H * 0.07
    draw.ellipse([head[0] - radius, head[1] - radius, head[0] + radius, head[1] + radius], fill=look["skin"])
    if back:
        draw.ellipse([head[0] - radius - 2, head[1] - radius - 4, head[0] + radius + 2, head[1] + radius * 0.7], fill=look["hair"])
    else:
        draw.pieslice([head[0] - radius - 2, head[1] - radius - 4, head[0] + radius + 2, head[1] + radius], 180, 360, fill=look["hair"])
        for eye in (6, 22):
            draw.ellipse([head[0] + eye - 4, head[1] + 2, head[0] + eye + 3, head[1] + 9], fill=(20, 16, 14))
    hand = hand_of(0)[1]
    if weapon and pose.get("weapon") is not None:
        angle, kind = pose["weapon"], weapon
        if kind == "bat":
            limb(draw, hand, polar(hand, angle, 150), 14, (176, 128, 74))
        elif kind == "shotgun":
            butt = polar(hand, angle + 180, 60)
            limb(draw, butt, polar(hand, angle, 120), 12, (48, 48, 54))
            limb(draw, butt, polar(butt, angle, 46), 18, (120, 78, 44))
            if pose.get("flash"):
                tip = polar(hand, angle, 150)
                draw.ellipse([tip[0] - 30, tip[1] - 30, tip[0] + 30, tip[1] + 30], fill=(255, 208, 70))
        else:
            draw.rounded_rectangle([hand[0] - 9, hand[1] - 34, hand[0] + 9, hand[1] + 6], 5, fill=(60, 130, 80))
            draw.ellipse([hand[0] - 10, hand[1] - 56, hand[0] + 10, hand[1] - 30], fill=(255, 150, 40))
    do_arm(0, look["top"])


STAND = dict(legs=[(4, 0), (-6, 0)], arms=[(8, 4), (-8, -4)])
WALK = [
    dict(legs=[(28, 10), (-26, -40)], arms=[(-26, -10), (26, 40)]),
    dict(legs=[(2, 0), (10, -50)], arms=[(-4, 4), (4, 12)]),
    dict(legs=[(-26, -40), (28, 10)], arms=[(26, 40), (-26, -10)]),
    dict(legs=[(10, -50), (2, 0)], arms=[(4, 12), (-4, 4)]),
]
WIDE = [(22, 6), (-22, -12)]
ATTACK = {
    "bat": [
        dict(legs=STAND["legs"], arms=[(14, 30), (20, 40)], weapon=20),
        dict(legs=WIDE, arms=[(-60, -140), (-40, -120)], weapon=215, lean=-6),
        dict(legs=WIDE, arms=[(70, 88), (60, 84)], weapon=92, lean=12),
        dict(legs=WIDE, arms=[(40, 120), (30, 110)], weapon=160, lean=6),
    ],
    "molotov": [
        dict(legs=STAND["legs"], arms=[(8, 14), (-8, -4)], weapon=0),
        dict(legs=WIDE, arms=[(-120, -170), (70, 80)], weapon=0, lean=-10),
        dict(legs=WIDE, arms=[(140, 150), (10, 0)], weapon=0, lean=12),
        dict(legs=WIDE, arms=[(80, 88), (-20, -30)], lean=16),
    ],
    "shotgun": [
        dict(legs=STAND["legs"], arms=[(20, 50), (30, 60)], weapon=40),
        dict(legs=WIDE, arms=[(50, 100), (80, 92)], weapon=92),
        dict(legs=WIDE, arms=[(46, 100), (76, 92)], weapon=90, flash=True, lean=-5),
        dict(legs=WIDE, arms=[(50, 110), (70, 100)], weapon=102, lean=-3),
    ],
}


def people():
    for who, look in PEOPLE.items():
        sheet = Image.new("RGB", (1376, 1032), MAGENTA)
        draw = ImageDraw.Draw(sheet)
        figure(draw, 380, 900, look, False, STAND)
        figure(draw, 1000, 900, look, True, STAND)
        out(sheet, f"{who}_ref")
        for side in ("front", "back"):
            rows = {"walk": WALK, **ATTACK}
            for kind, poses in rows.items():
                sheet = Image.new("RGB", (1376, 768), MAGENTA)
                draw = ImageDraw.Draw(sheet)
                for index, pose in enumerate(poses):
                    figure(draw, 344 * index + 150, 700, look, side == "back", pose, None if kind == "walk" else kind)
                out(sheet, f"{who}_{kind}_{side}")


# ---------------------------------------------------------------- objects
def car(draw, box, colour, kind):
    left, top, right, bottom = box
    width, height = right - left, bottom - top
    glass = (150, 190, 205)
    if kind == "scooter":
        draw.ellipse([left, bottom - height * 0.4, left + width * 0.3, bottom], fill=(30, 30, 30))
        draw.ellipse([right - width * 0.3, bottom - height * 0.4, right, bottom], fill=(30, 30, 30))
        draw.rounded_rectangle([left + width * 0.15, top + height * 0.35, right - width * 0.1, bottom - height * 0.2], 18, fill=colour)
        draw.line([left + width * 0.2, top + height * 0.4, left + width * 0.12, top], fill=(60, 60, 60), width=10)
        return
    roof = 0.05 if kind == "van" else 0.22
    draw.rounded_rectangle([left, top + height * 0.42, right, bottom - height * 0.14], 30, fill=colour)
    draw.rounded_rectangle([left + width * (0.3 if kind == "van" else 0.2), top + height * roof, right - width * 0.08, top + height * 0.6], 30, fill=colour)
    if kind != "van":
        draw.rounded_rectangle([left + width * 0.25, top + height * 0.28, right - width * 0.14, top + height * 0.5], 14, fill=glass)
    else:
        draw.rounded_rectangle([left + width * 0.05, top + height * 0.2, left + width * 0.3, top + height * 0.5], 14, fill=glass)
    for x in (left + width * 0.2, right - width * 0.2):
        draw.ellipse([x - height * 0.17, bottom - height * 0.34, x + height * 0.17, bottom], fill=(28, 28, 30))
    if kind == "taxi":
        draw.rectangle([left + width * 0.45, top + height * 0.12, left + width * 0.6, top + height * 0.22], fill=(250, 220, 90))


def shop(draw, box, colour, label):
    left, top, right, bottom = box
    middle = top + (bottom - top) * 0.5
    draw.rectangle([left, top, right, bottom], fill=(226, 212, 184))
    for x in range(3):
        wx = left + (right - left) * (0.12 + 0.29 * x)
        draw.rectangle([wx, top + 40, wx + (right - left) * 0.18, middle - 60], fill=(120, 150, 170))
    draw.rectangle([left, middle - 40, right, middle - 28], fill=(60, 60, 60))
    draw.rectangle([left, middle, right, bottom], fill=colour)
    draw.rectangle([left + 30, middle + 90, right - 30, bottom - 20], fill=(150, 195, 210))
    draw.rectangle([(left + right) / 2 - 50, middle + 90, (left + right) / 2 + 50, bottom], fill=(110, 150, 170))
    draw.text(((left + right) / 2, middle + 46), label, font=font(46), fill=(250, 240, 210), anchor="mm")


def thing(draw, box, name):
    left, top, right, bottom = box
    width, height, cx = right - left, bottom - top, (left + right) / 2
    green, steel, glass = (30, 80, 56), (120, 126, 134), (150, 195, 210)
    if name in ("morris", "kiosk"):
        draw.rounded_rectangle([left, top + height * 0.25, right, bottom], 20, fill=green)
        draw.pieslice([left - 10, top, right + 10, top + height * 0.5], 180, 360, fill=(24, 60, 44))
        draw.rectangle([left + width * 0.15, top + height * 0.4, right - width * 0.15, bottom - height * 0.15], fill=(220, 190, 90))
    elif name in ("shelter", "booth", "panel"):
        draw.rectangle([left, top, right, top + height * 0.12], fill=steel)
        draw.rectangle([left + 8, top + height * 0.12, right - 8, bottom - height * 0.1], fill=glass)
        draw.rectangle([left, bottom - height * 0.1, right, bottom], fill=steel)
    elif name in ("lamp", "light", "meter"):
        draw.rectangle([cx - 10, top + height * 0.2, cx + 10, bottom], fill=(40, 44, 48) if name != "meter" else steel)
        head = (250, 220, 130) if name == "lamp" else (40, 44, 48)
        draw.rounded_rectangle([left + width * 0.15, top, right - width * 0.15, top + height * (0.3 if name != "meter" else 0.6)], 12, fill=head if name != "meter" else steel)
        if name == "light":
            for index, colour in enumerate(((220, 50, 40), (240, 180, 40), (60, 200, 90))):
                draw.ellipse([cx - 12, top + 12 + index * 34, cx + 12, top + 36 + index * 34], fill=colour)
    elif name in ("fountain", "statue"):
        draw.rectangle([left, bottom - height * 0.35, right, bottom], fill=(170, 165, 155))
        draw.rounded_rectangle([cx - width * 0.25, top, cx + width * 0.25, bottom - height * 0.3], 20, fill=green if name == "fountain" else (90, 120, 105))
    elif name == "tree":
        draw.rectangle([cx - 16, top + height * 0.5, cx + 16, bottom], fill=(90, 66, 44))
        draw.ellipse([left, top, right, top + height * 0.7], fill=(200, 140, 50))
    elif name == "terrace":
        draw.polygon([(left, top + height * 0.3), (right, top + height * 0.3), (cx, top)], fill=(236, 226, 200))
        draw.rectangle([cx - 5, top + height * 0.2, cx + 5, bottom], fill=steel)
        draw.ellipse([cx - width * 0.25, bottom - height * 0.4, cx + width * 0.25, bottom - height * 0.25], fill=(230, 230, 226))
        for x in (left + 10, right - 60):
            draw.rounded_rectangle([x, bottom - height * 0.45, x + 50, bottom], 8, fill=(190, 150, 90))
    elif name == "stall":
        draw.rectangle([left, top, right, top + height * 0.25], fill=(200, 60, 50))
        for index in range(3):
            draw.rectangle([left + index * width / 3 + 6, bottom - height * 0.5, left + (index + 1) * width / 3 - 6, bottom], fill=(180, 130, 70))
            draw.ellipse([left + index * width / 3 + 20, bottom - height * 0.62, left + (index + 1) * width / 3 - 20, bottom - height * 0.4], fill=((230, 120, 40), (120, 180, 60), (200, 40, 40))[index])
    elif name == "bikes":
        for index in range(3):
            x = left + index * width * 0.3
            for wheel in (x + 30, x + 110):
                draw.ellipse([wheel - 30, bottom - 60, wheel + 30, bottom], outline=(30, 30, 30), width=8)
            draw.line([x + 30, bottom - 30, x + 70, bottom - 90, x + 110, bottom - 30], fill=(60, 160, 90), width=10)
    elif name == "bench":
        draw.rectangle([left, bottom - height * 0.5, right, bottom - height * 0.35], fill=green)
        draw.rectangle([left, top, right, top + height * 0.3], fill=green)
        for x in (left + 14, right - 26):
            draw.rectangle([x, top, x + 12, bottom], fill=(40, 44, 48))
    elif name == "bins":
        for index in range(3):
            x = left + index * width / 3
            draw.rounded_rectangle([x + 6, top + height * 0.15, x + width / 3 - 6, bottom], 10, fill=(40, 130, 70))
            draw.rectangle([x + 2, top, x + width / 3 - 2, top + height * 0.18], fill=(30, 100, 54))


def wreck(sheet):
    """The same sheet burnt: dark, brown-tinted, scratched, with the magenta backdrop untouched."""
    pixels = sheet.load()
    result = sheet.copy()
    target = result.load()
    for y in range(sheet.height):
        for x in range(sheet.width):
            r, g, b = pixels[x, y]
            if min(r, b) - g < 150:
                grey = (r + g + b) / 3 * 0.34
                noise = random.randint(-14, 14)
                target[x, y] = (int(grey + 26 + noise), int(grey + 14 + noise), int(grey + 8 + noise))
    return result


def grid_sheet(name, cols, rows, items, size=(1376, 768)):
    sheet = Image.new("RGB", size, MAGENTA)
    draw = ImageDraw.Draw(sheet)
    cell_w, cell_h = size[0] / cols, size[1] / rows
    for index, (kind, width, height, *extra) in enumerate(items):
        cx, cy = (index % cols + 0.5) * cell_w, (index // cols + 0.5) * cell_h
        box = (cx - width / 2, cy - height / 2, cx + width / 2, cy + height / 2)
        if name == "vehicles":
            car(draw, box, extra[0], kind)
        elif name.startswith("shops"):
            shop(draw, box, extra[0], kind)
        else:
            thing(draw, box, kind)
    out(sheet, name)
    if not os.path.exists(f"{RAW}/{name}_wreck.png"):
        out(wreck(Image.open(f"{RAW}/{name}.png").convert("RGB")), f"{name}_wreck")


def scenery():
    grid_sheet("vehicles", 3, 2, [
        ("car", 380, 190, (196, 50, 44)), ("car", 400, 180, (176, 180, 186)), ("van", 410, 250, (236, 236, 230)),
        ("taxi", 400, 190, (30, 30, 34)), ("car", 400, 220, (36, 84, 60)), ("scooter", 200, 190, (110, 180, 220)),
    ])
    grid_sheet("street_a", 4, 2, [
        ("morris", 120, 320), ("kiosk", 240, 300), ("shelter", 300, 230), ("booth", 110, 300),
        ("lamp", 80, 340), ("light", 70, 330), ("fountain", 110, 300), ("tree", 300, 350),
    ])
    grid_sheet("street_b", 4, 2, [
        ("terrace", 250, 290), ("stall", 280, 260), ("meter", 64, 240), ("bikes", 300, 130),
        ("bench", 240, 150), ("statue", 170, 340), ("bins", 250, 200), ("panel", 130, 300),
    ])
    grid_sheet("shops_a", 3, 1, [("BOULANGERIE", 400, 500, (36, 54, 110)), ("CAFE DE LA PLACE", 400, 500, (160, 40, 36)), ("PHARMACIE", 400, 500, (40, 130, 80))])
    grid_sheet("shops_b", 3, 1, [("BANQUE", 400, 500, (90, 94, 100)), ("BOUTIQUE", 400, 500, (30, 30, 32)), ("TABAC PRESSE", 400, 500, (120, 36, 48))])

    ground = Image.new("RGB", (1200, 900), (150, 142, 128))
    draw = ImageDraw.Draw(ground)
    for row in range(0, 900, 18):
        for column in range(-18, 1200, 24):
            x = column + (12 if (row // 18) % 2 else 0)
            tone = random.randint(-14, 14)
            draw.rounded_rectangle([x + 1, row + 1, x + 22, row + 16], 4, fill=(146 + tone, 138 + tone, 126 + tone))
    draw.ellipse([420, 300, 780, 660], outline=(196, 186, 164), width=14)
    draw.rectangle([0, 800, 1200, 900], fill=(64, 64, 70))
    for x in range(40, 1200, 190):
        for stripe in range(5):
            draw.rectangle([x + stripe * 22, 810, x + stripe * 22 + 12, 890], fill=(214, 214, 206))
    draw.rectangle([0, 210, 1200, 262], fill=(200, 190, 170))
    out(ground.filter(ImageFilter.GaussianBlur(0.6)).resize((2400, 1800), Image.BICUBIC), "ground")

    title = Image.new("RGB", (900, 1200))
    draw = ImageDraw.Draw(title)
    for y in range(1200):
        t = y / 1200
        draw.line([0, y, 900, y], fill=(int(40 + 190 * t), int(34 + 80 * t), int(86 - 30 * t)))
    for index in range(8):
        x, height = index * 120 - 20, random.randint(420, 620)
        draw.rectangle([x, 1200 - height, x + 112, 1200], fill=(28, 22, 34))
        for wy in range(1200 - height + 30, 1150, 60):
            for wx in range(x + 14, x + 100, 34):
                if random.random() < 0.5:
                    draw.rectangle([wx, wy, wx + 16, wy + 30], fill=(250, 190, 90))
    out(title, "title_bg")

    logo = Image.new("RGB", (1376, 768), MAGENTA)
    draw = ImageDraw.Draw(logo)
    draw.text((688, 270), "FRENCH", font=font(210), fill=(244, 236, 220), anchor="mm")
    draw.text((688, 480), "REBELLION", font=font(190), fill=(244, 236, 220), anchor="mm")
    draw.rectangle([180, 610, 1196, 640], fill=(200, 40, 40))
    out(logo, "logo")

    icons = Image.new("RGB", (1584, 672), MAGENTA)
    draw = ImageDraw.Draw(icons)
    draw.rounded_rectangle([214, 220, 314, 520], 30, fill=(60, 130, 80))
    draw.rectangle([244, 150, 284, 230], fill=(60, 130, 80))
    draw.ellipse([224, 60, 304, 170], fill=(255, 150, 40))
    limb(draw, (640, 520), (940, 150), 50, (176, 128, 74))
    limb(draw, (1130, 470), (1480, 200), 30, (48, 48, 54))
    limb(draw, (1100, 500), (1220, 410), 50, (120, 78, 44))
    out(icons, "icons")


if __name__ == "__main__":
    os.makedirs(RAW, exist_ok=True)
    people()
    scenery()
