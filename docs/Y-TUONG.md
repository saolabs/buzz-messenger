# Buzz! Messenger — Ý tưởng & quyết định

Mang lại trải nghiệm nhắn tin trên Yahoo! Messenger cho những ai đang hoài niệm về một thời để nhớ: danh sách bạn bè, những mặt cười quen thuộc, tiếng báo tin nhắn và một cú BUZZ! làm rung cửa sổ.

Ứng dụng desktop tái hiện Yahoo! Messenger, dùng Facebook Messenger cá nhân để tiếp tục những cuộc trò chuyện hôm nay.

## Đọc tài liệu này

Đây là nơi lưu quyết định và nhật ký triển khai, gồm cả những cách làm đã được thay thế. Các mục “Bản xem trước” và “Sửa lượt…” ghi lại từng giai đoạn, không phải tất cả đều mô tả bản hiện tại.

- [README](../README.vi.md): giới thiệu dự án, tính năng và cách chạy.
- [Hướng dẫn sử dụng](HUONG-DAN.md): hành vi hiện tại và xử lý sự cố.
- [Phát triển](PHAT-TRIEN.md): kiến trúc, đồng bộ, tài nguyên và kiểm tra.

Mốc đối chiếu **2026-10-21**: đã nối Messenger thật; có ảnh, sticker và tin thoại; inbox quét mỗi 5 giây, hội thoại đang mở đọc mỗi 1 giây giữa các lượt. Typecheck, 58 test và build đều đạt. Lượt đối chiếu này không thực hiện đăng nhập Facebook thật mới; các lần thử thật trước đó được ghi trong nhật ký bên dưới.

## Tài nguyên runtime và đóng gói (2026-10-21)

- Tài nguyên cần cho app được đưa vào `resources/ym/`, giữ cùng dự án và dùng cho cả dev lẫn dist.
- React lấy ảnh/âm thanh qua `ymres://`; bản đóng gói đọc `process.resourcesPath/ym/`.
- `_extracted/` là thư mục giải nén trung gian; APK, bộ cài và `_extracted/` đều được Git bỏ qua.
- `npm run extract` chuẩn bị lại cả bộ runtime; `npm run assets:prepare` copy tài nguyên từ kết quả giải nén/chuyển đổi đã có.
- Các đường dẫn `_extracted/` trong nhật ký cũ bên dưới mô tả quá trình tạo tài nguyên, không còn là vị trí runtime.

## Tên & thương hiệu (2026-10-20)

- **Tên app:**
  - Tên hiển thị: **Buzz! Messenger**
  - appId: `com.saolabs.buzz-messenger`
  - Tên package: `buzz-messenger`
  - Repo: `github.com/saolabs/buzz-messenger` (đã đổi git remote)
  - Thư mục local: `buzz-messenger/` (đổi từ `yahoo-messenger/`).
- **Icon app:** bong bóng + mặt cười vàng của `login.swf`, **đổi chữ "Y" thành "B"** để không dùng thương hiệu Yahoo.
  - `scripts/brand_logo.py` tạo `_extracted/icon.svg`, thay path chữ Y bằng chữ B serif đậm vẽ tay.
  - `scripts/render-icon.mjs` (Electron) xuất `_extracted/icon.png` 1024px. electron-builder tự đổi sang icns/ico cho từng hệ điều hành.
  - Cả hai đều nằm trong `npm run extract`.
- **Giữ nguyên "Y!" cho quen thuộc:** logo ở màn hình đăng nhập và logo chữ "YAHOO! MESSENGER" trên thanh tiêu đề.
- **Nguồn tài nguyên:** bong bóng, mặt cười, skin, emoticon và âm thanh vẫn là tài nguyên của Yahoo; đổi chữ trên icon không thay đổi nguồn gốc. Hướng phát hành công khai cần bộ tài nguyên có quyền sử dụng phù hợp hoặc được vẽ lại.
- Thư mục dữ liệu người dùng đổi theo tên app; settings/vault cũ ở thư mục `yahoo-messenger` không còn được dùng.

## Đã chốt

- **Mục tiêu:** mang lại cảm giác nhắn tin Yahoo Messenger cho những người hoài niệm về một thời để nhớ, qua buddy list, trạng thái, BUZZ!, cửa sổ chat riêng, emoticon và âm thanh. Ưu tiên sự quen thuộc và những cuộc trò chuyện thực tế.
- **Hướng A:** app desktop có giao diện Yahoo Messenger, còn dữ liệu là Facebook Messenger cá nhân. Không có server riêng.
- **Cách triển khai:** Electron nhúng Chromium, đọc/gửi qua DOM Messenger, vault mã hóa trên máy.

- **Code:** bộ đọc/gửi Messenger và vault nằm trực tiếp trong repository, chưa tách thành package riêng.
- **AI:** có thì tốt, không bắt buộc. Ưu tiên sau giao diện.
- **Ưu tiên số 1:** giao diện giống **Yahoo! Messenger**:
  - Tông tím.
  - Buddy list có ô tìm kiếm, avatar cạnh tên, hai tab Contacts / **Y! Updates**.
  - Y! Updates dùng làm nhật ký hoạt động lấy từ inbox: ai vừa nhắn, và khi đã có presence thì thêm ai vừa online/offline.
  - Cửa sổ chat: **mặc định mỗi người một cửa sổ riêng**, mở nhiều cửa sổ cùng lúc được, xếp so le. Bật "Xem → Gom hội thoại thành tab" thì gom vào một cửa sổ (kiểu Y!M 9/10). Ở chế độ tab, nhấp đúp vào tab hoặc chọn "Hội thoại → Tách ra cửa sổ riêng" để tách một người ra cửa sổ riêng.
  - Bỏ khung quảng cáo.
- **Skin:** hỗ trợ đổi giữa 12 skin gốc. Giao diện đọc ảnh/màu/font từ thư mục skin, không viết cứng cho Default. Vì cả 12 skin cùng cấu trúc file nên làm xong một skin là có đủ 12.
- **Emoticon Yahoo:** có bảng mã (`:))`, `=))`, `:-*`, `>:D<`, …). App tự chuyển mã thành icon Yahoo.

## Emoticon — nguyên tắc

- Gửi đi **mã dạng văn bản** (vd. `:))`). Người dùng Messenger bên kia thấy chữ. Trong app mình, cả tin gửi lẫn tin nhận đều hiện thành icon.
- Tách mã theo **khớp dài nhất trước**: `:))` phải được nhận trước `:)`, `>:D<` trước `:D`. Không chuyển mã nằm trong URL.
- Messenger có thể tự đổi một số mã (vd. `:)`) thành emoji. Cần kiểm tra trên DOM thật; nếu đúng vậy thì cần thêm bảng ánh xạ ngược emoji → icon Yahoo.

## Tài nguyên trích từ bộ cài Y!M 10.0.0.1102

Nguồn: `10.0.0.1102_ymsgr1000_1102_us.exe` (bản offline, 17 MB, dạng Wise Installer). Chỉ giải nén, không chạy file.

```sh
python3 -I scripts/extract_installer.py 10.0.0.1102_ymsgr1000_1102_us.exe _extracted
```

- Kết quả: 1126 file, tên và đường dẫn gốc được khôi phục theo CRC/size ghi trong script cài đặt. Đã kiểm tra: 0 file sai định dạng.
- `*.exe` và `_extracted/` đã cho vào `.gitignore` vì thuộc bản quyền Yahoo, chỉ dùng cá nhân.

| Thư mục (trong `_extracted/Messenger/`) | Nội dung |
|---|---|
| `Media/Smileys/emoticons.xml` | **Bảng mã emoticon chính thức**: 95 icon, mỗi icon có `id`, `title`, danh sách `shortcut`. Các shortcut `network="2"` là mã MSN/Live, dùng khi chat liên mạng. |
| `Media/Smileys/{fname}.gif` | 95 GIF động, khớp checksum MD5 trong XML. Không có SWF (bản gốc tải SWF từ server). |
| `Media/*.wav` | `buzz`, `message`, `online` ("ding"), `offline`, `alert` |
| `resources/en-US/voicesmiley.xml`, `Media/Audibles` | Audibles (Flash). Bỏ qua. |
| `skins/` | **12 skin**: Default, Purple, Violet flame, Mystic black, Silver, Sky blue, Icy blue, Ruby red, Green fantasia, Twinkle pink, Wood, Graffiti. |
| `skins/<tên>/FriendList`, `IMWindow`, `LoginWnd`, `ContactCard`, `images`, `theme` | Ảnh PNG từng phần của buddy list, cửa sổ chat, cửa sổ đăng nhập, thẻ liên hệ. |
| `skins/<tên>/**/*.xml`, `colors.xml`, `fonts.xml` | Mô tả style: ảnh nút, `resizemargin` (kiểu 9-slice, dịch được thẳng sang CSS `border-image`), màu, font. |
| `Media/FriendIcon` | Avatar mặc định. |
| `login.swf` → `Media/login/*.svg` | Biểu tượng Y! + mặt cười ở màn hình đăng nhập là hoạt hình Flash vector. `scripts/swf_to_svg.py` (chạy trong `npm run extract`) vẽ 4 khung có nhãn ra SVG: `asleep` (mặt bạc ngủ), `awaking`, `connecting`, `connected` (mặt vàng cười). SVG nên nét ở mọi mức phóng. Script chỉ hỗ trợ đúng những gì file này dùng: shape, gradient, sprite, color transform, clip. |

## Bản xem trước giao diện (2026-10-20)

Ở giai đoạn xem trước, ứng dụng dùng dữ liệu giả (`src/renderer/mock.ts`) và chưa nối Messenger. File mock đã được bỏ khi nối dữ liệu thật; đoạn này giữ lại để ghi nhận giai đoạn đầu.

```sh
npm install
npm run extract   # cần file bộ cài ở thư mục gốc
npm run dev
```

- **Stack:** Electron + electron-vite + React + TypeScript. Đóng gói: `dist:mac` (dmg/zip), `dist:win` (nsis/portable), `dist:linux` (AppImage/deb).
- **Cửa sổ:** không dùng khung hệ điều hành (`frame: false`); thanh tiêu đề, nút thu nhỏ/phóng to/đóng và menu đều vẽ từ skin, nên trông giống nhau trên Win/Mac/Ubuntu. Không dùng cửa sổ trong suốt, vì trên Windows cửa sổ trong suốt không kéo giãn được.
- **Tài nguyên skin:** main process phục vụ qua `ymres://skin/<Skin>/<file>?n=&i=` và tự cắt đúng trạng thái của sprite. Thứ tự tìm file: skin đang chọn → Default → Purple. Renderer dựng 9-slice bằng CSS `border-image` theo `resizemargin` gốc; màu lấy từ `colors.xml` của skin qua biến CSS.
- **Emoticon:** `src/core/emoticons.ts` tách mã theo khớp dài nhất trước và bỏ qua URL; test ở `tests/emoticons.test.ts`. Hai chỗ lệch so với file gốc:
  - Bỏ mã `:-`: file gốc ghi thiếu ký tự, giữ lại sẽ chuyển nhầm.
  - Thêm `>:D<` cho big hug: file gốc ghi `<:D>`.
- **Đã có:** cửa sổ đăng nhập theo `LoginWnd.xml`. Gồm ô Facebook ID và mật khẩu, 3 checkbox (Remember / Sign in automatically / Sign in as invisible), báo lỗi khi để trống. Bản xem trước chưa lưu hay gửi mật khẩu đi đâu; bản thật sẽ lưu vào vault mã hóa và tự điền form Facebook; buddy list (khu Me, status message, Contacts / Y! Updates, tìm kiếm, nhóm Friends (x/y), hover/chọn dòng, nhấp đúp để mở chat); cửa sổ chat gộp tab; bảng 95 emoticon; BUZZ! (rung cửa sổ, `buzz.wav`); âm báo tin mới; dòng "đang gõ…"; đổi 12 skin.
- **Cỡ hiển thị:** Y!M gốc thiết kế cho màn hình 96dpi (chữ 11px, buddy list rộng 300px), nhỏ so với ứng dụng bây giờ. App phóng toàn bộ giao diện đồng đều qua `zoomFactor` của Electron. Mặc định 125%; chọn được 100/125/150/175/200% trong menu Xem hoặc bằng Ctrl/⌘ `+` `-` `0`. Cửa sổ co giãn theo cùng tỉ lệ, không vượt quá màn hình. Hệ số này nhân thêm vào scale của hệ điều hành: Win/Mac để 150% và app để 125% thì 1 px gốc thành 1,875 px vật lý. **Cỡ chữ** chỉnh riêng, không đổi kích thước cửa sổ: Nhỏ 85% / Vừa 92% (mặc định) / Lớn 100% / Rất lớn 110%, áp lên mọi cỡ chữ qua biến CSS `--ts`. Mặc định "Vừa" ở 125% cho chữ khoảng 12,6px, gần chuẩn 13px của macOS. Hàng danh bạ cao theo cỡ chữ (tối thiểu 36px như bản gốc) để dấu tiếng Việt không bị chật. Giới hạn: ảnh skin gốc chỉ có bản 1x, nên ở mức phóng không nguyên (125%, 175%) ảnh hơi mềm, còn chữ thì vẫn nét.
- **Ngôn ngữ:** Tiếng Việt (mặc định) và English, toàn bộ chuỗi nằm trong `src/renderer/i18n.ts`. Bản English giữ đúng chữ của Yahoo! Messenger gốc. Đổi ở ô "Ngôn ngữ" trên màn hình đăng nhập hoặc trong menu Messenger. Lựa chọn lưu trong `settings.json` cùng skin, và mọi cửa sổ đổi ngay. Nội dung tin nhắn không dịch.
- **Chỉ để trang trí, chưa có chức năng:** Video/Voice Call, IMVironment, Activities, Photos, Audibles, Format, Send File, Add/Ignore User.
- **Đã kiểm tra trên macOS.** Chưa chạy thử trên Windows/Ubuntu. Ubuntu không có font Tahoma nên dùng Verdana/DejaVu Sans thay thế.

## Nối Messenger thật (2026-10-20)

Dữ liệu giả đã bỏ hẳn. App đăng nhập Facebook, buddy list lấy từ inbox, chat đọc và gửi qua Messenger thật.

**Các thành phần tích hợp Messenger:**
- `src/core/`: `messenger.ts` (bộ đọc DOM), `login.ts`, `messenger-pin.ts`, `messenger-readiness.ts`, `urls.ts`, `task-pool.ts`, `send-status.ts`, `media.ts`, `dom.ts`, `crypto.ts`.
- `electron/browser.ts`: phiên Facebook riêng mỗi tài khoản, cookie lưu trong vault, tự đăng nhập, khôi phục PIN, quét inbox, worker đọc/gửi, kiểm tra người nhận trước khi gửi và xác nhận tin vừa gửi đã hiện trong Messenger.
- `electron/vault.ts`: AES-256-GCM, khóa bọc bằng Keychain/DPAPI, không có đường lưu plaintext. Đã bỏ phần chuyển đổi dữ liệu AI.

**Sửa/thêm cho Y!M:**
- `messenger.ts` (inbox): đọc thêm **avatar** (chỉ nhận ảnh từ fbcdn/facebook.com) và **"đang hoạt động"**. Hoạt động chỉ được nhận khi trang có nhãn rõ ràng ("Đang hoạt động" / "Active now"), còn lại để `null`, không đoán.
- `browser.ts`:
  - `connect()` mở trang inbox ẩn để luồng tự đăng nhập chạy.
  - Mỗi hội thoại đang mở có một trang "live" riêng để hỗ trợ nhiều cửa sổ chat cùng lúc.
  - Thêm `monitorStatus()`, `showMessenger()` (hiện trang ẩn khi Facebook cần xác minh/PIN), `signOut()`.
- `src/core/conversation.ts`: `ingest` (gộp và sắp xếp tin nhắn) và `reconcileInbox`.
- `electron/messenger-service.ts`: điều phối phiên đăng nhập và đồng bộ.
  - **Đăng nhập:** chờ tối đa 2 phút. Facebook cần xác minh/PIN thì tự hiện cửa sổ Messenger cho người dùng xử lý; sai mật khẩu thì báo lỗi.
  - **Quét inbox mỗi 5 giây:** cập nhật buddy list. Hội thoại nào đổi chữ xem trước thì đọc tin ngay. Có tin đến từ người chưa mở cửa sổ thì bật cửa sổ chat **không cướp focus**, nháy thanh tác vụ (như Y!M).
  - **Đọc các hội thoại đang mở:** ban đầu mỗi 2 giây; hiện mỗi **1 giây giữa các lượt** qua trang live (không tải lại trang ở mỗi lượt).
  - **Gửi tin:** qua `Browsers.send`. Tin gửi hiện mờ cho tới khi Messenger hiện lại đúng tin đó; gửi lỗi thì báo đỏ ngay dưới tin.
  - **Lưu tối đa 500 tin** mỗi hội thoại trong vault.
- **Remember / Sign in automatically:**
  - Thông tin đăng nhập được dùng và lưu trong vault mã hóa trong phiên; "Remember" quyết định việc giữ mật khẩu/cookie sau khi thoát bình thường.
  - Không chọn thì khi thoát app bình thường hoặc đăng xuất, mật khẩu và cookie bị xóa. Buộc dừng tiến trình hoặc mất điện có thể bỏ qua bước dọn khi thoát.
  - "Sign in automatically" đăng nhập luôn khi mở app.
  - Đăng xuất luôn xóa cookie và phiên Chromium của tài khoản.

**Sửa sau lần thử thật đầu tiên (2026-10-20):** đăng nhập được, danh bạ 29 người, mọi người hiện offline (0/29) như dự đoán.
- **Cuộn danh bạ không ra thêm người:** Facebook chỉ tải thêm hội thoại khi danh sách chạm đáy và cần chờ, trong khi lượt quét định kỳ chỉ đợi 250ms. Thêm `scanInbox(deep)`: buddy list cuộn gần đáy thì app cuộn inbox ẩn tối đa 60 trang và chờ khoảng 3 giây ở đáy để Facebook tải thêm.
- **Tìm kiếm:** so khớp không dấu, không phân biệt hoa thường ("nguyen" ra "Nguyễn").
- **Tự bật cửa sổ chat (sửa lần 3):** chỉ khi đang online mà có tin gửi đến, và cửa sổ với người đó chưa mở.
  - Hai cách trước đều sai. (1) "Tin mới trong lịch sử": hội thoại chưa mở lần nào thì lần đọc đầu là lịch sử, nên không bao giờ bật. (2) "Dòng xem trước trong inbox đổi": dòng này còn đổi vì thời gian "· 5 phút", cảm xúc, "đã xem"…, nên bật lung tung khi đăng nhập.
  - `arrivedWhileOnline`: inbox đổi chỉ là gợi ý để đọc lại hội thoại. Kiểm tra tin **chưa từng lưu**, **chiều đến**, có **giờ gửi theo Messenger ≥ đầu phút đăng nhập**. Bản hiện tại còn xét tin cuối chiều đến chưa có giờ khi đã biết lịch sử, và bỏ qua nhánh này nếu đợt đọc có tin chưa thấy cũ hơn lúc đăng nhập.
  - **Dự phòng khi đọc tin thất bại:** trang worker mới tải thường chưa sẵn sàng (lỗi "tên người nhận chưa khớp", "chưa chọn đúng hội thoại"). Khi đó vẫn bật cửa sổ nếu Messenger báo **chưa đọc**, **nội dung** xem trước đổi (bỏ thời gian "· 5 phút"), không phải tin của mình, và đã qua lượt quét đầu sau đăng nhập.
  - Log chẩn đoán in ra terminal: dòng `[buzz] …` có số lượng, tên hội thoại, thời gian và lỗi; không in nội dung tin trong các dòng chẩn đoán đồng bộ này.
- **PIN:** menu Messenger → "Mã PIN Messenger..." (khi Facebook đòi xác minh thì có cả link ở màn hình đăng nhập). PIN 6 số lưu trong vault, không gửi ngược ra giao diện. Có lựa chọn tự nhập; khi tự nhập, app chờ 1 giây trước mỗi ô (`PIN_DIGIT_DELAY` trong `browser.ts`) để Facebook không chặn. Lưu PIN mới thì bỏ cờ chặn tự thử.
- **Tên + avatar của mình (cách đầu tiên, đã thay thế ở lượt 3):** sau khi đăng nhập, mở `facebook.com/me` trong trang tạm. Tên lấy từ `<h1>`, không có thì lấy tiêu đề trang; avatar lấy từ nút "Trang cá nhân của bạn", không có thì lấy ảnh fbcdn đầu tiên trong `[role=main]`. Cách hiện tại xem “Sửa lượt 3”. Script ở `src/core/profile.ts`, có test.

**Sửa lượt 2:**
- **Ảnh, sticker, tin thoại trong khung chat:**
  - Ảnh nguồn fbcdn hiện thẳng.
  - Nguồn `blob:` hoặc ảnh lỗi thì lấy qua `readAttachment` (trang Messenger ẩn, tối đa 20 MB, chỉ nhận đúng loại ảnh/âm thanh). Cache 40 tệp gần nhất trong RAM.
  - Tin thoại: bấm ▶ mới tải, rồi phát bằng `<audio>`.
  - Chữ thay thế "[Hình ảnh]"/"[Tin nhắn thoại]" ẩn khi đã hiện tệp.
- **Bấm ảnh đại diện của mình:** mở `facebook.com/me` trong trình duyệt mặc định. Khung `DisplayImgOverlay` sửa về đúng 56×56 (trước bị co còn 48 nên ảnh lệch).
- **Viền đáy buddy list:** bỏ dải `BottomPluginEdge` (thuộc khung Plug-ins của Y!M, app không có) vì nó chồng thêm một lớp viền.

**Sửa lượt 3 (đã kiểm trên tài khoản thật qua CDP; nội dung tin được che khi đọc DOM):**
- **Bộ đọc bỏ sót ảnh/ sticker:** Messenger hiện đặt nút nhãn "Tin nhắn do X gửi lúc…" **cạnh** khung tin `role=article`, không bao lấy nó. Bộ đọc ban đầu chỉ tìm `<img>` trong nút đó, và `messageRoot` chỉ mở rộng ra khung tin khi có trình phát âm thanh. Sửa: `messageRoot` lấy cả khung chứa `[role=article]`, ảnh tìm trong khung đó (bỏ avatar nhỏ trong nút). Ảnh e2ee có nguồn `data:image/…`, hiện thẳng.
- **Sticker:** là `div role=img aria-label="…"` dùng ảnh nền CSS → thành tệp ảnh, nhãn là mô tả. **Like to:** `role=img` nhãn "Thích"/"Like" → emoticon thumbs up `:-bd` (chưa kiểm trên DOM thật).
- **Tin thoại:** cấu trúc thật là nút `aria-label="Phát"` + `role=slider "Thanh kéo âm thanh"` + `role=timer`. Trang ẩn không nhận cú click chuột giả lập ở toạ độ nút, nên chuyển sang `element.click()`: Messenger phát ngay và lộ nguồn `blob:`, lấy được `audio/ogg`. `readAttachment` ưu tiên trang live của cửa sổ chat đang mở, và chờ tại chỗ ~3s cho trình phát dựng xong trước khi cuộn tìm.
- **Lịch sử e2ee sau khi khởi động lại:** Messenger hiện dải thông báo có nút **"Restore now"** (không phải hộp thoại PIN), nên trước khi khôi phục mọi tin chỉ còn giờ gửi. App tự bấm nút này (tối đa 1 lần/60s mỗi trang, chỉ khi đã lưu PIN và bật tự nhập), rồi luồng PIN nhập chậm 1s mỗi ô.
- **Tên của mình:** trang cá nhân (`/me`) không vẽ nội dung khi chạy ẩn (tiêu đề chỉ là "Facebook"), và từng đọc nhầm `<h1>` "Thông báo". Cách hiện tại (`src/core/profile.ts`):
  1. Mở `/me` để biết đường dẫn trang cá nhân. Facebook chuyển hướng bằng script nên `loadURL` báo `ERR_ABORTED`; lỗi này được bỏ qua.
  2. Mở `/home.php`, vì đường dẫn `/` bị luồng tự đăng nhập chuyển về inbox. Trang chủ vẫn vẽ cột trái khi chạy ẩn: lấy chữ + avatar của liên kết trỏ tới đường dẫn đó (hoặc `profile.php?id=<c_user>`).
  - Thứ tự ưu tiên: tên tự đặt (bấm tên → "Đổi tên hiển thị...") > họ tên Facebook > ID đăng nhập.
- **Chữ lúc đăng nhập:** theo bảng chuỗi gốc trong `res_msgr.dll`: "Signing in to %s..." (#616), "Cancel" (#227).
- **Thông báo hệ thống** `$PARTICIPANT_FIRST_NAME(id)` (bật tin nhắn tự hủy): thay bằng "Bạn" hoặc tên người kia, hiện thành dòng hệ thống.
- **Nút Hủy** khi đang đăng nhập: dừng, đóng trang ẩn, giữ cookie. **Ô Ngôn ngữ** đưa ra ngoài form để vẫn chọn được khi form đang khóa.

**Sửa lượt 4:**
- **Avatar người thả cảm xúc bị nhận là ảnh:** ảnh gốc 200×200 nhưng hiển thị 14–28px. Bộ đọc giờ xét kích thước hiển thị (> 40px), không xét `naturalWidth`. `ingest` bỏ tệp cũ khi lần đọc mới không còn.
- **Sticker:** đánh dấu `sticker: true`, hiện 80px (Messenger gốc là 96px). **Ảnh:** bấm để xem lớn ngay trong cửa sổ chat; bấm hoặc nhấn Esc để đóng. Ảnh e2ee dạng `data:` thường là bản xem trước nên độ phân giải có giới hạn.
- **Hội thoại → Mở trong Messenger:** mở đúng cuộc trò chuyện trong cửa sổ Messenger thật, cùng phiên đăng nhập, cho các việc app chưa có (gọi điện, thả cảm xúc, gửi tệp). Mỗi cửa sổ chat trong app vẫn có một trang Messenger **ẩn** riêng ("live") để đọc tin.

**Gửi tin bị treo (đã thấy trên tài khoản thật):**
- **Nguyên nhân:** bản đầu mở một trang worker mới mỗi lần gửi. Trang này phải tải lại cuộc trò chuyện, có thể phải khôi phục e2ee (Restore now + PIN chậm 1s/ô), và xếp hàng chung 3 worker/tài khoản với các lượt đọc, nên lượt gửi có thể chờ mãi mà không báo lỗi. Lỗi "Tên người nhận trong ô soạn chưa khớp…" cũng chỉ xuất hiện ở worker mới mở, lúc ô soạn chưa sẵn sàng. Trên trang live, tên khớp 11/12 trang.
- **Sửa:**
  - Cửa sổ chat đang mở → gửi ngay trên trang live của nó (`sendNative`, giữ mọi kiểm tra người nhận/hội thoại/echo). Không mở được trang live thì mới dùng worker.
  - Không đọc chen trang live trong lúc gửi.
  - Mỗi lần gửi giới hạn 60 giây; quá hạn thì báo đỏ, nhắc kiểm tra trong Messenger trước khi gửi lại.

**Test:** ban đầu 51 test; mốc đối chiếu 2026-10-21 có **58 test đạt** (`npm test`, chạy qua tsx), gồm:
- Test cho bộ đọc DOM, đăng nhập, mức sẵn sàng, task pool.
- Test cốt lõi của vault: không lộ plaintext, không tự tạo lại vault khi hỏng hoặc mất khóa.
- Test mới: avatar/hoạt động, `reconcileInbox`, `ingest`.

**Kiểm chứng thực tế:** nhật ký ở trên đã ghi các lần thử trên tài khoản thật. Chưa có xác nhận thực tế trên Windows/Ubuntu; test DOM fixture không thay thế việc kiểm tra với giao diện Messenger đang chạy.

**Giới hạn:**
- **"Đang hoạt động"** phụ thuộc DOM Messenger. Nếu nhãn khác dự đoán thì mọi người hiện offline (nhóm hiện 0/N); cần khảo sát DOM thật để chỉnh.
- **Busy / Invisible / status message của mình** chỉ hiện trong app, không đổi trạng thái hoạt động trên Facebook.
- **BUZZ!** gửi đi là dòng chữ "BUZZ!!!". Hai bên đều dùng app này thì cùng rung; người dùng Messenger thường chỉ thấy chữ.
- **Ảnh, tin thoại, sticker** đã hiển thị/phát trong app như các lượt sửa ở trên; nguồn chưa đọc được có thể còn chữ thay thế hoặc lỗi tải. Ảnh e2ee dạng xem trước có thể có độ phân giải giới hạn.
- **Cửa sổ chat nhắn đầu tiên** chỉ mở được với người đã có trong inbox (chưa có chức năng tìm người).
- **Linux** cần keyring (gnome-keyring/kwallet); thiếu thì app báo lỗi, không lưu được thông tin đăng nhập.
- **Facebook có thể tạm chặn** khi thao tác nhiều. Bộ đọc nhận ra thì dừng đồng bộ.

### Tự bật cửa sổ khi có tin đến — sửa lỗi đọc (2026-10-20)

- Nguyên nhân không bật: trang worker mở riêng từng hội thoại bị chặn đọc bởi các kiểm tra chống gửi nhầm. Đó là dòng đang chọn trong danh sách chat (bị ảo hóa nên không vẽ), tên trong ô soạn, và ô soạn hiện muộn. Đọc thất bại thì mất tin đến.
- Sửa: đọc dùng `readOnly`, chỉ cần mã hội thoại trên URL khớp. Gửi vẫn kiểm đủ (preflight).
- Inbox chỉ đọc lại khi nội dung xem trước đổi thật (bỏ phần "· 5 phút") hoặc vừa chuyển sang chưa đọc. Trước đây mỗi lượt quét đọc lại cả chục hội thoại.

## Giới hạn đã biết của hướng A

- Presence trong Buzz! Messenger chỉ nhận khi có nhãn hoạt động rõ ràng từ DOM; thiếu nhãn thì hiển thị offline, không suy đoán.
- Hiệu ứng BUZZ!, status message và trạng thái Invisible là trải nghiệm trong app. BUZZ! vẫn gửi chữ `BUZZ!!!` qua Messenger; người bên kia dùng Messenger thường chỉ thấy chữ.

## Câu hỏi mở

- Hiện danh bạ dùng nhóm Friends; nhóm tự tạo (Friends, Family…) là hướng còn để ngỏ, chưa phải tính năng đã có hoặc cam kết cho bản tiếp theo.
