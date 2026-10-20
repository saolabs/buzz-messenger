# Giải nén bộ cài Y!M (Wise Installer) ra cây thư mục gốc, không chạy file .exe.
# Dùng: python3 -I scripts/extract_installer.py <ymsgr.exe> <thư mục ra>
# Wise lưu mỗi file thành một luồng raw-deflate + CRC32; script cài đặt (cũng là một luồng)
# ghi đường dẫn đích, trước mỗi đường dẫn 28 byte là size và 4 byte là CRC → ghép theo (crc, size).
import os, re, struct, sys, zlib

src, out = sys.argv[1], sys.argv[2]
d = open(src, 'rb').read()

# Bỏ qua phần stub Wise ở đầu: quét từ sau chuỗi 'WiseMain' để tránh luồng giả.
streams, p = [], d.find(b'WiseMain')
while p < len(d) - 8:
    z = zlib.decompressobj(-15)
    try:
        buf = z.decompress(d[p:p + 64 * 1024 * 1024])
    except zlib.error:
        p += 1
        continue
    if not z.eof or len(buf) < 16:
        p += 1
        continue
    streams.append(buf)
    used = min(len(d) - p, 64 * 1024 * 1024) - len(z.unused_data)
    p += used + (4 if d[p + used:p + used + 4] == zlib.crc32(buf).to_bytes(4, 'little') else 0)

script = next(s for s in streams if b'%MAINDIR%\\INSTALL.LOG' in s)
idx = {(zlib.crc32(s), len(s)): s for s in streams}
n = 0
for m in re.finditer(rb'%[A-Z0-9_]+%\\[\x20-\x7e]{2,}', script):
    q, name = m.start(), m.group().decode('latin1')
    if '*' in name or q < 40:
        continue
    size, crc = struct.unpack('<I', script[q - 28:q - 24])[0], struct.unpack('<I', script[q - 4:q])[0]
    buf = idx.get((crc, size))
    if buf is None:
        continue
    dst = os.path.join(out, name.replace('%MAINDIR%', 'Messenger').replace('%', '_').replace('\\', '/'))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, 'wb').write(buf)
    n += 1
print(len(streams), 'streams,', n, 'files named')
