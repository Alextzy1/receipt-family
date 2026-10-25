"""Generate Receipt Family icons (pure Python, no dependencies).
Usage: python tools/make_icons.py   (run from repo root)
"""
import math, os, struct, zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLUE_TOP = (96, 165, 250)
BLUE_BOT = (29, 78, 216)

def png(path, w, h, rgba):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += rgba[y * w * 4:(y + 1) * w * 4]
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) \
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)

def tri(x):  # triangle wave 0..1 with period 1
    f = x - math.floor(x)
    return 1 - abs(2 * f - 1)

def in_glyph(u, v, s):
    """u,v in unit square; s = glyph scale about centre. Returns 0 outside, 1 paper, 2 ink line."""
    u = (u - 0.5) / s + 0.5
    v = (v - 0.5) / s + 0.5
    if not (0.29 <= u <= 0.71 and 0.19 <= v <= 0.81):
        return 0
    bottom = 0.77 + 0.04 * tri((u - 0.29) / 0.0525)
    if v > bottom:
        return 0
    hw = 0.017
    for (y, x0, x1, t) in ((0.31, 0.36, 0.56, 1), (0.42, 0.36, 0.64, 1), (0.50, 0.36, 0.64, 1),
                           (0.58, 0.36, 0.50, 1), (0.66, 0.36, 0.64, 1.5)):
        if x0 <= u <= x1 and abs(v - y) <= hw * t:
            return 2
    return 1

def render(size, mode, ss=3):
    out = bytearray(size * size * 4)
    n = ss * ss
    for py in range(size):
        for px in range(size):
            r = g = b = a = 0.0
            for sy in range(ss):
                for sx in range(ss):
                    u = (px + (sx + 0.5) / ss) / size
                    v = (py + (sy + 0.5) / ss) / size
                    if mode == 'round':
                        # rounded square, radius 0.22
                        cx = min(max(u, 0.22), 0.78)
                        cy = min(max(v, 0.22), 0.78)
                        inside = (u - cx) ** 2 + (v - cy) ** 2 <= 0.22 ** 2
                    else:
                        inside = True
                    if mode == 'fg':
                        inside = False
                    col = None
                    if inside:
                        t = v
                        col = tuple(BLUE_TOP[i] + (BLUE_BOT[i] - BLUE_TOP[i]) * t for i in range(3))
                    scale = {'round': 1.0, 'full': 0.8, 'fg': 0.95}[mode]
                    gl = in_glyph(u, v, scale)
                    if gl == 1:
                        col = (255, 255, 255)
                    elif gl == 2:
                        col = (37, 99, 235)
                    if col is not None:
                        r += col[0]; g += col[1]; b += col[2]; a += 1
            if a:
                k = int(round(a / n * 255))
                o = (py * size + px) * 4
                out[o] = int(r / a); out[o + 1] = int(g / a); out[o + 2] = int(b / a); out[o + 3] = k
    return out

def main():
    web = os.path.join(ROOT, 'web', 'icons')
    png(os.path.join(web, 'icon-512.png'), 512, 512, render(512, 'round'))
    png(os.path.join(web, 'icon-192.png'), 192, 192, render(192, 'round'))
    png(os.path.join(web, 'apple-touch-icon.png'), 180, 180, render(180, 'full'))  # iOS rounds corners itself
    png(os.path.join(web, 'icon-maskable-512.png'), 512, 512, render(512, 'full'))
    res = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
    for d, sz in (('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)):
        png(os.path.join(res, 'mipmap-' + d, 'ic_launcher.png'), sz, sz, render(sz, 'round'))
    png(os.path.join(res, 'drawable-nodpi', 'ic_launcher_foreground.png'), 432, 432, render(432, 'fg', 2))
    print('icons done')

main()
