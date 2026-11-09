"""Draws the original MachSim app icon (256x256 PNG) with the standard library only."""
import math, struct, sys, zlib

W = H = 256
def lerp(a, b, t): return a + (b - a) * t
px = bytearray(W * H * 4)

def blend(x, y, rgb, a):
    if not (0 <= x < W and 0 <= y < H) or a <= 0: return
    i = (y * W + x) * 4
    da = px[i + 3] / 255
    oa = a + da * (1 - a)
    for k in range(3):
        c = (rgb[k] * a + px[i + k] * da * (1 - a)) / oa if oa else 0
        px[i + k] = int(c)
    px[i + 3] = int(oa * 255)

R = 46
for y in range(H):
    for x in range(W):
        # rounded square with soft edge
        dx = max(R - x, 0, x - (W - 1 - R)); dy = max(R - y, 0, y - (H - 1 - R))
        d = math.hypot(dx, dy) - R if (dx and dy) else max(dx, dy) - R
        a = max(0.0, min(1.0, 0.5 - d))
        if dx == 0 and dy == 0: a = 1.0
        t = (x + y) / (W + H)
        blend(x, y, (int(lerp(28, 13, t)), int(lerp(110, 60, t)), int(lerp(235, 160, t))), a)

def stroke(points, width, rgb):
    hw = width / 2
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        minx, maxx = int(min(x0, x1) - hw - 2), int(max(x0, x1) + hw + 2)
        miny, maxy = int(min(y0, y1) - hw - 2), int(max(y0, y1) + hw + 2)
        vx, vy = x1 - x0, y1 - y0; L2 = vx * vx + vy * vy or 1
        for y in range(miny, maxy + 1):
            for x in range(minx, maxx + 1):
                t = max(0, min(1, ((x - x0) * vx + (y - y0) * vy) / L2))
                d = math.hypot(x - (x0 + t * vx), y - (y0 + t * vy))
                a = max(0.0, min(1.0, hw + 0.5 - d))
                if a > 0:
                    i = (y * W + x) * 4
                    if 0 <= x < W and 0 <= y < H and px[i + 3] > 0:
                        blend(x, y, rgb, a)

def dot(cx, cy, r, rgb):
    for y in range(int(cy - r - 2), int(cy + r + 3)):
        for x in range(int(cx - r - 2), int(cx + r + 3)):
            a = max(0.0, min(1.0, r + 0.5 - math.hypot(x - cx, y - cy)))
            blend(x, y, rgb, a)

white = (255, 255, 255); amber = (255, 196, 61)
# circuit traces
stroke([(40, 70), (96, 70), (96, 40)], 9, white)
stroke([(216, 186), (160, 186), (160, 216)], 9, white)
dot(96, 40, 11, white); dot(160, 216, 11, white); dot(40, 70, 9, white); dot(216, 186, 9, white)
# waveform
wave = [(48 + i * 1.6, 128 - 44 * math.sin(i * 1.6 / 160 * 2 * math.pi)) for i in range(101)]
stroke(wave, 12, amber)

raw = b''.join(b'\x00' + bytes(px[y * W * 4:(y + 1) * W * 4]) for y in range(H))
def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
open(sys.argv[1], 'wb').write(png)
print('icon written', sys.argv[1])
