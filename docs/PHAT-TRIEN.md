# Phát triển Buzz! Messenger

[Về README](../README.vi.md) · [Định hướng và nhật ký](Y-TUONG.md)

Mục tiêu của dự án là mang lại cảm giác nhắn tin Yahoo! Messenger cho những người hoài niệm. Khi phát triển tính năng, ưu tiên những chi tiết tạo nên trải nghiệm đó: buddy list, cửa sổ chat, mặt cười, âm thanh và BUZZ!, cùng khả năng nhắn tin thực tế ổn định.

## Môi trường và lệnh

Dùng Node.js nhánh 22 LTS từ 22.13, npm và phiên desktop chạy được Electron. Tài nguyên runtime có sẵn trong `resources/ym/`. Python 3 chỉ cần khi trích xuất lại bộ cài; các script Python dùng thư viện chuẩn, bước tạo PNG icon chạy bằng Electron.

```sh
npm ci
npm run dev
```

Chạy dev/build không cần APK, bộ cài Yahoo hoặc `_extracted/`. Các kiểm tra mã nguồn không cần đăng nhập Facebook:

```sh
npm run typecheck
npm test
npm run build
```

`build` tạo bundle trong `out/`, chưa tạo bộ cài và không xác nhận chức năng đăng nhập/nhắn tin thực tế.

## Cấu trúc mã nguồn

| Vị trí | Trách nhiệm |
| --- | --- |
| `electron/main.ts` | Vòng đời app, cửa sổ danh bạ/chat, settings, IPC và giao thức tài nguyên `ymres://`. |
| `electron/preload.ts` | API `window.ym` nối giao diện React với main process. |
| `electron/messenger-service.ts` | Một tài khoản Facebook trong mỗi phiên: đăng nhập, danh bạ, đồng bộ, sự kiện tin mới, media và gửi tin. |
| `electron/browser.ts` | Quản lý Chromium nhúng, cookie, login/PIN, inbox, trang live và worker đọc/gửi. |
| `electron/vault.ts` | Đọc/ghi state mã hóa, bảo vệ khóa bằng `safeStorage`, tuần tự hóa thay đổi. |
| `src/core/messenger.ts` | Bộ đọc DOM Messenger và thao tác soạn/gửi theo ngữ nghĩa của trang. |
| `src/core/conversation.ts` | Đối soát inbox, gộp/sắp xếp lịch sử và nhận diện tin đến khi online. |
| `src/core/` | Kiểu dữ liệu, đăng nhập, PIN, readiness, URL, media, mã hóa, task pool và emoticon. |
| `src/renderer/buddy.tsx` | Màn hình đăng nhập, danh bạ, hồ sơ, status, lựa chọn skin/PIN. |
| `src/renderer/im.tsx` | Hội thoại, tab, tin đang gửi, media, âm báo và BUZZ!. |
| `src/renderer/skin.tsx`, `frame.tsx`, `styles.css` | Ảnh skin, 9-slice, khung cửa sổ và bố cục cổ điển. |
| `src/renderer/i18n.ts` | Chuỗi giao diện tiếng Việt và English. |
| `resources/ym/` | Skin, emoticon, âm thanh và icon runtime; Electron phục vụ cho React qua `ymres://`. |
| `scripts/` | Trích xuất bộ cài, chuyển SWF/BMP, tạo icon và chuẩn bị tài nguyên runtime. |
| `tests/` | Kiểm tra core, DOM fixture và vault. |

Các thành phần đọc/gửi Messenger và vault nằm trực tiếp trong repository. Ứng dụng không cần chạy thêm dịch vụ hoặc dự án khác của SaoLabs.

## Luồng hoạt động

### Đăng nhập và đồng bộ

1. Main mở vault rồi tạo `MessengerService`.
2. Renderer gọi API qua preload để đăng nhập. Service cập nhật tài khoản trong vault và yêu cầu `Browsers` mở Messenger.
3. Bộ đăng nhập thao tác trên trang Facebook; khi cần xác minh hoặc PIN, cửa sổ Messenger được hiện cho người dùng.
4. Khi đọc được inbox, service chuyển sang trạng thái đã đăng nhập và bắt đầu hai vòng đồng bộ.
5. Thay đổi được gộp vào vault rồi phát về renderer qua IPC.

Các giá trị hiện tại trong `messenger-service.ts`:

| Tham số | Giá trị |
| --- | --- |
| Chờ đăng nhập | 2 phút |
| Quét inbox | 5 giây giữa các lượt |
| Đọc hội thoại đang mở | 1 giây giữa các lượt |
| Lịch sử cục bộ | Tối đa 500 tin/hội thoại |
| Chờ thao tác gửi | 60 giây |

Vòng lặp đặt lịch sau khi tác vụ hoàn tất, nên các mốc trên không bảo đảm độ trễ nhận tin cố định. Cửa sổ chat đang mở dùng trang Messenger live riêng; worker dùng cho những thao tác nền cần trang tạm. Các lượt đọc cùng hội thoại được gộp để tránh chạy chồng.

Inbox đổi chỉ là tín hiệu cần đọc lại. `arrivedWhileOnline` so sánh tin chưa từng lưu, chiều gửi và thời gian với lúc đăng nhập; có xử lý tin cuối chưa có giờ khi đã biết lịch sử. Service còn có nhánh dự phòng dựa trên inbox chưa đọc khi đọc hội thoại thất bại. Không dùng riêng việc dòng thời gian tương đối đổi để quyết định bật cửa sổ.

### Gửi tin

Renderer hiển thị tin chờ gửi rồi gọi `MessengerService.send` qua IPC. `Browsers.send` ưu tiên trang live đã nằm đúng hội thoại; nếu không có trang phù hợp thì dùng đường worker. Tác vụ được tuần tự hóa theo hội thoại.

Trước khi gửi, `sendNative` kiểm tra phiên, mã hội thoại, người nhận và ô soạn. Sau thao tác gửi, app đọc lại để xác nhận tin mới xuất hiện trên đúng hội thoại. Không đọc định kỳ chen vào trang live đang gửi.

Mốc chờ 60 giây trả lỗi về giao diện; nó không bảo đảm tác vụ nền đã bị hủy hoặc tin chưa được gửi. Không tự gửi lại khi kết quả chưa chắc chắn. Người dùng cần kiểm tra Messenger trước khi thử lại.

### Vault và settings

- `settings.json` chứa tùy chỉnh giao diện tại `app.getPath("userData")`.
- `secure/` chứa vault mã hóa AES-256-GCM và khóa được bọc bởi `safeStorage`.
- Ghi vault qua tệp tạm rồi đổi tên; thay đổi không làm state khác đi thì không ghi lại.
- Vault có sẵn nhưng thiếu khóa hoặc không giải mã được phải báo lỗi, không tự đặt lại dữ liệu.
- Remember điều khiển việc giữ mật khẩu/cookie sau phiên; không phải cam kết rằng các giá trị đó chưa từng được ghi vào vault trong phiên.

Xem [dữ liệu và phiên đăng nhập](HUONG-DAN.md#du-lieu-va-phien-dang-nhap) để biết hành vi đối với người dùng.

## Tài nguyên giao diện

`resources/ym/` là vị trí tài nguyên runtime trong dự án Electron + React. Giữ bộ này cùng mã nguồn; `_extracted/` chỉ là đầu ra giải nén trung gian và được Git bỏ qua.

Để tạo lại, đặt bộ cài `10.0.0.1102_ymsgr1000_1102_us.exe` ở gốc dự án, cài Python 3 rồi chạy `npm run extract`. Lệnh này thực hiện tuần tự:

1. `extract_installer.py`: giải nén Wise Installer ra `_extracted/`, không thực thi `.exe`.
2. `swf_to_svg.py`: xuất các trạng thái logo đăng nhập từ `login.swf` thành SVG.
3. `bmp_to_png.py`: chuyển BMP skin sang PNG, đổi màu magenta thành trong suốt.
4. `brand_logo.py`: tạo bản icon chữ B từ logo.
5. `render-icon.mjs`: dùng Electron xuất icon PNG 1024×1024.
6. `prepare-assets.mjs`: copy skin, media hỗ trợ và icon vào `resources/ym/`, bỏ Flash/CAB, bộ cài và cơ sở dữ liệu thumbnail. Nếu các bước trích xuất/chuyển đổi đã xong, chỉ cần `npm run assets:prepare`.

Khi phát triển, main đọc `<project>/resources/ym/`. electron-builder copy cùng bộ này ra ngoài `app.asar`; trên macOS là `<app>.app/Contents/Resources/ym/`. Bản đóng gói đọc `process.resourcesPath/ym/`. Renderer React truy cập qua `ymres://skin/...` và `ymres://media/...`, không dùng đường dẫn tuyệt đối hoặc truy cập trực tiếp `_extracted/`. Không đặt bộ runtime trong `src/` hay `public/`, vì main process cần cắt sprite và phục vụ media.

Skin thường fallback theo thứ tự skin đã chọn → Default → Purple. Riêng lựa chọn Default đọc Purple trước rồi mới tới Default để giữ giao diện tím của Yahoo! Messenger. Sprite được cắt tại main process; renderer dùng CSS `border-image` theo lề 9-slice.

Không đưa APK, bộ cài, thư mục giải nén gốc hoặc dữ liệu tài khoản vào repository. `.gitignore` bỏ qua `*.apk`, `*.exe`, `_extracted/`, `node_modules/`, `out/` và `dist/`. Bộ runtime đã chọn lọc trong `resources/ym/` được giữ cùng dự án; nguồn tài nguyên Yahoo được ghi nhận ở README.

## Kiểm tra thay đổi

Mốc đối chiếu ngày **2026-10-21**: `typecheck`, **58 test** và `build` đều đạt. Số lượng test là ảnh chụp tại mốc này; dùng kết quả `npm test` để biết trạng thái mới nhất.

Các nhóm kiểm tra hiện có bao phủ:

- Đọc inbox/tin nhắn, định danh hội thoại, thời gian, media và nhận diện chặn tính năng qua DOM fixture.
- Login, PIN và điều kiện sẵn sàng trước khi đọc/gửi.
- Kiểm tra trước thao tác gửi: lệch hội thoại, ô soạn thủ công, modal và nút không phải nút gửi.
- Gộp lịch sử, phát hiện tin mới, đối soát inbox và emoticon.
- Hồ sơ Facebook, task pool và vault, gồm dữ liệu hỏng/mất khóa/thiếu kho khóa OS.

Fixture đạt không xác nhận DOM Messenger đang chạy ngoài thực tế. Với thay đổi ảnh hưởng tích hợp, kiểm tra thủ công bằng tài khoản thử được phép sử dụng: đăng nhập/khôi phục PIN, tải inbox, nhận tin, gửi tin, media, đăng xuất và mở lại. Kiểm tra người nhận trước khi gửi thử; không ghi mật khẩu, PIN, cookie hoặc nội dung hội thoại thật vào fixture/log báo lỗi.

## Đóng gói

Workflow [Build desktop release](../.github/workflows/release.yml) build Windows x64, Linux x64, Mac Intel và Mac Apple Silicon trên runner tương ứng, sau đó tạo draft Release chứa bộ cài và checksum. Xem [hướng dẫn phát hành](PHAT-HANH.md) để tạo tag, cấu hình ký ứng dụng và công bố tải về.

| Lệnh | Đầu ra cấu hình |
| --- | --- |
| `npm run dist:mac` | DMG, ZIP |
| `npm run dist:win` | NSIS, portable |
| `npm run dist:linux` | AppImage, DEB |

Các lệnh chạy build rồi dùng `electron-builder`; tài nguyên từ `resources/ym/` được copy vào gói. Có cấu hình target không có nghĩa đã kiểm tra được trên hệ điều hành đó hoặc có thể build chéo trong mọi môi trường. Hiện nhật ký mới ghi nhận thử ứng dụng trên macOS.

Trước khi phân phối công khai, cần giải quyết nguồn tài nguyên giao diện và giấy phép sử dụng; xem [ghi nhận và tài nguyên trong README](../README.vi.md#ghi-nhận-và-tài-nguyên).
