"""Offline Liquid Glass compositor.

Takes a rendered background layer (bg.png), a transparent foreground layer (fg.png)
and panel geometry (geo.json, CSS px) and paints physically-inspired glass panels:
  - lens refraction concentrated in a convex bezel (centre stays clear)
  - per-channel displacement -> chromatic fringes at the rim
  - light frost + tint in the interior of text-bearing panels (legibility)
  - specular rim lit from the top-left, weaker counter-reflection bottom-right
  - soft neutral drop shadow
Usage: python3 liquid_glass.py <layer_dir> <scale> <out.png> [--only N]
"""
import json, sys
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates, gaussian_filter

layer_dir, S, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
only = int(sys.argv[sys.argv.index('--only') + 1]) if '--only' in sys.argv[:-1] else None

# ---- tunables (CSS px unless noted) ----
REFRACT = 1.5        # displacement at the very rim, as a fraction of bezel width
POWER = 2.0           # how fast displacement falls off inward (higher = tighter to edge)
DISPERSION = (1.0, 1.09, 1.19)   # R, G, B displacement multipliers -> rainbow fringe
FROST_SIGMA = 5.0     # interior blur for text panels
FROST_MIX = 0.62
CLEAR_SIGMA = 1.2     # tiny blur everywhere so the glass isn't razor-sharp
TINT = np.array([0.01, 0.06, 0.035]); TINT_MIX = 0.26   # dark emerald tint (text-bearing)
LIFT = 1.06           # brightness lift of the glass body
LIGHT = np.array([-0.55, -0.83])  # direction TO the light (top-left)

img = np.asarray(Image.open(f'{layer_dir}/bg.png').convert('RGB'), dtype=np.float32) / 255.0
fg = np.asarray(Image.open(f'{layer_dir}/fg.png').convert('RGBA'), dtype=np.float32) / 255.0
H, W, _ = img.shape
geo = json.load(open(f'{layer_dir}/geo.json'))

def rrect_sdf(px, py, cx, cy, hw, hh, r):
    qx = np.abs(px - cx) - (hw - r); qy = np.abs(py - cy) - (hh - r)
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def inside(a, b):  # panel a fully inside a strictly larger panel b?
    return a['w'] * a['h'] < b['w'] * b['h'] and a['x'] >= b['x'] and a['y'] >= b['y'] and a['x'] + a['w'] <= b['x'] + b['w'] and a['y'] + a['h'] <= b['y'] + b['h']

# pass 1: drop shadows. Panels refract the clean scene (never shadows or other panels' glass)
scene = img.copy()
base = img.copy()
for i, g in enumerate(geo):
    if only is not None and i != only:
        continue
    x, y, w, h, r = (g[k] * S for k in ('x', 'y', 'w', 'h', 'r'))
    if any(inside(g, o) for o in geo if o is not g):
        continue  # nested panels cast no shadow on the scene
    m = int(70 * S)
    x0, y0 = max(int(x) - m, 0), max(int(y) - m, 0)
    x1, y1 = min(int(x + w) + m + 1, W), min(int(y + h) + m + 1, H)
    if x1 <= x0 or y1 <= y0:
        continue
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32) + 0.5
    r = min(r, w / 2, h / 2)
    sdf = rrect_sdf(xx, yy, x + w / 2, y + h / 2, w / 2, h / 2, r)
    sh = rrect_sdf(xx, yy - 16 * S, x + w / 2, y + h / 2, w / 2, h / 2, r)
    shadow = gaussian_filter((sh < 0).astype(np.float32), 20 * S) * 0.38 * np.clip(sdf / (2 * S), 0, 1)
    base[y0:y1, x0:x1] *= (1 - shadow)[..., None]
img = base.copy()

# pass 2: glass
for i, g in enumerate(geo):
    if only is not None and i != only:
        continue
    nested = any(inside(g, o) for o in geo if o is not g)
    x, y, w, h, r = (g[k] * S for k in ('x', 'y', 'w', 'h', 'r'))
    # bezel scales with panel size so big panels get a proportionally thick lens
    B = max(g['bezel'], 0.07 * min(g['w'], g['h']), 1.0) * S
    frost = g['frost']
    m = int(70 * S)  # margin for shadow
    x0, y0 = max(int(x) - m, 0), max(int(y) - m, 0)
    x1, y1 = min(int(x + w) + m + 1, W), min(int(y + h) + m + 1, H)
    if x1 <= x0 or y1 <= y0:
        continue
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32) + 0.5
    cx, cy = x + w / 2, y + h / 2
    r = min(r, w / 2, h / 2)
    sdf = rrect_sdf(xx, yy, cx, cy, w / 2, h / 2, r)          # <0 inside (device px)

    region = img[y0:y1, x0:x1]

    # --- surface normal (outward) from SDF gradient ---
    gy, gx = np.gradient(sdf)
    gl = np.hypot(gx, gy) + 1e-6
    nx, ny = gx / gl, gy / gl
    d = np.clip(-sdf, 0, None)                                  # depth inside, px
    t = np.clip(d / B, 0, 1)                                    # 0 at rim -> 1 past bezel
    disp = REFRACT * B * (1 - t) ** POWER                       # displacement magnitude
    disp *= smoothstep(0.0, 0.25 * B, d)                        # fade to 0 at the very rim: no hard plugs

    src = img if nested else scene  # nested panels (logo lens) refract their parent glass; others only the scene
    srcb = gaussian_filter(src[y0:y1, x0:x1], sigma=(CLEAR_SIGMA * S, CLEAR_SIGMA * S, 0))
    frostb = gaussian_filter(src[y0:y1, x0:x1], sigma=(FROST_SIGMA * S, FROST_SIGMA * S, 0)) if frost else None

    out_rgb = np.empty_like(region)
    for c, k in enumerate(DISPERSION):
        # sample from OUTSIDE the rim: what lies just beyond the edge wraps around the bezel (lens look)
        sx = (xx - x0 - 0.5) + nx * disp * k
        sy = (yy - y0 - 0.5) + ny * disp * k
        ch = map_coordinates(srcb[..., c], [sy, sx], order=1, mode='nearest')
        if frost:
            fch = map_coordinates(frostb[..., c], [sy, sx], order=1, mode='nearest')
            wgt = smoothstep(0.0, 1.0, t) * FROST_MIX   # frost eases in across the whole bezel: no inner seam
            ch = ch * (1 - wgt) + fch * wgt
        out_rgb[..., c] = ch

    out_rgb *= LIFT
    if frost:
        tw = smoothstep(0.0, 1.0, t) * TINT_MIX
        out_rgb = out_rgb * (1 - tw[..., None]) + TINT * tw[..., None]

    # --- specular rim & bezel sheen ---
    facing = nx * LIGHT[0] + ny * LIGHT[1]                      # +1 where the rim faces the light
    key = np.clip(facing, 0, 1) ** 1.6
    back = np.clip(-facing, 0, 1) ** 2.2
    rim = np.exp(-d / (1.3 * S))                                # razor-thin edge line
    band = np.exp(-d / (B * 0.35))                              # broader bezel glow
    spec = rim * (0.30 + 0.70 * key + 0.45 * back) + band * (0.22 * key + 0.10 * back)
    inner = np.exp(-np.abs(d - 2.5 * S) / (0.8 * S)) * 0.18     # inner hairline
    out_rgb = out_rgb + (spec + inner)[..., None] * (1 - out_rgb) # screen-like add

    alpha = np.clip(-sdf + 0.5, 0, 1)[..., None]                # antialiased coverage
    img[y0:y1, x0:x1] = np.clip(region * (1 - alpha) + out_rgb * alpha, 0, 1)

# --- foreground (text, logo) on top ---
a = fg[..., 3:4]
img = img * (1 - a) + fg[..., :3] * a
Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(out)
print('saved', out, img.shape)
