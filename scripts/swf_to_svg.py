# Vẽ một khung hình của file SWF (Flash) ra SVG. Đủ cho login.swf của Y!M 10:
# DefineShape 1/2/3 (màu đặc, gradient tuyến tính/tròn, nét viền), DefineSprite, PlaceObject2
# (matrix, color transform, clip depth). Không hỗ trợ bitmap, chữ, morph shape.
# Dùng: python3 -I scripts/swf_to_svg.py <file.swf> <thư mục ra>  → <nhãn khung>.svg cho mỗi FrameLabel
import os, struct, sys, zlib


class Bits:
    def __init__(self, data, pos=0):
        self.d, self.p, self.bit = data, pos, 0

    def align(self):
        if self.bit:
            self.p, self.bit = self.p + 1, 0

    def ub(self, n):
        v = 0
        for _ in range(n):
            v = (v << 1) | ((self.d[self.p] >> (7 - self.bit)) & 1)
            self.bit += 1
            if self.bit == 8:
                self.p, self.bit = self.p + 1, 0
        return v

    def sb(self, n):
        v = self.ub(n)
        return v - (1 << n) if n and v & (1 << (n - 1)) else v

    def fb(self, n):
        return self.sb(n) / 65536

    def u8(self):
        self.align()
        self.p += 1
        return self.d[self.p - 1]

    def u16(self):
        self.align()
        self.p += 2
        return struct.unpack_from("<H", self.d, self.p - 2)[0]

    def rect(self):
        n = self.ub(5)
        r = [self.sb(n) for _ in range(4)]  # xmin xmax ymin ymax
        self.align()
        return r

    def matrix(self):
        self.align()
        a = d = 1.0
        b = c = 0.0
        if self.ub(1):
            n = self.ub(5)
            a, d = self.fb(n), self.fb(n)
        if self.ub(1):
            n = self.ub(5)
            b, c = self.fb(n), self.fb(n)
        n = self.ub(5)
        e, f = self.sb(n), self.sb(n)
        self.align()
        return (a, b, c, d, e, f)

    def cxform(self, alpha):
        self.align()
        has_add, has_mult = self.ub(1), self.ub(1)
        n = self.ub(4)
        k = 4 if alpha else 3
        mult = [self.sb(n) / 256 for _ in range(k)] if has_mult else [1.0] * k
        add = [self.sb(n) for _ in range(k)] if has_add else [0] * k
        self.align()
        if not alpha:
            mult, add = mult + [1.0], add + [0]
        return tuple(mult), tuple(add)

    def color(self, alpha):
        self.align()
        c = self.d[self.p : self.p + (4 if alpha else 3)]
        self.p += len(c)
        return tuple(c) + (() if alpha else (255,))


def tags(data, pos, end):
    while pos < end:
        h = struct.unpack_from("<H", data, pos)[0]
        t, n = h >> 6, h & 0x3F
        pos += 2
        if n == 0x3F:
            n = struct.unpack_from("<I", data, pos)[0]
            pos += 4
        yield t, pos, n
        pos += n
        if t == 0:
            return


def rgba(c):
    return f"rgb({c[0]},{c[1]},{c[2]})", c[3] / 255


def fmt(v):
    return f"{v:.3f}".rstrip("0").rstrip(".")


class Shape:
    def __init__(self, data, pos, tag):
        alpha = tag == 32
        r = Bits(data, pos)
        self.id = r.u16()
        x0, x1, y0, y1 = r.rect()
        self.bounds = [(x0, y0), (x1, y0), (x0, y1), (x1, y1)]
        groups = []  # mỗi lần NewStyles là một nhóm style mới

        def styles():
            fills, lines = [], []
            n = r.u8()
            if n == 0xFF and tag != 2:
                n = r.u16()
            for _ in range(n):
                kind = r.u8()
                if kind == 0:
                    fills.append(("solid", r.color(alpha)))
                elif kind in (0x10, 0x12, 0x13):
                    m = r.matrix()
                    r.align()
                    head = r.u8()
                    stops = [(r.u8(), r.color(alpha)) for _ in range(head & 0x0F)]
                    if kind == 0x13:
                        r.u16()
                    fills.append(("linear" if kind == 0x10 else "radial", m, stops))
                else:  # bitmap fill: không có trong login.swf
                    r.u16()
                    r.matrix()
                    fills.append(("solid", (0, 0, 0, 0)))
            n = r.u8()
            if n == 0xFF and tag != 2:
                n = r.u16()
            for _ in range(n):
                w = r.u16()
                lines.append((w, r.color(alpha)))
            r.align()
            nb = r.u8()
            return fills, lines, nb >> 4, nb & 0x0F

        fills, lines, fbits, lbits = styles()
        groups.append((fills, lines, {}, {}))
        x = y = 0
        f0 = f1 = ln = 0
        while True:
            if r.ub(1) == 0:
                new, sl, s1, s0, mv = (r.ub(1) for _ in range(5))
                if not (new or sl or s1 or s0 or mv):
                    break
                if mv:
                    n = r.ub(5)
                    x, y = r.sb(n), r.sb(n)
                if s0:
                    f0 = r.ub(fbits)
                if s1:
                    f1 = r.ub(fbits)
                if sl:
                    ln = r.ub(lbits)
                if new:
                    fills, lines, fbits, lbits = styles()
                    groups.append((fills, lines, {}, {}))
                    f0 = f1 = ln = 0
                continue
            straight = r.ub(1)
            n = r.ub(4) + 2
            if straight:
                if r.ub(1):
                    dx, dy = r.sb(n), r.sb(n)
                elif r.ub(1):
                    dx, dy = 0, r.sb(n)
                else:
                    dx, dy = r.sb(n), 0
                edge = ((x, y), None, (x + dx, y + dy))
            else:
                cx, cy = x + r.sb(n), y + r.sb(n)
                ax, ay = cx + r.sb(n), cy + r.sb(n)
                edge = ((x, y), (cx, cy), (ax, ay))
            _, _, fe, le = groups[-1]
            if f1:
                fe.setdefault(f1, []).append(edge)
            if f0:  # fill0 nằm bên trái cạnh → đảo chiều cạnh
                fe.setdefault(f0, []).append((edge[2], edge[1], edge[0]))
            if ln:
                le.setdefault(ln, []).append(edge)
            x, y = edge[2]
        self.groups = groups

    def svg(self, defs, uid):
        out = []
        for fills, lines, fe, le in self.groups:
            for idx, edges in fe.items():
                style = fills[idx - 1]
                d = path_of(chain(edges))
                if style[0] == "solid":
                    color, op = rgba(style[1])
                    out.append(f'<path d="{d}" fill="{color}" fill-opacity="{fmt(op)}" fill-rule="evenodd"/>')
                else:
                    gid = f"g{uid()}"
                    a, b, c, dd, e, f = style[1]
                    stops = "".join(
                        f'<stop offset="{fmt(o / 255)}" stop-color="{rgba(col)[0]}" stop-opacity="{fmt(rgba(col)[1])}"/>'
                        for o, col in style[2]
                    )
                    tf = f'gradientUnits="userSpaceOnUse" gradientTransform="matrix({fmt(a)} {fmt(b)} {fmt(c)} {fmt(dd)} {fmt(e)} {fmt(f)})"'
                    if style[0] == "linear":
                        defs.append(f'<linearGradient id="{gid}" {tf} x1="-16384" y1="0" x2="16384" y2="0">{stops}</linearGradient>')
                    else:
                        defs.append(f'<radialGradient id="{gid}" {tf} cx="0" cy="0" r="16384">{stops}</radialGradient>')
                    out.append(f'<path d="{d}" fill="url(#{gid})" fill-rule="evenodd"/>')
            for idx, edges in le.items():
                w, col = lines[idx - 1]
                color, op = rgba(col)
                d = path_of([[e] for e in edges])
                out.append(
                    f'<path d="{d}" fill="none" stroke="{color}" stroke-opacity="{fmt(op)}" stroke-width="{max(w, 20)}" stroke-linecap="round" stroke-linejoin="round"/>'
                )
        return "".join(out)


def compose(p, c):
    # matrix SVG (a b c d e f): áp c trước rồi tới p
    return (
        p[0] * c[0] + p[2] * c[1],
        p[1] * c[0] + p[3] * c[1],
        p[0] * c[2] + p[2] * c[3],
        p[1] * c[2] + p[3] * c[3],
        p[0] * c[4] + p[2] * c[5] + p[4],
        p[1] * c[4] + p[3] * c[5] + p[5],
    )


def chain(edges):
    # Nối các cạnh rời thành vòng kín theo điểm đầu/cuối.
    pending = list(edges)
    loops = []
    while pending:
        loop = [pending.pop()]
        while loop[-1][2] != loop[0][0]:
            nxt = next((i for i, e in enumerate(pending) if e[0] == loop[-1][2]), None)
            if nxt is None:
                break
            loop.append(pending.pop(nxt))
        loops.append(loop)
    return loops


def path_of(loops):
    parts = []
    for loop in loops:
        parts.append(f"M{loop[0][0][0]} {loop[0][0][1]}")
        for _, c, a in loop:
            parts.append(f"Q{c[0]} {c[1]} {a[0]} {a[1]}" if c else f"L{a[0]} {a[1]}")
    return "".join(parts)


class Movie:
    def __init__(self, data):
        if data[:3] == b"CWS":
            data = data[:8] + zlib.decompress(data[8:])
        self.data = data
        r = Bits(data, 8)
        self.stage = r.rect()
        self.chars = {}  # id → Shape | (vị trí, độ dài) của sprite
        self.root = []
        pos = r.p + 4
        for t, p, n in tags(data, pos, len(data)):
            if t in (2, 22, 32):
                s = Shape(data, p, t)
                self.chars[s.id] = s
            elif t == 39:
                sid = struct.unpack_from("<H", data, p)[0]
                self.chars[sid] = ("sprite", p + 4, p + n)
            self.root.append((t, p, n))

    def frames(self, tag_list):
        # Diễn giải timeline → danh sách display list (depth → đối tượng) cho từng khung.
        display, out, label = {}, [], None
        labels = {}
        for t, p, n in tag_list:
            if t == 26:
                r = Bits(self.data, p)
                flags = r.u8()
                depth = r.u16()
                obj = dict(display.get(depth, {})) if flags & 1 else {}
                if flags & 0x02:
                    obj = {"char": r.u16()} if not flags & 1 else {**obj, "char": r.u16()}
                if flags & 0x04:
                    obj["m"] = r.matrix()
                if flags & 0x08:
                    obj["cx"] = r.cxform(True)
                if flags & 0x10:
                    r.u16()
                if flags & 0x20:
                    end = self.data.index(b"\0", r.p)
                    r.p = end + 1
                if flags & 0x40:
                    obj["clip"] = r.u16()
                display[depth] = obj
            elif t == 28:
                display.pop(struct.unpack_from("<H", self.data, p)[0], None)
            elif t == 43:
                labels[self.data[p : self.data.index(b"\0", p)].decode()] = len(out)
            elif t == 1:
                out.append(dict(display))
        return out, labels

    def render(self, frame_list, defs, uid, depth=0, mat=(1, 0, 0, 1, 0, 0), box=None):
        if depth > 8 or not frame_list:
            return ""
        items = sorted(frame_list.items())
        out, clip_until, clip_open = [], None, False
        for d, obj in items:
            if clip_open and d > clip_until:
                out.append("</g>")
                clip_open = False
            ch = self.chars.get(obj.get("char"))
            if ch is None:
                continue
            m = obj.get("m", (1, 0, 0, 1, 0, 0))
            here = compose(mat, m)
            if isinstance(ch, Shape):
                inner = ch.svg(defs, uid)
                if box is not None and "clip" not in obj:
                    box.extend((here[0] * x + here[2] * y + here[4], here[1] * x + here[3] * y + here[5]) for x, y in ch.bounds)
            else:
                sprite_frames = self.frames(list(tags(self.data, ch[1], ch[2])))[0]
                inner = self.render(sprite_frames[0] if sprite_frames else {}, defs, uid, depth + 1, here, box)
            a, b, c, dd, e, f = m
            attrs = f' transform="matrix({fmt(a)} {fmt(b)} {fmt(c)} {fmt(dd)} {fmt(e)} {fmt(f)})"'
            if "cx" in obj:
                (rm, gm, bm, am), (ra, ga, ba, aa) = obj["cx"]
                if (rm, gm, bm, ra, ga, ba) == (1, 1, 1, 0, 0, 0) and aa == 0:
                    attrs += f' opacity="{fmt(max(0, min(1, am)))}"'
                else:
                    fid = f"c{uid()}"
                    defs.append(
                        f'<filter id="{fid}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="'
                        f'{fmt(rm)} 0 0 0 {fmt(ra / 255)} 0 {fmt(gm)} 0 0 {fmt(ga / 255)} 0 0 {fmt(bm)} 0 {fmt(ba / 255)} 0 0 0 {fmt(am)} {fmt(aa / 255)}"/></filter>'
                    )
                    attrs += f' filter="url(#{fid})"'
            if "clip" in obj:
                cid = f"k{uid()}"
                defs.append(f'<clipPath id="{cid}"><g{attrs}>{inner}</g></clipPath>')
                out.append(f'<g clip-path="url(#{cid})">')
                clip_until, clip_open = obj["clip"], True
                continue
            out.append(f"<g{attrs}>{inner}</g>")
        if clip_open:
            out.append("</g>")
        return "".join(out)


def main():
    src, out_dir = sys.argv[1], sys.argv[2]
    movie = Movie(open(src, "rb").read())
    frames, labels = movie.frames(movie.root)
    os.makedirs(out_dir, exist_ok=True)
    counter = iter(range(10**9))
    view = None
    for label, index in sorted(labels.items(), key=lambda kv: kv[1]):
        defs, box = [], []
        body = movie.render(frames[index], defs, lambda: next(counter), box=box)
        # Cắt khung sát hình (sân khấu SWF rộng hơn logo), đơn vị twip = 1/20 px. Mọi khung dùng chung
        # khung của khung đầu để hình không xê dịch khi chuyển trạng thái.
        view = view or (min(x for x, _ in box), min(y for _, y in box), max(x for x, _ in box), max(y for _, y in box))
        x0, y0, x1, y1 = view
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{fmt(x0)} {fmt(y0)} {fmt(x1 - x0)} {fmt(y1 - y0)}" '
            f'width="{fmt((x1 - x0) / 20)}" height="{fmt((y1 - y0) / 20)}"><defs>{"".join(defs)}</defs>{body}</svg>'
        )
        open(os.path.join(out_dir, f"{label}.svg"), "w").write(svg)
        print(label, f"frame {index}", f"{len(svg)} bytes")


if __name__ == "__main__":
    main()
