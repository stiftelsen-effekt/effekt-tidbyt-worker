load("render.star", "render")

BG = "#050816"
FG = "#ffffff"
ACCENT = "#55ff66"
ACCENT2 = "#00d1ff"
ACCENT3 = "#ffcc00"
ACCENT4 = "#ff4bd8"

# 11x11 coin pixel art (two variants for a "shine" effect)
COIN_A = [
    "   ooooo   ",
    "  offfffo  ",
    " offffffho ",
    " offffffho ",
    " offffffho ",
    " offffffho ",
    " offffffho ",
    " offffffho ",
    "  offfffo  ",
    "   ooooo   ",
    "           ",
]
COIN_B = [
    "   ooooo   ",
    "  offfffo  ",
    " ohffffffo ",
    " ohffffffo ",
    " ohffffffo ",
    " ohffffffo ",
    " ohffffffo ",
    " ohffffffo ",
    "  offfffo  ",
    "   ooooo   ",
    "           ",
]
COIN_SMALL = [
    "  oooo  ",
    " offfo  ",
    " offhfo ",
    " offhfo ",
    " offhfo ",
    " offhfo ",
    "  offo  ",
    "  oooo  ",
    "        ",
]

STAR = [
    " x ",
    "xxx",
    " x ",
]

def _to_int(s, default):
    if s == None:
        return default
    ss = str(s)
    if ss == "":
        return default
    for i in range(len(ss)):
        ch = ss[i : i + 1]
        if ch < "0" or ch > "9":
            return default
    return int(ss)

def _fmt_amount(n):
    s = str(n)
    out = ""
    for i in range(len(s)):
        if i != 0 and (len(s) - i) % 3 == 0:
            out += " "
        out += s[i]
    return out

def _px(x, y, color):
    return render.Padding(
        pad=(x, y, 0, 0),
        child=render.Box(width=1, height=1, color=color),
    )

def _pattern_at(pattern, x0, y0, colors):
    pixels = []
    y = 0
    for row in pattern:
        for x in range(len(row)):
            ch = row[x : x + 1]
            if ch != " ":
                c = colors.get(ch)
                if c != None:
                    pixels.append(_px(x0 + x, y0 + y, c))
        y += 1
    return render.Stack(children=pixels) if len(pixels) > 0 else render.Box(width=1, height=1)

def _corner_label(country):
    txt = render.Text(content=country, font="tb-8", color="#cfd6ff")
    w, h = txt.size()

    pad = 1
    box_w = w + pad * 2
    box_h = h + pad * 2
    label_bg = "#050816cc"

    x = 0
    y = 32 - box_h

    return render.Padding(
        pad=(x, y, 0, 0),
        child=render.Box(
            width=box_w,
            height=box_h,
            color=label_bg,
            padding=pad,
            child=txt,
        ),
    )

def _amount_drop_top_right(line1, frame):
    txt = render.Text(content=line1, font="tb-8", color=FG)
    w, h = txt.size()

    pad_right = 1
    final_y = 2
    start_y = -h - 4
    y = start_y + min(final_y - start_y, frame * 2)

    x = 64 - w - pad_right
    if x < 0:
        x = 0

    return render.Padding(pad=(x, y, 0, 0), child=txt)

def _batch_count_label(count):
    txt = render.Text(content="(%d)" % count, font="tom-thumb", color="#cfd6ff")
    w, h = txt.size()

    pad = 1
    box_w = w + pad * 2
    box_h = h + pad * 2 + 1
    label_bg = "#050816cc"

    x = 64 - box_w
    y = 32 - box_h
    if x < 0:
        x = 0
    if y < 0:
        y = 0

    return render.Padding(
        pad=(x, y, 0, 0),
        child=render.Box(
            width=box_w,
            height=box_h,
            color=label_bg,
            padding=pad,
            child=render.Padding(pad=(0, 1, 0, 0), child=txt),
        ),
    )

def _sparkles(i, x0, y0):
    colors = [ACCENT2, ACCENT3, ACCENT4, ACCENT]
    spots = [
        (x0 - 6, y0 - 2),
        (x0 + 14, y0 - 1),
        (x0 - 4, y0 + 12),
        (x0 + 16, y0 + 10),
        (x0 + 6, y0 - 6),
        (x0 + 6, y0 + 16),
    ]

    children = []
    idx = 0
    for (sx, sy) in spots:
        phase = (i + idx * 2) % 14
        if phase < 3:
            children.append(_pattern_at(STAR, sx, sy, {"x": colors[idx % len(colors)]}))
        idx += 1

    for j in range(10):
        x = (x0 + 5 + (i * 3) + j * 11) % 64
        y = (y0 - 12 + i * 2 + j * 7) % 44
        y = y - 10
        if y >= 0 and y < 32 and ((i + j * 5) % 9) < 4:
            children.append(_px(x, y, colors[j % len(colors)]))

    return render.Stack(children=children) if len(children) > 0 else render.Box(width=1, height=1)

def main(config):
    count = _to_int(config.get("count"), 1)
    total = _to_int(config.get("sum"), 0)
    country = (config.get("country") or "??").upper()

    line1 = "%s kr" % _fmt_amount(total)

    frames = []
    for i in range(60):
        pop = i < 10
        y_bounce = 0
        if pop:
            y_bounce = 6 - (i // 2)
        coin_x = 10
        coin_y = 11 + y_bounce

        coin_pattern = COIN_A if (i // 2) % 2 == 0 else COIN_B
        if pop and i < 4:
            coin_pattern = COIN_SMALL

        frames.append(
            render.Stack(
                children=[
                    render.Box(width=64, height=32, color=BG),
                    _sparkles(i, coin_x, coin_y),
                    _corner_label(country),
                    _pattern_at(
                        coin_pattern,
                        coin_x,
                        coin_y,
                        {
                            "o": "#ffb000",
                            "f": "#ffd45a",
                            "h": "#fff6c7",
                        },
                    ),
                    _amount_drop_top_right(line1, i),
                    _batch_count_label(count) if count > 1 else render.Box(width=1, height=1),
                ],
            )
        )

    return render.Root(
        delay=80,
        show_full_animation=True,
        child=render.Animation(children=frames),
    )

