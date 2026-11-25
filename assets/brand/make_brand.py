"""Generate the Psice brand files: logo, animation, vector sources and icons.

Run from the repository root (Windows, needs the Segoe UI Semibold font):

    uv run --no-project --with pillow --with fonttools python assets/brand/make_brand.py

Pillow and fontTools are only needed here, they are not project dependencies.
"""

import math
from pathlib import Path

from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont

BRAND = Path(__file__).resolve().parent
DOCS_IMAGES = BRAND.parent.parent / "docs" / "images"

NAVY_HEX = "#0F172A"
BLUE_HEX = "#2563EB"
RED_HEX = "#DC2626"  # unconnected pins in the editor (COLORS.pin)
NAVY = (15, 23, 42)
BLUE = (37, 99, 235)
RED = (220, 38, 38)
PIN_FILL = (250, 222, 222)  # red at 15 % over white, as in the editor
PIN_FILL_HEX = "#FADEDE"
PIN_WIDTH = 6  # outline of the pin (thicker than in the editor, to stay visible)
WHITE = (255, 255, 255)
GRID = (226, 232, 240)
FONT = "C:/Windows/Fonts/seguisb.ttf"

# Layout in 1600 x 900 units.
W, H = 1600, 900
FONT_SIZE = 300
BASELINE = 575
STROKE = 36  # close to the stem weight of the font
LETTER_GAP = -12  # P close to "sice": same spacing as inside the word
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


def _layer(s):
    return Image.new("RGBA", (int(W * s), int(H * s)), (0, 0, 0, 0))


def _put(base, lay, alpha=1.0):
    """Composite an RGBA layer onto base with an extra opacity."""
    if alpha <= 0:
        return
    if alpha < 1:
        lay.putalpha(lay.getchannel("A").point(lambda v: int(v * alpha)))
    base.alpha_composite(lay)


def _circle(d, x, y, r, s, fill, **kw):
    d.ellipse([(x - r) * s, (y - r) * s, (x + r) * s, (y + r) * s], fill=fill, **kw)


def p_layer(pts, s):
    lay = _layer(s)
    d = ImageDraw.Draw(lay)
    for x, y in pts:
        _circle(d, x, y, STROKE / 2, s, NAVY)
    return lay


def dot_layer(L, s, k=1.0):
    lay = _layer(s)
    if k > 0:
        _circle(ImageDraw.Draw(lay), L["stem_x"], L["bowl_bottom"], 26 * k, s, BLUE)
    return lay


def ring_layer(L, s, k=1.0):
    lay = _layer(s)
    if k > 0:
        d = ImageDraw.Draw(lay)
        _circle(d, L["stem_x"], BASELINE + 4, 30 * k, s, BLUE)
        _circle(d, L["stem_x"], BASELINE + 4, 14 * k, s, WHITE)
    return lay


def dot_top_limit():
    """Height (logo units) above which a glyph part is the dot of the i."""
    return BASELINE + font(1).getbbox("x", anchor="ls")[1] - 8


def pin_geometry(L):
    """Centre and radius (logo units) of the pin that replaces the dot of the i."""
    f = font(1)
    i = WORD.index("i")
    x = L["text_x"] + f.getlength(WORD[:i])
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).text((x, BASELINE), "i", font=f, fill=255, anchor="ls")
    x0, y0, x1, y1 = mask.crop((0, 0, W, int(dot_top_limit()))).getbbox()
    return (x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, y1 - y0) / 2 * 1.1


def letter_layer(L, s, i, dy=0.0):
    lay = _layer(s)
    x = L["text_x"] + font(1).getlength(WORD[:i])
    ch = "\u0131" if WORD[i] == "i" else WORD[i]  # dotless i: the dot is drawn as a pin
    ImageDraw.Draw(lay).text((x * s, (BASELINE + dy) * s), ch, font=font(s), fill=NAVY, anchor="ls")
    return lay


def pin_layer(L, s, k=1.0, pulse=None):
    """The dot of the i, drawn like an unconnected pin in the editor: red outline, light fill.

    `pulse` (0 to 1) adds a red ring that grows and fades, like a warning.
    """
    lay = _layer(s)
    cx, cy, r = pin_geometry(L)
    d = ImageDraw.Draw(lay)
    if k > 0:
        rk = r * k
        _circle(d, cx, cy, rk, s, PIN_FILL, outline=RED, width=max(1, int(PIN_WIDTH * s)))
    if pulse is not None and 0 < pulse < 1:
        rp = r * (1 + 1.6 * pulse)
        a = int(255 * (1 - pulse))
        _circle(d, cx, cy, rp, s, None, outline=RED + (a,), width=max(1, int(4 * s)))
    return lay


def glow_layer(x, y, r, s, strength=1.0):
    lay = _layer(s)
    _circle(ImageDraw.Draw(lay), x, y, r, s, BLUE + (int(170 * strength),))
    return lay.filter(ImageFilter.GaussianBlur(r * s * 0.45))


def spark_layer(x, y, s):
    lay = _layer(s)
    _circle(ImageDraw.Draw(lay), x, y, 11, s, WHITE, outline=BLUE, width=int(5 * s))
    return lay


def frame(L, s, p=None, dot=0.0, ring=0.0, letters=(), pin=0.0, pulse=None, extras=()):
    """One image: grid, P (points), dot, ring, letters [(alpha, dy)], pin and extra layers."""
    img = background(s).convert("RGBA")
    if p:
        _put(img, p_layer(p, s))
    if dot:
        _put(img, dot_layer(L, s, dot))
    if ring:
        _put(img, ring_layer(L, s, ring))
    for i, (alpha, dy) in enumerate(letters):
        _put(img, letter_layer(L, s, i, dy), alpha)
    if pin or pulse is not None:
        _put(img, pin_layer(L, s, pin, pulse))
    for lay in extras:
        _put(img, lay)
    return img


def ease(t):
    t = min(1.0, max(0.0, t))
    return 1 - (1 - t) ** 3


def ease_back(t):
    """Ease out with a small overshoot, for parts that snap into place."""
    t = min(1.0, max(0.0, t))
    c = 1.7
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2


def make_logo_and_animation(out):
    L = layout()

    # Static logo, 1600 x 900, supersampled.
    ss = 3
    img = frame(L, ss, p=p_path(L), dot=1, ring=1, letters=[(1.0, 0.0)] * len(WORD), pin=1)
    img.convert("RGB").resize((W, H), Image.LANCZOS).save(f"{out}/psice-logo.png", optimize=True)

    # Animation, 800 x 450 ("Vague", chosen by the team): the terminal appears, a spark draws
    # the P, the junction dot lights up, then the letters of "sice" rise one after the other;
    # last, the dot of the i appears as an unconnected pin and sends a warning pulse.
    s = 1.0
    pts = p_path(L, step=1.0)
    frames = []
    for i in range(1, 7):
        frames.append(frame(L, s, ring=ease_back(i / 6)))
    n = 21
    for i in range(1, n + 1):
        k = max(1, int(len(pts) * ease(i / n)))
        tip = pts[k - 1]
        spark = [glow_layer(*tip, 34, s, 0.9), spark_layer(*tip, s)] if i < n else []
        frames.append(frame(L, s, p=pts[:k], ring=1, extras=spark))
    for i in range(1, 7):
        glow = glow_layer(L["stem_x"], L["bowl_bottom"], 70, s, 1 - i / 7)
        frames.append(frame(L, s, p=pts, ring=1, dot=ease_back(i / 6), extras=[glow]))
    gap, dur = 3, 11
    for f in range(1, gap * (len(WORD) - 1) + dur + 1):
        letters = []
        for j in range(len(WORD)):
            t = min(1.0, max(0.0, (f - gap * j) / dur))
            letters.append((min(1.0, t * 1.6), 50 * (1 - ease(t))))
        frames.append(frame(L, s, p=pts, ring=1, dot=1, letters=letters))
    full = [(1.0, 0.0)] * len(WORD)
    for i in range(1, 9):
        frames.append(frame(L, s, p=pts, ring=1, dot=1, letters=full, pin=ease_back(i / 8)))
    for i in range(1, 19):
        frames.append(frame(L, s, p=pts, ring=1, dot=1, letters=full, pin=1, pulse=i / 19))
    frames.append(frame(L, s, p=pts, ring=1, dot=1, letters=full, pin=1))
    durations = [20] * len(frames)  # 50 images/s; GIF players slow down anything shorter
    durations[-1] = 2000
    last = frames[-1]
    blank = background(s).convert("RGBA")
    for i in range(1, 11):
        frames.append(Image.blend(last, blank, i / 10))
        durations.append(20)
    durations[-1] = 400

    small = [f.convert("RGB").resize((W // 2, H // 2), Image.LANCZOS) for f in frames]
    small[0].save(
        f"{out}/psice-logo-animation.gif",
        save_all=True,
        append_images=small[1:],
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


def _contours(glyph, glyphs):
    """Split a glyph into contours: [(lowest y in font units, recording)]."""
    rec = DecomposingRecordingPen(glyphs)
    glyph.draw(rec)
    contours, current = [], []
    for op, args in rec.value:
        current.append((op, args))
        if op in ("closePath", "endPath"):
            ys = [pt[1] for _, a in current for pt in a]
            contours.append((min(ys) if ys else 0, current))
            current = []
    return contours


def word_svg(L):
    """'sice' as outlines, so the SVG does not need the font installed."""
    tt = TTFont(FONT)
    glyphs = tt.getGlyphSet()
    cmap = tt.getBestCmap()
    scale = FONT_SIZE / tt["head"].unitsPerEm
    limit = (BASELINE - dot_top_limit()) / scale  # in font units, above the baseline
    f = font(1)
    paths = []
    for i, ch in enumerate(WORD):
        x = L["text_x"] + f.getlength(WORD[:i])
        transform = f"translate({x:.2f} {BASELINE}) scale({scale:.6f} {-scale:.6f})"
        body = SVGPathPen(glyphs)
        for bottom, contour in _contours(glyphs[cmap[ord(ch)]], glyphs):
            if ch == "i" and bottom > limit:
                continue  # the dot of the i is drawn as a pin
            for op, args in contour:
                getattr(body, op)(*args)
        paths.append(f'<path transform="{transform}" d="{body.getCommands()}"/>')
    cx, cy, r = pin_geometry(L)
    pin = (
        f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r - PIN_WIDTH / 2:.2f}" '
        f'fill="{PIN_FILL_HEX}" stroke="{RED_HEX}" stroke-width="{PIN_WIDTH}"/>'
    )
    return f'<g fill="{NAVY_HEX}">' + "".join(paths) + "</g>" + pin


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
