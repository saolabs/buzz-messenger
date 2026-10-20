# Đổi mọi *.bmp trong skin Y!M sang *.png (cạnh file gốc). Màu magenta (255,0,255) là màu trong suốt
# của Y!M → alpha 0. Electron/Chromium không đọc được BMP qua nativeImage nên cần bước này.
# Chỉ hỗ trợ BMP không nén 8/24/32 bit (đủ cho skin Y!M 10).
# Dùng: python3 -I scripts/bmp_to_png.py <thư mục>
import os, struct, sys, zlib


def read_bmp(data):
    off, = struct.unpack_from("<I", data, 10)
    hsize, w, h, _, bpp, comp = struct.unpack_from("<IiiHHI", data, 14)
    if comp not in (0, 3) or bpp not in (8, 24, 32):
        return None
    palette = []
    if bpp == 8:
        n = struct.unpack_from("<I", data, 46)[0] or 256
        p = 14 + hsize
        palette = [tuple(data[p + 4 * i + 2 :: -1][:3]) for i in range(n)]
    rows, stride = abs(h), ((w * bpp + 31) // 32) * 4
    out = []
    for r in range(rows):
        y = rows - 1 - r if h > 0 else r
        line = data[off + y * stride : off + y * stride + stride]
        px = []
        for x in range(w):
            if bpp == 8:
                rgb = palette[line[x]]
            else:
                b, g, rr = line[x * bpp // 8 : x * bpp // 8 + 3]
                rgb = (rr, g, b)
            px.append(rgb + ((0,) if rgb == (255, 0, 255) else (255,)))
        out.append(px)
    return w, rows, out


def write_png(path, w, h, rows):
    raw = b"".join(b"\0" + bytes(c for px in row for c in px) for row in rows)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    open(path, "wb").write(png)


n = 0
for root, _, files in os.walk(sys.argv[1]):
    for f in files:
        if not f.lower().endswith(".bmp"):
            continue
        src = os.path.join(root, f)
        dst = src[:-4] + ".png"
        if os.path.exists(dst):  # skin đã có bản PNG cùng tên thì giữ bản đó
            continue
        img = read_bmp(open(src, "rb").read())
        if img:
            write_png(dst, *img)
            n += 1
print(n, "bmp → png")
