"""Render an original orbit diagram as themed GIFs and reduced-motion stills.

This draws a new geometric illustration; it does not modify brand or photo assets.
Run with Python and Pillow. Outputs are local to public/animations.
"""

from math import cos, sin, pi
from pathlib import Path
from PIL import Image, ImageDraw

OUTPUT = Path(__file__).resolve().parents[2] / "public" / "animations"
OUTPUT.mkdir(parents=True, exist_ok=True)
SIZE = (320, 176)
SCALE = 3
FRAMES = 60
THEMES = {
    "light": {"background": "#f7f9fc", "ring": "#d5e0f3", "inner": "#e5ecf7", "accent": "#2155cd", "node": "#6a91df"},
    "dark": {"background": "#080e1b", "ring": "#31446a", "inner": "#1b2d49", "accent": "#9abaff", "node": "#6b91d6"},
}


def render(frame, colors):
    image = Image.new("RGB", (SIZE[0] * SCALE, SIZE[1] * SCALE), colors["background"])
    draw = ImageDraw.Draw(image)

    def line(points, color, width=1):
        draw.line([(round(x * SCALE), round(y * SCALE)) for x, y in points], fill=color, width=max(1, round(width * SCALE)), joint="curve")

    def circle(x, y, radius, color, width=0):
        box = tuple(round(value * SCALE) for value in (x-radius, y-radius, x+radius, y+radius))
        draw.ellipse(box, outline=color if width else None, fill=None if width else color, width=max(1, round(width*SCALE)))

    t = frame / FRAMES * 2 * pi
    for index, (cx, cy) in enumerate(((114, 88), (206, 88))):
        circle(cx, cy, 52, colors["ring"], 1)
        circle(cx, cy, 43, colors["inner"], .8)
        for tick in range(12):
            angle = tick / 12 * 2 * pi
            line([(cx + cos(angle)*47, cy + sin(angle)*47), (cx + cos(angle)*51, cy + sin(angle)*51)], colors["ring"], .8)
        points = [(cx-22, cy+13), (cx-9, cy-17), (cx+15, cy-8), (cx+22, cy+18)]
        line(points, colors["node"], 1)
        for x, y in points:
            circle(x, y, 2, colors["node"])
        angle = t + index*pi
        for tail in range(9, 0, -1):
            a = angle - tail*.045
            radius = 1.15 + (9-tail)*.16
            circle(cx + cos(a)*52, cy + sin(a)*52, radius, colors["ring"])
        x, y = cx+cos(angle)*52, cy+sin(angle)*52
        circle(x, y, 5.5, colors["background"])
        circle(x, y, 3.6, colors["accent"])
    # The shared center connects the two diagrams, rather than implying a score.
    circle(160, 88, 8, colors["background"])
    circle(160, 88, 4, colors["accent"])
    return image.resize(SIZE, Image.Resampling.LANCZOS)


for theme, colors in THEMES.items():
    frames = [render(frame, colors) for frame in range(FRAMES)]
    frames[0].save(OUTPUT / f"connection-orbit-{theme}-still.png", optimize=True)
    palette = frames[0].quantize(colors=96, dither=Image.Dither.NONE)
    indexed = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
    path = OUTPUT / f"connection-orbit-{theme}.gif"
    indexed[0].save(path, save_all=True, append_images=indexed[1:], duration=80, loop=0, optimize=True, disposal=1)
    print(f"{path.name}: {path.stat().st_size:,} bytes; {FRAMES} frames; 4.8 second loop")
