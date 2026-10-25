"""Cuts the logo, eye mark and app icons out of the brand sheet.

Usage (from apps/web): python3 scripts/extract-brand.py ../../docs/brand/vigil-brand-sheet.webp .
Writes public/brand/vigil-logo{,-dark}.png, public/brand/vigil-mark.png and
src/app/{favicon.ico,icon.png,apple-icon.png}. Needs Pillow. Pixel boxes match that sheet.
"""
import sys
from PIL import Image, ImageDraw

src, web = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
BG = (250, 252, 254)
LO, HI = 28, 95  # "distance from white" below LO is background, above HI fully opaque


def knock_out(region):
    """Near-white background -> transparent, with colours un-blended from white at soft edges."""
    out = Image.new("RGBA", region.size)
    src_px, out_px = region.load(), out.load()
    for y in range(region.height):
        for x in range(region.width):
            r, g, b = src_px[x, y]
            d = 255 - min(r, g, b)
            a = max(0.0, min(1.0, (d - LO) / (HI - LO)))
            if a == 0:
                out_px[x, y] = (0, 0, 0, 0)
                continue
            un = [max(0, min(255, round(bg + (c - bg) / a))) for c, bg in zip((r, g, b), BG)]
            out_px[x, y] = (*un, round(a * 255))
    return out


def drop_specks(img, max_area=40):
    """Removes small isolated clusters (background noise that passed the threshold)."""
    px = img.load()
    w, h = img.size
    seen = bytearray(w * h)
    for y0 in range(h):
        for x0 in range(w):
            if seen[y0 * w + x0] or px[x0, y0][3] == 0:
                continue
            stack, comp = [(x0, y0)], []
            seen[y0 * w + x0] = 1
            while stack:
                x, y = stack.pop()
                comp.append((x, y))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and px[nx, ny][3]:
                            seen[ny * w + nx] = 1
                            stack.append((nx, ny))
            if len(comp) <= max_area:
                for x, y in comp:
                    px[x, y] = (0, 0, 0, 0)
    return img


PAD = 10
# Eye spans rows 134-343; wordmark 148-310; the slogan starts at row 342 right of the eye.
logo_box = (175 - PAD, 134 - PAD, 1076 + PAD, 343 + PAD)
logo = knock_out(im.crop(logo_box))
lpx = logo.load()
for y in range(325 - logo_box[1], logo.height):
    for x in range(520 - logo_box[0], logo.width):
        lpx[x, y] = (0, 0, 0, 0)
logo = drop_specks(logo)
logo = logo.crop(logo.getbbox())
padded = Image.new("RGBA", (logo.width + 2 * PAD, logo.height + 2 * PAD))
padded.paste(logo, (PAD, PAD))
logo = padded
logo_box = (logo_box[0] + 0, logo_box[1], 0, 0)  # x origin unchanged: bbox crop then same pad
logo.save(f"{web}/public/brand/vigil-logo.png", optimize=True)

# Dark variant: the navy wordmark (right of the eye) turns white; the eye and the teal dot stay.
split = 518 - logo_box[0]
dark = logo.copy()
px = dark.load()
for y in range(dark.height):
    for x in range(split, dark.width):
        r, g, b, a = px[x, y]
        if a and max(r, g, b) < 130:  # navy text, not the teal/blue gradients
            px[x, y] = (255, 255, 255, a)
# The pulse line's pale tail is semi-transparent and reads as a smudge on dark backgrounds;
# make it opaque so it shows as the light line it is on white.
for y in range(dark.height):
    for x in range(split):
        r, g, b, a = px[x, y]
        if 0 < a < 230 and min(r, g, b) > 140:
            px[x, y] = (r, g, b, 255)
dark.save(f"{web}/public/brand/vigil-logo-dark.png", optimize=True)

# Eye mark alone (collapsed sidebar): eye columns only, wordmark pixels removed by colour.
mark = logo.crop((0, 0, 524 - logo_box[0] + 1, logo.height)).copy()
mpx = mark.load()
for y in range(mark.height):
    for x in range(split, mark.width):
        r, g, b, a = mpx[x, y]
        if a and max(r, g, b) < 130:
            mpx[x, y] = (0, 0, 0, 0)
mark = mark.crop(mark.getbbox())
side = max(mark.size) + 8
square = Image.new("RGBA", (side, side))
square.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2))
square.save(f"{web}/public/brand/vigil-mark.png", optimize=True)

# Light app tile (top right) for browser and home-screen icons, with a clean rounded mask.
tile = im.crop((1298, 67, 1449, 215)).convert("RGBA")
size = 148
tile = tile.resize((size, size), Image.LANCZOS)
mask = Image.new("L", (size * 4, size * 4), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=int(size * 4 * 0.22), fill=255)
tile.putalpha(mask.resize((size, size), Image.LANCZOS))
tile.resize((192, 192), Image.LANCZOS).save(f"{web}/src/app/icon.png", optimize=True)
# Apple adds its own rounded corners: give it the full square tile.
im.crop((1298, 67, 1449, 215)).resize((180, 180), Image.LANCZOS).save(f"{web}/src/app/apple-icon.png", optimize=True)
tile.save(f"{web}/src/app/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print("logo", logo.size, "mark", square.size, "tile", tile.size)
