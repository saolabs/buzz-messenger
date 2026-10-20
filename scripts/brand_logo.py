# Buzz! Messenger: tạo bản logo bong bóng của login.swf với chữ "B" thay chữ "Y" — chỉ dùng làm icon app
# (tránh thương hiệu Yahoo). Logo trên màn hình đăng nhập giữ nguyên chữ Y cho quen thuộc.
# Dùng: python3 -I scripts/brand_logo.py <logo.svg vào> <logo-b.svg ra>
import re, sys

# Chữ "Y" gốc: path trắng đầu tiên, hộp chữ x -1015..919, y -547..680 (đơn vị twip trong nhóm bong bóng).
TOP, BOTTOM, CENTER_X = -547, 680, -48
# Chữ "B" serif đậm, vẽ trong hộp cao 100: thân + chân serif, 2 bụng; lỗ trong dùng evenodd.
B = [
    "M0 0L54 0C74 0 84 10 84 24C84 36 76 44 64 47C80 50 92 59 92 74C92 91 78 100 56 100L0 100L0 91L12 91L12 9L0 9Z",
    "M30 9L50 9C60 9 64 15 64 25C64 36 58 42 48 42L30 42Z",
    "M30 52L52 52C64 52 70 60 70 71C70 83 63 91 51 91L30 91Z",
]


def b_path():
    s = (BOTTOM - TOP) / 100
    x0 = CENTER_X - 92 * s / 2

    def tf(m):
        nums = [float(v) for v in m.group(0).split()]
        return " ".join(f"{x0 + nums[i] * s:.0f} {TOP + nums[i + 1] * s:.0f}" for i in range(0, len(nums), 2))

    return "".join(re.sub(r"-?\d+(?:\.\d+)? -?\d+(?:\.\d+)?(?: -?\d+(?:\.\d+)? -?\d+(?:\.\d+)?)*", tf, p) for p in B)


src, dst = sys.argv[1], sys.argv[2]
svg = open(src).read()
# path trắng ngay sau bong bóng tím rgb(123,0,153) chính là chữ Y
new, count = re.subn(
    r'(<path d="[^"]*" fill="rgb\(123,0,153\)"[^>]*/>)<path d="[^"]*"( fill="rgb\(255,255,255\)"[^>]*/>)',
    lambda m: f'{m.group(1)}<path d="{b_path()}"{m.group(2)}',
    svg,
    count=1,
)
if not count:
    sys.exit("Không tìm thấy chữ Y trong logo.")
open(dst, "w").write(new)
print("logo B →", dst)
