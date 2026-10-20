# Hướng dẫn sử dụng Buzz! Messenger

[Về README](../README.vi.md)

Buzz! Messenger mang trải nghiệm Yahoo! Messenger trở lại trên các cuộc trò chuyện Facebook Messenger của bạn. Hướng dẫn này mô tả các chức năng đang có; những nút cổ điển chỉ để tái hiện giao diện được ghi ở phần giới hạn.

Xem [ảnh giao diện trong README](../README.vi.md#giao-diện). Ảnh sử dụng tên và tin nhắn mẫu.

## Cài đặt từ bộ cài

Tải bản dành cho máy của bạn tại [GitHub Releases](https://github.com/saolabs/buzz-messenger/releases), khi đã có bản được công bố. Không cần cài Node.js hoặc tự build.

- **Windows x64:** chạy file `setup.exe` để cài hoặc mở file `portable.exe` để dùng trực tiếp.
- **Mac:** chọn `arm64` cho Apple Silicon, `x64` cho Intel. Mở DMG và kéo app vào Applications, hoặc giải nén ZIP.
- **Linux x64:** cấp quyền chạy cho AppImage rồi mở, hoặc cài DEB qua trình quản lý gói của Debian/Ubuntu. Vault cần kho khóa hệ điều hành hoạt động.

File đầy đủ có dạng `buzz-messenger-<version>-<platform>-<arch>...`. Xem [bảng chọn bộ cài](../README.vi.md#tải-và-cài-đặt).

## Đăng nhập

1. Mở app, nhập thông tin đăng nhập Facebook.
2. Chọn **Remember** nếu muốn giữ thông tin đăng nhập cho lần sau. **Sign in automatically** chỉ có hiệu lực khi chọn Remember.
3. Bấm đăng nhập. Nếu Facebook yêu cầu mã xác minh, kiểm tra tài khoản hoặc PIN, app sẽ hiện cửa sổ Messenger để bạn hoàn tất.
4. Khi đăng nhập xong, buddy list lấy các cuộc trò chuyện từ inbox Messenger.

**Sign in as invisible** chỉ thay đổi trạng thái hiển thị của bạn trong Buzz! Messenger. Tùy chọn này không tắt trạng thái hoạt động của tài khoản trên Facebook.

### PIN khôi phục lịch sử

Mở **Messenger → Mã PIN Messenger...** để lưu PIN 6 số và chọn tự nhập nếu muốn. PIN được lưu trong vault; giao diện không nhận lại giá trị PIN đã lưu.

Khi đã lưu PIN và bật tự nhập, app có thể bấm **Restore now** và nhập PIN để khôi phục lịch sử mã hóa. Quá trình này có độ trễ giữa từng chữ số. Nếu chưa khôi phục được, mở cửa sổ Messenger bằng menu Messenger để hoàn tất trực tiếp.

## Danh sách bạn bè

- Tìm theo tên, có hoặc không dấu: `nguyen` có thể tìm thấy `Nguyễn`.
- Cuộn gần đáy để tải thêm cuộc trò chuyện. Việc tải thêm phụ thuộc tốc độ phản hồi của Messenger.
- Nhấp đúp một người để mở chat. Hiện chỉ mở được những cuộc trò chuyện đã có trong inbox.
- Chỉ báo online dựa trên nhãn hoạt động rõ ràng từ Messenger. Không thấy nhãn thì app hiển thị offline, nên offline không khẳng định người đó đang vắng mặt.
- Bấm tên của mình để đổi tên hiển thị trong app; bấm avatar để mở trang Facebook cá nhân trong trình duyệt mặc định.

## Nhắn tin như ngày xưa

Gõ tin rồi nhấn **Enter** để gửi, **Shift + Enter** để xuống dòng. Tin đang gửi hiện mờ; khi gửi lỗi, thông báo hiện ngay dưới tin.

Mở bảng mặt cười hoặc gõ mã Yahoo như `:))`, `=))`, `:-*`, `>:D<`. App hiển thị icon ở cả tin nhận và tin gửi, đồng thời giữ nguyên mã nằm trong URL. Nội dung gửi qua Messenger là mã văn bản; Messenger có thể tự chuyển một số mã thành emoji.

Bấm **BUZZ!** để gửi `BUZZ!!!` và rung cửa sổ. Nếu người bên kia cũng dùng Buzz! Messenger, app của họ nhận diện dòng chữ này và phát hiệu ứng BUZZ!; Messenger thông thường chỉ hiển thị chữ.

Ảnh và sticker hiển thị trong lịch sử. Bấm ảnh để xem lớn, bấm lại hoặc nhấn **Esc** để đóng. Với tin thoại, bấm nút phát để tải và nghe. Một số ảnh mã hóa chỉ có bản xem trước nên có thể không nét khi phóng lớn.

### Cửa sổ riêng và tab

Mặc định mỗi người có một cửa sổ chat riêng. Bật **Xem → Gom hội thoại thành tab** để các hội thoại mở tiếp theo dùng chung cửa sổ. Trong cửa sổ nhiều tab, nhấp đúp một tab hoặc chọn **Hội thoại → Tách ra cửa sổ riêng** để tách.

Khi phát hiện tin đến từ người chưa có cửa sổ chat, app có thể mở cửa sổ mà không lấy focus. Tin mới có âm báo; tab hoặc thanh tác vụ nhấp nháy tùy trạng thái cửa sổ.

Để gọi điện, thả cảm xúc hoặc gửi tệp, chọn **Hội thoại → Mở trong Messenger**. Cửa sổ Messenger này dùng cùng phiên đăng nhập với app.

## Đổi giao diện

- Đổi skin bằng menu Messenger hoặc nút chọn skin trên khung cửa sổ.
- Đổi ngôn ngữ ở màn hình đăng nhập hoặc menu Messenger. Tin nhắn không được dịch.
- Chỉnh độ phóng ở menu **Xem** hoặc dùng **Ctrl/⌘ +**, **Ctrl/⌘ -**, **Ctrl/⌘ 0**. Mức mặc định là 125%.
- Chỉnh cỡ chữ riêng trong menu Xem; thay đổi này không làm cửa sổ lớn lên.

Skin, ngôn ngữ, độ phóng, cỡ chữ và lựa chọn gom tab được lưu giữa các lần mở app. Busy, Invisible và dòng status của bạn chỉ có ý nghĩa trong giao diện Buzz! Messenger, không đổi trạng thái trên Facebook.

<a id="du-lieu-va-phien-dang-nhap"></a>
## Dữ liệu và phiên đăng nhập

Ứng dụng lưu dữ liệu tại thư mục `userData` do Electron cung cấp:

| Dữ liệu | Cách lưu |
| --- | --- |
| Skin, ngôn ngữ, độ phóng, cỡ chữ, chế độ tab | `settings.json` |
| Tài khoản, mật khẩu của phiên, cookie, PIN đã lưu và lịch sử chat | Vault mã hóa trong `secure/` |
| Khóa vault | `secure/key.secure`, được bọc bằng kho khóa hệ điều hành |

Vault giữ tối đa 500 tin gần nhất cho mỗi cuộc trò chuyện. Đây là lịch sử cục bộ phục vụ hiển thị, không phải bản sao lưu đầy đủ của Messenger.

- **Có Remember:** giữ mật khẩu và cookie qua lần thoát bình thường để có thể đăng nhập lại.
- **Không Remember:** thông tin vẫn được dùng trong phiên và có thể nằm trong vault mã hóa; mật khẩu và cookie được xóa khi đăng xuất hoặc thoát bình thường. Việc dọn này không được bảo đảm nếu tiến trình bị buộc dừng hoặc máy mất điện.
- **Đăng xuất:** xóa cookie và phiên Chromium của tài khoản trong app; chỉ giữ mật khẩu nếu đã chọn Remember. Đăng xuất không xóa toàn bộ lịch sử chat hoặc PIN đã lưu trong vault.
- **Đóng cửa sổ danh bạ:** thoát ứng dụng. Đóng một cửa sổ chat chỉ đóng hội thoại đó.

App kết nối với Facebook/Messenger và tải nội dung từ các nguồn media được hỗ trợ của Facebook. Không có server riêng của Buzz! Messenger trong luồng hiện tại.

## Khi có trục trặc

| Hiện tượng | Cách xử lý |
| --- | --- |
| Đăng nhập chờ lâu hoặc cần xác minh | Mở cửa sổ Messenger từ menu, hoàn tất yêu cầu của Facebook rồi thử lại. |
| Lịch sử chỉ còn giờ gửi hoặc thiếu nội dung | Kiểm tra yêu cầu khôi phục lịch sử và PIN trong cửa sổ Messenger. |
| Danh bạ chưa đủ | Cuộn gần đáy và chờ Messenger tải thêm. |
| Mọi người đều offline | Chỉ báo phụ thuộc nhãn hoạt động trên DOM; vẫn có thể mở chat và gửi tin. |
| Gửi lỗi hoặc quá thời gian chờ | Kiểm tra cuộc trò chuyện trong Messenger trước khi gửi lại: tin có thể đã được gửi dù app chưa xác nhận. |
| Facebook báo tạm chặn tính năng | Xử lý thông báo trong Messenger; hạn chế tiếp tục thử liên tục. |
| Ảnh hoặc tin thoại không tải | Mở đúng hội thoại trong Messenger để kiểm tra nội dung và trạng thái khôi phục lịch sử. |
| App thiếu ảnh khung, skin hoặc mặt cười khi chạy từ mã nguồn | Kiểm tra `resources/ym/` có đủ tài nguyên. Nếu cần tạo lại từ bộ cài gốc, chạy `npm run extract`; xem tài liệu phát triển. |
| Lỗi kho khóa trên Linux | Kiểm tra GNOME Keyring/KWallet và phiên desktop. App không dùng lưu trữ plaintext thay thế. |
| Vault hỏng hoặc mất khóa | Giữ nguyên cả thư mục `secure/` để chẩn đoán; app không tự tạo khóa mới đè lên vault đã có. |

## Giới hạn hiện tại

- Chưa có tìm người ngoài inbox, thêm liên hệ hoặc nhóm danh bạ tự tạo.
- Các nút Video/Voice Call, IMVironment, Activities, Photos, Audibles, Format, Send File và Add/Ignore User chưa có chức năng trong giao diện cổ điển.
- Chưa xác nhận hoạt động thực tế trên Windows và Linux.
- Đồng bộ và nhận diện media phụ thuộc cấu trúc trang Messenger; thay đổi từ Facebook có thể khiến một phần chức năng ngừng hoạt động.
