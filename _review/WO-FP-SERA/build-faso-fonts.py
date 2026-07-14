import os
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.subset import Subsetter, Options

SB = "/tmp/claude-0/-home-user/4a38e8fa-225f-5cd8-9cf7-fa2d337ab965/scratchpad/fonts"
OUT = "/home/user/sera/apps/rider-app/assets/fonts"

# charset: basic Latin + Latin-1 (French accents, «», nbsp, °) + Œœ + curly quotes
# + dashes + ellipsis + arrows (← the back label) + narrow nbsp (defensive) + digits/space/F.
UNICODES = "U+0020-007E,U+00A0-00FF,U+0152-0153,U+2013-2014,U+2018-2019,U+201C-201D,U+2026,U+202F,U+2190-2192"

# face → (source var, {axis pins incl. target wght})  · opsz=40 display, wdth=100
FACES = [
    ("Bricolage-700", f"{SB}/Bricolage-var.ttf", {"wght":700,"opsz":40,"wdth":100}, 700),
    ("Bricolage-800", f"{SB}/Bricolage-var.ttf", {"wght":800,"opsz":40,"wdth":100}, 800),
    ("Instrument-400", f"{SB}/Instrument-var.ttf", {"wght":400,"wdth":100}, 400),
    ("Instrument-500", f"{SB}/Instrument-var.ttf", {"wght":500,"wdth":100}, 500),
    ("Instrument-600", f"{SB}/Instrument-var.ttf", {"wght":600,"wdth":100}, 600),
    ("Instrument-700", f"{SB}/Instrument-var.ttf", {"wght":700,"wdth":100}, 700),
]

def stamp_names(font, fam):
    name = font["name"]
    # wipe then set a clean, DISTINCT identity per weight (family=stem, subfamily=Regular)
    for plat,enc,lang in [(3,1,0x409),(1,0,0)]:
        name.setName(fam, 1, plat,enc,lang)   # family
        name.setName("Regular", 2, plat,enc,lang)  # subfamily
        name.setName(fam, 4, plat,enc,lang)   # full name
        name.setName(fam.replace(" ",""), 6, plat,enc,lang)  # postscript
        name.setName(fam, 16, plat,enc,lang)  # typographic family
        name.setName("Regular", 17, plat,enc,lang)  # typographic subfamily

for fam, src, pins, weight in FACES:
    f = TTFont(src)
    instantiateVariableFont(f, pins, inplace=True, updateFontNames=False)
    # subset (keep tnum + kern + default features so tabular money renders)
    opt = Options()
    opt.layout_features = ["*"]      # keep ALL features incl. tnum
    opt.name_IDs = ["*"]; opt.name_legacy = True; opt.name_languages = ["*"]
    opt.recalc_bounds = True; opt.recalc_timestamp = False
    opt.glyph_names = True; opt.notdef_outline = True; opt.drop_tables = []
    ss = Subsetter(options=opt)
    ss.populate(unicodes=[int(u[2:],16) if "-" not in u else None for u in []])  # placeholder
    # populate via unicode ranges
    codes = []
    for part in UNICODES.split(","):
        part = part[2:]  # strip U+
        if "-" in part:
            a,b = part.split("-"); codes += list(range(int(a,16), int(b,16)+1))
        else:
            codes.append(int(part,16))
    ss = Subsetter(options=opt)
    ss.populate(unicodes=codes)
    ss.subset(f)
    # truthful OS/2 weight class + a clean Regular style (native embed addresses by family)
    f["OS/2"].usWeightClass = weight
    f["OS/2"].fsSelection = (f["OS/2"].fsSelection & ~0b100001) | 0x40  # clear BOLD/ITALIC, set REGULAR
    f["head"].macStyle = 0
    # money separator is U+202F (narrow nbsp); Bricolage maps it, Instrument does
    # not. Map U+202F to the space glyph in any face lacking it so the money render
    # draws in EVERY weight (no tofu) — the WO's formatter-emits-what-font-lacks law.
    for tbl in f['cmap'].tables:
        if 0x202F not in tbl.cmap:
            sp = tbl.cmap.get(0x00A0) or tbl.cmap.get(0x0020)
            if sp is not None: tbl.cmap[0x202F] = sp
    stamp_names(f, fam)
    out = f"{OUT}/{fam}.ttf"
    f.save(out)
    print(f"  built {fam}.ttf  wght={weight}  {os.path.getsize(out)} bytes")

print("done")
