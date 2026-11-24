"""Generate the Psice brand files: logo, animation, vector sources and icons.

Run from the repository root (Windows, needs the Segoe UI Semibold font):

    uv run --no-project --with pillow --with fonttools python assets/brand/make_brand.py

Pillow and fontTools are only needed here, they are not project dependencies.
"""

import math
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageChops, ImageDraw, ImageFont

BRAND = Path(__file__).resolve().parent
DOCS_IMAGES = BRAND.parent.parent / "docs" / "images"

NAVY_HEX = "#0F172A"
BLUE_HEX = "#2563EB"
NAVY = (15, 23, 42)
BLUE = (37, 99, 235)
WHITE = (255, 255, 255)
GRID = (226, 232, 240)
FONT = "C:/Windows/Fonts/seguisb.ttf"

# Layout in 1600 x 900 units.
W, H = 1600, 900
FONT_SIZE = 300
BASELINE = 575
STROKE = 36  # close to the stem weight of the font
LETTER_GAP = 22
WORD = "sice"


def font(scale):
    return ImageFont.truetype(FONT, int(FONT_SIZE * scale))


def layout():
    f = font(1)
    cap = -f.getbbox("H", anchor="ls")[1] * 1.12
    top = BASELINE - cap + STROKE / 2  # stroke centre line of the top bar
    bowl_bottom = top + 0.58 * (BASELINE - top)
    r = (bowl_bottom - top) / 2
    stem_x = 0.0
    bar_end = stem_x + 62
    p_right = bar_end + r + STROKE / 2
    word_w = f.getlength(WORD)
    total = (p_right + STROKE / 2) + LETTER_GAP + word_w
    x0 = (W - total) / 2 + STROKE / 2
    return {
        "stem_x": x0,
        "top": top,
        "bowl_bottom": bowl_bottom,
        "r": r,
        "bar_end": x0 + (bar_end - stem_x),
        "stem_bottom": BASELINE - STROKE / 2,
        "text_x": x0 + p_right + STROKE / 2 + LETTER_GAP,
    }


def p_path(L, step=0.3):
    """Points along the P centre line: stem bottom -> top -> bowl -> stem."""
    pts = []

    def line(a, b):
        n = max(1, int(math.dist(a, b) / step))
        pts.extend((a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n))

    sx, top, bb, r, be = L["stem_x"], L["top"], L["bowl_bottom"], L["r"], L["bar_end"]
    line((sx, L["stem_bottom"]), (sx, top))
    line((sx, top), (be, top))
    cy = top + r
    n = int(math.pi * r / step)
    pts.extend(
        (be + r * math.sin(math.pi * i / n), cy - r * math.cos(math.pi * i / n)) for i in range(n)
    )
    line((be, bb), (sx, bb))
    pts.append((sx, bb))
    return pts


def background(s):
    img = Image.new("RGB", (int(W * s), int(H * s)), WHITE)
    d = ImageDraw.Draw(img)
    g = 50
    for x in range(-22, W, g):
        d.line([(x * s, 0), (x * s, H * s)], fill=GRID, width=max(1, int(s)))
    for y in range(-10, H, g):
        d.line([(0, y * s), (W * s, y * s)], fill=GRID, width=max(1, int(s)))
    return img


def draw_stroke(d, pts, s):
    rad = STROKE / 2 * s
    for x, y in pts:
        d.ellipse([x * s - rad, y * s - rad, x * s + rad, y * s + rad], fill=NAVY)


def draw_dot(d, L, s, k=1.0):
    rad = 26 * k * s
    x, y = L["stem_x"] * s, L["bowl_bottom"] * s
    d.ellipse([x - rad, y - rad, x + rad, y + rad], fill=BLUE)


def draw_ring(d, L, s, k=1.0):
    ro, ri = 30 * k * s, 14 * k * s
    x, y = L["stem_x"] * s, (BASELINE + 4) * s
    d.ellipse([x - ro, y - ro, x + ro, y + ro], fill=BLUE)
    if ri > 0:
        d.ellipse([x - ri, y - ri, x + ri, y + ri], fill=WHITE)


def letter_spans(L):
    f = font(1)
    spans = []
    for i, ch in enumerate(WORD):
        x_start = L["text_x"] + f.getlength(WORD[:i])
        bb = f.getbbox(ch, anchor="ls")
        spans.append((x_start + bb[0] - 4, x_start + bb[2] + 4))
    return spans


def text_layer(L, s):
    layer = Image.new("L", (int(W * s), int(H * s)), 0)
    ImageDraw.Draw(layer).text(
        (L["text_x"] * s, BASELINE * s), WORD, font=font(s), fill=255, anchor="ls"
    )
    return layer


def render(L, s, p_frac=1.0, dot=1.0, ring=1.0, text_until=None, cursor=None):
    img = background(s)
    d = ImageDraw.Draw(img)
    pts = p_path(L)
    if p_frac > 0:
        draw_stroke(d, pts[: max(1, int(len(pts) * p_frac))], s)
    if dot > 0:
        draw_dot(d, L, s, dot)
    if ring > 0:
        draw_ring(d, L, s, ring)
    if text_until is None:
        text_until = W
    if text_until > L["text_x"] - 10:
        mask = text_layer(L, s)
        clip = Image.new("L", mask.size, 0)
        ImageDraw.Draw(clip).rectangle([0, 0, text_until * s, H * s], fill=255)
        img.paste(Image.new("RGB", img.size, NAVY), (0, 0), ImageChops.multiply(mask, clip))
    if cursor is not None:
        cx, cy = cursor
        h = 11 * s
        d.rectangle(
            [cx * s - h, cy * s - h, cx * s + h, cy * s + h], outline=BLUE, width=int(3 * s)
        )
    return img


def ease(t):
    return 1 - (1 - t) ** 3


def pop(t):
    """0 -> overshoot -> 1."""
    if t <= 0:
        return 0.0
    if t >= 1:
        return 1.0
    return ease(t) * (1 + 0.25 * math.sin(math.pi * t))


def make_logo_and_animation(out):
    L = layout()

    # Static logo, 1600 x 900, supersampled.
    ss = 3
    big = render(L, ss)
    big.resize((W, H), Image.LANCZOS).save(f"{out}/psice-logo.png", optimize=True)

    # Animation, 800 x 450.
    s_out, ss = 0.5, 2
    pts = p_path(L)
    spans = letter_spans(L)
    frames, durations = [], []

    def add(img, ms):
        frames.append(img.resize((int(W * s_out), int(H * s_out)), Image.LANCZOS))
        durations.append(ms)

    s = s_out * ss
    add(render(L, s, p_frac=0, dot=0, ring=0, text_until=0), 300)
    n_p = 24
    for i in range(1, n_p + 1):
        t = ease(i / n_p)
        k = max(1, int(len(pts) * t))
        add(
            render(
                L, s, p_frac=t, dot=0, ring=0, text_until=0, cursor=pts[k - 1] if i < n_p else None
            ),
            35,
        )
    for i in range(1, 7):
        add(render(L, s, dot=pop(i / 6), ring=pop(i / 6 - 0.3) if i > 2 else 0, text_until=0), 35)
    for a, b in spans:
        n_l = 7
        for i in range(1, n_l + 1):
            x = a + (b - a) * ease(i / n_l)
            add(render(L, s, text_until=x, cursor=(x, BASELINE - 60) if i < n_l else None), 35)
    add(render(L, s), 2200)
    full = frames[-1]
    blank = render(L, s, p_frac=0, dot=0, ring=0, text_until=0).resize(full.size, Image.LANCZOS)
    for i in range(1, 9):
        frames.append(Image.blend(full, blank, i / 8))
        durations.append(40)
    durations[-1] = 400

    frames[0].save(
        f"{out}/psice-logo-animation.gif",
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )


def p_svg(L, stroke, dot=True, ring=True, hole=True):
    """SVG elements for the P monogram, in logo units."""
    sx, top, bb, r, be = L["stem_x"], L["top"], L["bowl_bottom"], L["r"], L["bar_end"]
    d = (
        f"M{sx:.2f} {L['stem_bottom']:.2f}V{top:.2f}H{be:.2f}"
        f"A{r:.2f} {r:.2f} 0 0 1 {be:.2f} {bb:.2f}H{sx:.2f}"
    )
    parts = [
        f'<path d="{d}" fill="none" stroke="{NAVY_HEX}" stroke-width="{stroke}" '
        'stroke-linecap="round" stroke-linejoin="round"/>'
    ]
    if dot:
        parts.append(f'<circle cx="{sx:.2f}" cy="{bb:.2f}" r="26" fill="{BLUE_HEX}"/>')
    if ring:
        cy = BASELINE + 4
        if hole:
            parts.append(
                f'<circle cx="{sx:.2f}" cy="{cy:.2f}" r="22" fill="none" '
                f'stroke="{BLUE_HEX}" stroke-width="16"/>'
            )
        else:
            parts.append(f'<circle cx="{sx:.2f}" cy="{cy:.2f}" r="30" fill="{BLUE_HEX}"/>')
    return parts


def word_svg(L):
    """'sice' as outlines, so the SVG does not need the font installed."""
    tt = TTFont(FONT)
    glyphs = tt.getGlyphSet()
    cmap = tt.getBestCmap()
    scale = FONT_SIZE / tt["head"].unitsPerEm
    f = font(1)
    paths = []
    for i, ch in enumerate(WORD):
        pen = SVGPathPen(glyphs)
        glyphs[cmap[ord(ch)]].draw(pen)
        x = L["text_x"] + f.getlength(WORD[:i])
        paths.append(
            f'<path transform="translate({x:.2f} {BASELINE}) scale({scale:.6f} {-scale:.6f})" '
            f'd="{pen.getCommands()}"/>'
        )
    return f'<g fill="{NAVY_HEX}">' + "".join(paths) + "</g>"


def svg(view, body, title):
    x, y, w, h = view
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x:.2f} {y:.2f} {w:.2f} {h:.2f}" '
        f'role="img" aria-label="{title}">\n<title>{title}</title>\n'
        + "\n".join(body)
        + "\n</svg>\n"
    )


TILE = "#FFFFFF"
TILE_BORDER = "#CBD5E1"


def tile_svg(box):
    x, y, side, _ = box
    rx = side * 0.2
    w = side * 0.02
    return (
        f'<rect x="{x + w / 2:.2f}" y="{y + w / 2:.2f}" '
        f'width="{side - w:.2f}" height="{side - w:.2f}" '
        f'rx="{rx:.2f}" fill="{TILE}" stroke="{TILE_BORDER}" stroke-width="{w:.2f}"/>'
    )


def icon_box(L, stroke, pad=1.12):
    """Square box around the P (stem, bowl and bottom terminal), with a margin."""
    left = L["stem_x"] - 30
    right = L["bar_end"] + L["r"] + stroke / 2
    top = L["top"] - stroke / 2
    bottom = BASELINE + 4 + 30
    side = max(right - left, bottom - top) * pad
    cx, cy = (left + right) / 2, (top + bottom) / 2
    return (cx - side / 2, cy - side / 2, side, side)


def small_layout(L):
    """Simplified P for 16-32 px: thicker stroke, larger counter."""
    s = dict(L)
    s["bar_end"] = L["bar_end"] + 12
    return s


SMALL_STROKE = 60


def raster(svg_parts_fn, box, size):
    """Draw the icon at `size` px (supersampled) on a white rounded tile."""
    ss = 8
    x0, y0, side, _ = box
    k = size * ss / side
    img = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
    n = size * ss
    bw = max(ss, round(n * 0.02))
    ImageDraw.Draw(img).rounded_rectangle(
        [bw / 2, bw / 2, n - 1 - bw / 2, n - 1 - bw / 2],
        radius=n * 0.2,
        fill=TILE,
        outline=TILE_BORDER,
        width=bw,
    )
    svg_parts_fn(ImageDraw.Draw(img), lambda x, y: ((x - x0) * k, (y - y0) * k), k)
    return img.resize((size, size), Image.LANCZOS)


def draw_p(L, stroke, hole, dot):
    def fn(d, tr, k):
        pts = p_path(L)
        rad = stroke / 2 * k
        for x, y in pts:
            X, Y = tr(x, y)
            d.ellipse([X - rad, Y - rad, X + rad, Y + rad], fill=NAVY)
        if dot:
            X, Y = tr(L["stem_x"], L["bowl_bottom"])
            d.ellipse([X - 26 * k, Y - 26 * k, X + 26 * k, Y + 26 * k], fill=BLUE)
        X, Y = tr(L["stem_x"], BASELINE + 4)
        d.ellipse([X - 30 * k, Y - 30 * k, X + 30 * k, Y + 30 * k], fill=BLUE)
        if hole:
            d.ellipse([X - 14 * k, Y - 14 * k, X + 14 * k, Y + 14 * k], fill=TILE)

    return fn


def make_icons(out):
    L = layout()
    S = small_layout(L)

    # Full logo: P + "sice".
    left = L["stem_x"] - 30 - 40
    f = font(1)
    right = L["text_x"] + f.getlength(WORD) + 40
    top = L["top"] - STROKE / 2 - 40
    bottom = BASELINE + 4 + 30 + 40
    with open(f"{out}/psice-logo.svg", "w", encoding="utf-8", newline="\n") as fh:
        fh.write(
            svg((left, top, right - left, bottom - top), p_svg(L, STROKE) + [word_svg(L)], "Psice")
        )

    # Square icon, full detail (48 px and more).
    box = icon_box(L, STROKE, pad=1.4)
    with open(f"{out}/psice-icon.svg", "w", encoding="utf-8", newline="\n") as fh:
        fh.write(svg(box, [tile_svg(box)] + p_svg(L, STROKE), "Psice"))

    # Square icon, simplified (16 to 32 px): thick stroke, no junction dot, solid terminal.
    sbox = icon_box(S, SMALL_STROKE, pad=1.25)
    with open(f"{out}/psice-icon-small.svg", "w", encoding="utf-8", newline="\n") as fh:
        fh.write(
            svg(sbox, [tile_svg(sbox)] + p_svg(S, SMALL_STROKE, dot=False, hole=False), "Psice")
        )

    # PNG previews and the multi-size .ico.
    images = {}
    for size in (16, 24, 32, 48, 64, 128, 256):
        if size <= 32:
            img = raster(draw_p(S, SMALL_STROKE, hole=False, dot=False), sbox, size)
        else:
            img = raster(draw_p(L, STROKE, hole=True, dot=True), box, size)
        images[size] = img
    images[256].save(f"{out}/psice-icon-256.png", optimize=True)
    images[32].save(f"{out}/psice-icon-32.png", optimize=True)
    images[16].save(f"{out}/psice-icon-16.png", optimize=True)
    images[256].save(
        f"{out}/psice.ico",
        sizes=[(s, s) for s in images],
        append_images=[images[s] for s in images if s != 256],
    )


if __name__ == "__main__":
    make_logo_and_animation(DOCS_IMAGES)
    make_icons(BRAND)
