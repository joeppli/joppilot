#!/usr/bin/env python3
"""Jöppli camera placement - topdown SVG generator
"""
import math

# ---- parametreler -----------------------------------------------------------
S = 0.085          # px per mm
CANW, CANH = 1500, 1000
CX, CY = 575, 520  # araç merkezi (px)
L, W = 3500, 1360  # mm
R120 = 4000*S      # 120° yelpaze yarıçapı (şematik)
R60  = 5600*S      # 60° yelpaze yarıçapı (şematik)

# kamera tanımı: (isim, x_mm, y_sol_mm, bakış_açısı, fov, yarıçap, renk_grubu)
CAMS = [
    ("F-pink",  L/2,  0,     0,  60, R60,  "pink"),
    ("F-green", L/2,  0,     0, 120, R120, "green"),
    ("R-green",-L/2,  0,   180, 120, R120, "green"),
    ("FL",      L/2,  W/2,   80, 120, R120, "blue"),
    ("FR",      L/2, -W/2,  -80, 120, R120, "blue"),
    ("RL",     -L/2,  W/2,  100, 120, R120, "blue"),
    ("RR",     -L/2, -W/2, -100, 120, R120, "blue"),
]

COLORS = {  # (fill, fill-opacity, stroke)
    "pink":  ("#EE8CB2", 0.50, "#D4547F"),
    "green": ("#8CC88C", 0.45, "#4D9A4D"),
    "blue":  ("#6CC1E8", 0.42, "#2F88B5"),
}

TITLE   = "Jöppli - Camera Placement (Topdown)"
FRONT_LABEL = "Front ▶"
LEGEND = [
    ("pink",  "60° × 1 - CAM-FN"),
    ("green", "120° × 2 - CAM-FW · CAM-RW"),
    ("blue",  "120° × 4 - CAM-FL · FR · RL · RR"),
]
FOOTER = ("Viewing axes (vehicle frame, +x forward, +y left): FN/FW 0° · FL +80° · "
          "FR −80° · RL +100° · RR −100° · RW 180° · ≥ 40° overlap between adjacent FOVs")

# ---- yardımcılar ------------------------------------------------------------
def P(x_mm, y_left_mm):
    return (CX + x_mm*S, CY - y_left_mm*S)

def wedge(px, py, heading, fov, r, grp):
    f, o, s = COLORS[grp]
    a, b = heading - fov/2, heading + fov/2
    ax = px + r*math.cos(math.radians(a)); ay = py - r*math.sin(math.radians(a))
    bx = px + r*math.cos(math.radians(b)); by = py - r*math.sin(math.radians(b))
    return (f'<path d="M {px:.1f},{py:.1f} L {ax:.1f},{ay:.1f} '
            f'A {r:.1f},{r:.1f} 0 0 0 {bx:.1f},{by:.1f} Z" '
            f'fill="{f}" fill-opacity="{o}" stroke="{s}" stroke-opacity="0.7"/>')

def tick(px, py, heading, ln=30):
    dx = ln*math.cos(math.radians(heading)); dy = -ln*math.sin(math.radians(heading))
    return (f'<line x1="{px:.1f}" y1="{py:.1f}" x2="{px+dx:.1f}" y2="{py+dy:.1f}" '
            f'stroke="#1C1C1C" stroke-width="2"/>')

def label(x, y, t, anchor="middle", size=12.5, weight="bold", fill="#1C1C1C"):
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill}" text-anchor="{anchor}">{t}</text>')

# ---- çizim ------------------------------------------------------------------
hl, hw = L/2, W/2
F  = P(hl, 0);   Rr = P(-hl, 0)
FL = P(hl, hw);  FR = P(hl, -hw)
RL = P(-hl, hw); RR = P(-hl, -hw)

svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {CANW} {CANH}" '
       f'font-family="Helvetica, Arial, sans-serif">',
       f'<rect width="{CANW}" height="{CANH}" fill="#ffffff"/>']

# başlık (tek satır, alt başlık yok)
svg.append(label(40, 46, TITLE, "start", 24))

# yakın-alan kör halka (etiketsiz, salt çizgi)
ox, oy = (hl+1200)*S, (hw+1200)*S
svg.append(f'<rect x="{CX-ox:.1f}" y="{CY-oy:.1f}" width="{2*ox:.1f}" height="{2*oy:.1f}" '
           f'rx="{1200*S:.0f}" fill="none" stroke="#999999" stroke-width="1.5" '
           f'stroke-dasharray="7,6"/>')

# yelpazeler (mavi -> yeşil -> pembe)
for grp in ("blue", "green", "pink"):
    for _, x, y, hd, fov, r, g in CAMS:
        if g == grp:
            svg.append(wedge(*P(x, y), hd, fov, r, g))

# araç gövdesi
svg.append(f'<rect x="{CX-hl*S:.1f}" y="{CY-hw*S:.1f}" width="{L*S:.1f}" height="{W*S:.1f}" '
           f'rx="14" fill="#ffffff" stroke="#333333" stroke-width="2.5"/>')

# araç içi "Front" etiketi (ölçü okları yok)
svg.append(label(F[0]-60, CY-24, FRONT_LABEL, "start", 14, "bold", "#333333"))

# bakış yönü çizgileri (ok ucu yok)
for pt, hd in [(F,0),(FL,80),(FR,-80),(RL,100),(RR,-100),(Rr,180)]:
    svg.append(tick(*pt, hd))

# kamera noktaları
for pt in [F, FL, FR, RL, RR, Rr]:
    svg.append(f'<circle cx="{pt[0]:.1f}" cy="{pt[1]:.1f}" r="7" fill="#1C1C1C" '
               f'stroke="#ffffff" stroke-width="2"/>')

# etiketler
svg.append(label(F[0]+14,  F[1]+34, "CAM-FN + CAM-FW", "start"))
svg.append(label(F[0]+14,  F[1]+50, "(60° + 120°, 0°)", "start", 11, "normal"))
svg.append(label(FL[0],  FL[1]-18, "CAM-FL (120°, +80°)"))
svg.append(label(FR[0],  FR[1]+26, "CAM-FR (120°, −80°)"))
svg.append(label(RL[0],  RL[1]-18, "CAM-RL (120°, +100°)"))
svg.append(label(RR[0],  RR[1]+26, "CAM-RR (120°, −100°)"))
svg.append(label(Rr[0]-14, Rr[1]-12, "CAM-RW (120°, 180°)", "end"))

# lejant (kısa biçim)
LX, LY = 1160, 128
for i, (grp, txt) in enumerate(LEGEND):
    f, _, s = COLORS[grp]; y = LY + i*40
    svg.append(f'<circle cx="{LX}" cy="{y}" r="10" fill="{f}" fill-opacity="0.85" stroke="{s}"/>')
    svg.append(label(LX+22, y+5, txt, "start", 14.5, "normal"))

# dipnot (tek satır)
svg.append(label(40, 952, FOOTER, "start", 12, "normal", "#777777"))
svg.append('</svg>')

out = "\n".join(svg)
with open("joeppli_camera_placement_topdown.svg", "w") as fh:
    fh.write(out)
print("create SVG")

try:
    import cairosvg
    cairosvg.svg2png(url="joeppli_camera_placement_topdown.svg",
                     write_to="joeppli_camera_placement_topdown.png",
                     output_width=CANW, output_height=CANH)
    print("create PNG")
except Exception as e:
    print("PNG atlandi:", e)