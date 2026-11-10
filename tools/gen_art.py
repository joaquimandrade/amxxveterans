"""Paints the source sheets for French Rebellion with Gemini 3 Pro Image through OpenRouter.

Usage: gen_art.py RAW_DIR JOB [JOB ...]     (a JOB may be a prefix ending in *)
The API key is read at run time from ~/repositorios/harness/main.py and never stored.
Finished images are skipped, and every paid call is appended to RAW_DIR/ledger.jsonl.
"""
import base64
import json
import os
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

import requests

RAW = sys.argv[1]
MODEL = "google/gemini-3-pro-image-preview"
LOCK = threading.Lock()


def api_key():
    source = open(os.path.expanduser("~/repositorios/harness/main.py")).read()
    return re.search(r'KEY\s*=\s*"([^"]+)"', source).group(1)


STYLE = (
    "Style: hand-painted gouache and oil game illustration with visible confident brushstrokes, rich natural "
    "colours, soft warm late-afternoon light coming from the upper left, painterly but crisp silhouettes, "
    "no black outlines, no text captions, no labels, no frames, no borders."
)
PEOPLE = (
    "Realistic adult proportions (about 7.5 heads tall), natural and dignified, a real believable young "
    "person, NOT a caricature, not chibi, not cartoonish."
)
KEY_BG = (
    "Background: one perfectly flat uniform pure magenta (#FF00FF) filling the whole image. No ground, "
    "no floor, no cast shadows on the background, no gradients, no vignette."
)
CAMERA = "Camera slightly above eye level looking down about 30 degrees, like an isometric video game."

CHARACTERS = {
    "moussa": (
        "Moussa, a 22-year-old Black man of West African (Senegalese-French) descent, dark brown skin, short "
        "twisted hair with a clean fade, calm confident face, athletic build. He wears a cobalt-blue puffer "
        "jacket open over a white t-shirt, charcoal-grey jogging trousers and clean white sneakers."
    ),
    "yasmine": (
        "Yasmine, a 21-year-old North African (Algerian-French) woman, olive-tan skin, long dark curly hair "
        "tied in a high ponytail, determined intelligent face, slim athletic build. She wears an emerald-green "
        "zipped track jacket with white stripes on the sleeves, black cargo trousers and chunky white-and-grey "
        "sneakers, small gold hoop earrings."
    ),
    "leo": (
        "Leo, a 23-year-old white French man, fair skin, light stubble, messy brown hair under a black beanie, "
        "relaxed focused face, lean build. He wears an oversized mustard-yellow hoodie, loose light-wash "
        "blue jeans and black skate shoes."
    ),
}

FRONT = (
    "three-quarter FRONT view: the character faces the camera, and the body and the whole action are directed "
    "toward the lower-right of the picture (toward the viewer and to the viewer's right). We clearly see the face"
)
BACK = (
    "three-quarter BACK view: the character is seen from behind and faces AWAY from the camera; the body and "
    "the whole action are directed toward the upper-right of the picture (away from the viewer and to the "
    "viewer's right). We see the back of the head and the back of the jacket; the face is hidden or barely visible. The camera stays BEHIND "
    "the character in every single frame, including the first frame and the wind-up: never show the chest or the "
    "front of the face, and the character never turns round toward the viewer. Exactly one weapon per frame"
)

SHEET = (
    "Using the attached character reference (the SAME person: same face, hair, clothes, colours and the same "
    "painting style), paint a game sprite sheet: ONE horizontal row of exactly 4 full-body frames in 4 equal "
    "columns, evenly spaced, with clear empty magenta gaps between the figures. The character is drawn at "
    "EXACTLY the same scale in all 4 frames: same head size, same body height, same leg length, feet on the "
    "same baseline. Nothing is cropped: the whole body and everything held fits inside its column. "
    "View for ALL 4 frames: {view}. {camera}\n{frames}\n{people} {style}\n{bg}"
)

WALK = (
    "The 4 frames are a walking cycle, hands empty:\n"
    "1) contact pose: RIGHT leg forward with the heel touching down, left leg stretched behind, left arm swung forward;\n"
    "2) passing pose: upright, weight on the right leg, the left leg bent and passing under the body, arms close to the sides;\n"
    "3) contact pose: LEFT leg forward with the heel touching down, right leg stretched behind, right arm swung forward;\n"
    "4) passing pose: upright, weight on the left leg, the right leg bent and passing under the body, arms close to the sides."
)
ATTACKS = {
    "bat": (
        "The 4 frames show one swing of a wooden baseball bat held in both hands, always aimed in the view direction:\n"
        "1) standing fully upright and relaxed, the bat held low in both hands pointing at the ground;\n"
        "2) wind-up: the bat raised back over the rear shoulder, torso twisted;\n"
        "3) strike: the bat swung horizontally at full arm extension toward the view direction, front foot planted;\n"
        "4) follow-through: the bat carried past and across the body, torso twisted the other way."
    ),
    "molotov": (
        "The 4 frames show the throw of a glass bottle with a small burning cloth wick, always thrown in the view direction:\n"
        "1) standing fully upright and relaxed, holding the lit bottle low by the side in the right hand;\n"
        "2) wind-up: the right arm drawn far back and up behind the head holding the bottle, the left arm pointing toward the view direction;\n"
        "3) throw: the right arm whipping forward and up, the bottle still in the hand at the release point, body leaning into the throw;\n"
        "4) follow-through: the right arm fully extended toward the view direction with an EMPTY open hand (the bottle is gone, do not draw it), body leaning forward."
    ),
    "shotgun": (
        "The 4 frames show one shot of a pump-action shotgun with a wooden stock, always aimed in the view direction:\n"
        "1) standing fully upright and relaxed, the shotgun held low across the body in both hands, muzzle pointing at the ground;\n"
        "2) aiming: the shotgun shouldered and pointed toward the view direction, knees slightly bent;\n"
        "3) firing: same aim, a bright yellow-orange muzzle flash at the end of the barrel, shoulders pushed back by the recoil;\n"
        "4) recovering: the barrel lifted a little by the recoil, the front hand pulling the pump back, a wisp of smoke.\n"
        "The muzzle flash is small and stays well clear of the next figure: there is always empty background between two figures."
    ),
}

GRID = (
    "Arrange them in a strict grid of {cols} columns by {rows} rows, one object centred in each cell, with wide "
    "empty magenta gaps between objects; objects never touch or overlap each other or the image edges. "
)
OBJECT_VIEW = (
    "Every object is a separate game sprite seen from a high three-quarter angle (camera about 35 degrees above "
    "the horizon, like an isometric city game), complete and uncropped, with its base on the ground. "
)

JOBS = {}


def job(name, prompt, aspect="16:9", size="2K", refs=()):
    JOBS[name] = dict(prompt=prompt, aspect=aspect, size=size, refs=list(refs))


for who, description in CHARACTERS.items():
    job(
        f"{who}_ref",
        "Character reference sheet for a video game: two full-body views of the SAME person standing side by "
        "side, evenly spaced, same scale, feet on the same baseline. LEFT figure: three-quarter FRONT view, "
        "facing the camera, body turned slightly toward the viewer's right. RIGHT figure: three-quarter BACK "
        "view, seen from behind, facing away from the camera, body turned slightly toward the viewer's right. "
        "Relaxed neutral standing pose, arms by the sides, empty hands, whole body visible from head to shoes. "
        f"{CAMERA}\nCharacter: {description}\n{PEOPLE} {STYLE}\n{KEY_BG}",
        aspect="4:3",
    )
    for side, view in (("front", FRONT), ("back", BACK)):
        job(
            f"{who}_walk_{side}",
            SHEET.format(view=view, camera=CAMERA, frames=WALK, people=PEOPLE, style=STYLE, bg=KEY_BG),
            refs=[f"{who}_ref"],
        )
        for weapon, frames in ATTACKS.items():
            job(
                f"{who}_{weapon}_{side}",
                SHEET.format(view=view, camera=CAMERA, frames=frames, people=PEOPLE, style=STYLE, bg=KEY_BG),
                refs=[f"{who}_ref"],
            )

job(
    "ground",
    "Game ground texture: a perfectly TOP-DOWN orthographic view, looking straight down, of the paved ground of "
    "a large Parisian square. Worn grey-beige granite cobblestones laid in fan patterns, a big circular paving "
    "motif of lighter stone in the centre, a pale limestone pavement strip with a curb along the whole top edge, "
    "a dark asphalt street with white zebra crossings and painted lane arrows along the bottom edge, a painted "
    "bicycle lane, a few manhole covers and drain grates, scattered autumn plane-tree leaves, a few shallow "
    "puddles, faded chalk graffiti. Absolutely NO objects standing on it: no cars, no people, no trees, no "
    "buildings, no lamps, no benches, no shadows of objects. Flat even lighting. " + STYLE,
    aspect="4:3", size="4K",
)
SHOP_VIEW = (
    "Three separate Parisian shopfronts side by side as three separate game sprites with wide empty magenta gaps "
    "between them (they do not touch). Each is a straight-on front elevation seen very slightly from above, the "
    "same width and the same height, with a flat bottom edge at pavement level: the shop on the ground floor "
    "(large plate-glass windows, glazed door, awning, painted sign) and above it one storey of cream Haussmann "
    "limestone facade with tall windows, shutters and a wrought-iron balcony, ending in a clean flat top edge. "
)
job(
    "shops_a",
    SHOP_VIEW + "Left: a BOULANGERIE with a dark-blue wooden front, gold lettering 'BOULANGERIE' and bread and "
    "pastries in the window. Middle: a cafe with a red awning lettered 'CAFE DE LA PLACE', big windows and a "
    "glazed door. Right: a PHARMACIE with a white-and-green front, a green neon cross and bottles in the "
    f"window.\n{STYLE}\n{KEY_BG}",
)
job(
    "shops_b",
    SHOP_VIEW + "Left: a bank, heavy grey stone and steel front lettered 'BANQUE', a steel security door, small "
    "barred windows and a cash machine (ATM) set in the wall. Middle: a fashion boutique with a black front "
    "lettered 'BOUTIQUE', mannequins wearing clothes in two big windows. Right: a newsagent with a burgundy "
    "front lettered 'TABAC PRESSE', a red diamond-shaped TABAC sign, magazines and postcards in the "
    f"window.\n{STYLE}\n{KEY_BG}",
)
job(
    "vehicles",
    "Six parked vehicles for a city game. " + OBJECT_VIEW + GRID.format(cols=3, rows=2) +
    "All vehicles are side-on three-quarter views with the front pointing to the lower-left, unbranded generic "
    "European models, clean and intact. Top row: a small red city hatchback; a silver family saloon; a white "
    "delivery van. Bottom row: a black Parisian taxi with a lit 'TAXI' roof sign; a dark-green compact SUV; a "
    f"sky-blue motor scooter on its stand.\n{STYLE}\n{KEY_BG}",
)
job(
    "street_a",
    "Eight pieces of Parisian street furniture for a city game. " + OBJECT_VIEW + GRID.format(cols=4, rows=2) +
    "Top row: a dark-green Morris advertising column with a domed roof and colourful posters; a dark-green "
    "newspaper kiosk with a domed roof, open, with magazines on display; a glass-and-steel bus shelter with a "
    "bench and an advertising panel; a glass telephone booth. Bottom row: a classic ornate cast-iron Parisian "
    "street lamp with a lantern; a traffic light on a pole with a pedestrian signal; a dark-green cast-iron "
    f"Wallace drinking fountain with four caryatids; a plane tree with autumn leaves standing in a round iron tree grate.\n{STYLE}\n{KEY_BG}",
)
job(
    "street_b",
    "Eight street objects for a city game set in Paris. " + OBJECT_VIEW + GRID.format(cols=4, rows=2) +
    "Top row: a cafe terrace set (round marble bistro table, two woven rattan chairs and a cream parasol); a "
    "greengrocer's stall of stacked wooden crates full of fruit and vegetables under a striped canopy; a grey "
    "steel street parking meter (pay-and-display machine) with a small screen; a docking rack with three green "
    "rental bicycles. Bottom row: a classic green wooden-slat park bench with cast-iron legs; a bronze statue "
    "of a woman holding a flag on a tall stone pedestal; a group of three green plastic wheelie bins; a "
    f"free-standing illuminated glass advertising panel on a steel foot.\n{STYLE}\n{KEY_BG}",
)
job(
    "icons",
    "Three game weapon icons in one row, each centred in its own third of the image with wide magenta gaps: "
    "left, a molotov cocktail (green glass bottle with a burning cloth wick); middle, a wooden baseball bat "
    f"lying diagonally; right, a pump-action shotgun with a wooden stock lying diagonally. Bold readable shapes.\n{STYLE}\n{KEY_BG}",
    aspect="21:9", size="1K",
)
job(
    "title_bg",
    "Dramatic key art for a video game title screen, no text at all. A Parisian square at dusk seen from street "
    "level: Haussmann buildings with lit shop windows, wet cobblestones reflecting orange light, a car burning "
    "in the middle distance, drifting smoke and red flare light, fluttering leaflets in the air, a deep "
    "blue-violet sky. In the foreground, seen from behind, three young people in streetwear (a puffer jacket, a "
    "track jacket, a hoodie) stand side by side looking at the square. The upper third of the image is calm sky "
    "and rooftops, left free for a title. " + STYLE,
    aspect="3:4",
)
job(
    "logo",
    "Hand-painted video game title lettering reading exactly 'FRENCH REBELLION' on two lines ('FRENCH' above, "
    "'REBELLION' below), bold condensed brush-painted block capitals in warm off-white with thick dry-brush "
    "texture, a rough red paint stroke underlining it and small blue and red paint splatters. Nothing else in "
    f"the image.\n{KEY_BG}",
    aspect="16:9", size="1K",
)

WRECK = (
    "Repaint this exact image as its destroyed version for a video game. Keep the SAME layout, the same object "
    "positions, sizes, viewing angles and outlines, the same painting style and the same flat pure magenta "
    "(#FF00FF) background. Do not add or remove objects, do not add smoke or flames or debris outside the "
    "objects' original outlines. "
)
job("vehicles_wreck", WRECK + "Every vehicle is now a burnt-out wreck: charred black and rusty bodywork, all "
    "windows gone, tyres melted, paint blistered, interiors gutted, still sitting where it was.", refs=["vehicles"])
job("shops_a_wreck", WRECK + "Every shop is now vandalised: all plate-glass windows and the glazed door smashed "
    "with jagged shards left in the frames, dark looted interiors, torn awnings, soot stains above the windows, "
    "spray-paint scribbles on the stone, the signs cracked but still readable.", refs=["shops_a"])
job("shops_b_wreck", WRECK + "Every shop is now vandalised: windows smashed with jagged shards left in the "
    "frames, dark looted interiors, the bank's steel door and cash machine riddled with buckshot holes and "
    "dented, soot stains above the windows, spray-paint scribbles on the stone, the signs cracked but still "
    "readable.", refs=["shops_b"])
job("street_a_wreck", WRECK + "Every object is now wrecked: the column and the kiosk charred and torn open, the "
    "bus shelter and the telephone booth with all glass shattered and frames bent, the street lamp bent with a "
    "broken lantern, the traffic light dark, bent and riddled with holes, the fountain cracked and broken, the "
    "tree burnt bare and black.", refs=["street_a"])
job("street_b_wreck", WRECK + "Every object is now wrecked: the cafe table and chairs overturned and burnt with "
    "the parasol in tatters, the stall collapsed and charred, the parking meter smashed open and riddled with "
    "holes, the bicycles bent and tangled, the bench broken and burnt, the statue chipped with its top broken "
    "off, the bins melted and charred, the advertising panel dark with its glass shattered.", refs=["street_b"])


def data_url(path):
    return "data:image/png;base64," + base64.b64encode(open(path, "rb").read()).decode()


def run(name):
    spec = JOBS[name]
    out = f"{RAW}/{name}.png"
    if os.path.exists(out):
        return f"{name}: exists"
    content = [{"type": "text", "text": spec["prompt"]}]
    for ref in spec["refs"]:
        if not os.path.exists(f"{RAW}/{ref}.png"):
            return f"{name}: SKIPPED, {ref} is missing"
        content.append({"type": "image_url", "image_url": {"url": data_url(f"{RAW}/{ref}.png")}})
    for attempt in range(3):
        try:
            reply = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key()}"},
                json={
                    "model": MODEL,
                    "messages": [{"role": "user", "content": content}],
                    "modalities": ["image", "text"],
                    "image_config": {"aspect_ratio": spec["aspect"], "image_size": spec["size"]},
                    "usage": {"include": True},
                },
                timeout=600,
            ).json()
        except Exception as error:  # network hiccup: nothing was billed that we know of
            last = f"request failed: {type(error).__name__}"
            continue
        cost = (reply.get("usage") or {}).get("cost")
        with LOCK, open(f"{RAW}/ledger.jsonl", "a") as ledger:
            ledger.write(json.dumps({"job": name, "cost": cost, "ok": "choices" in reply}) + "\n")
        try:
            url = reply["choices"][0]["message"]["images"][0]["image_url"]["url"]
        except (KeyError, IndexError, TypeError):
            last = json.dumps(reply)[:300]
            continue
        with open(out, "wb") as handle:
            handle.write(base64.b64decode(url.split(",", 1)[1]))
        return f"{name}: ok ${cost}"
    return f"{name}: FAILED {last}"


if __name__ == "__main__":
    wanted = []
    for arg in sys.argv[2:]:
        wanted += [n for n in JOBS if n.startswith(arg[:-1])] if arg.endswith("*") else [arg]
    # Sheets painted from another sheet (a character reference, an intact object sheet) wait for it.
    for stage in (lambda n: not JOBS[n]["refs"], lambda n: JOBS[n]["refs"]):
        with ThreadPoolExecutor(int(os.environ.get("ART_JOBS", "3"))) as pool:
            for line in pool.map(run, [n for n in wanted if stage(n)]):
                print(line, flush=True)
