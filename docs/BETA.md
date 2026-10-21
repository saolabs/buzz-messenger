# Beta tích hợp API Messenger web

Nhật ký thử nghiệm nhánh `beta`, phiên bản `0.2.0-beta.1`, ngày 2026-10-21. Các thay đổi đã được chuẩn bị hợp nhất vào bản phát hành `0.2.1`; kế hoạch sau bản này nằm ở [ROADMAP.md](ROADMAP.md).

## Cửa sổ và chuyển màn hình đăng nhập

Cửa sổ chính khởi tạo sát cạnh phải và căn giữa theo chiều dọc trong vùng làm việc của màn hình chính. Sau khi đăng nhập thành công, giữ màn hình đăng nhập với biểu tượng `login/connected.svg` và dòng “Kết nối thành công” trong 2 giây rồi mới hiện danh sách liên hệ. Trong khoảng này form bị khóa; hủy/đăng xuất hoặc đổi tài khoản sẽ hủy lượt chờ cũ. Cập nhật tên/ảnh trong cùng phiên không khởi động lại bộ đếm.

## Phạm vi đã triển khai

- Hội thoại E2EE có ánh xạ thread → chat JID: đọc text qua `MpsOverBridge`, chuyển đổi bằng `MpsMessageToLoadResponse` và dùng `MAWVault.unvault` của phiên Messenger hiện tại.
- Đối chiếu text, chiều gửi, thời gian và thứ tự với DOM để bổ sung ID nền tảng. Nhóm text lặp chỉ được ghép khi đủ số lần xuất hiện và thời gian tương ứng. Ảnh/sticker lấy ID từ bản ghi API; nguồn hiển thị vẫn từ DOM. Tin chưa rõ giờ chỉ được ghép khi toàn bộ khoảng giữa hai ID đã biết khớp đủ số dòng, loại tin và thứ tự. Không chèn thêm lịch sử chỉ có trong API.
- Gửi text E2EE qua `MAWBridgeSendAndReceive.sendAndReceive("backend", "sendMsg", ...)`, có optimistic message, định danh do Messenger tạo, thiết lập tin tự biến mất và kiểm tra ACK.
- Hội thoại thường hoặc thiếu module/ánh xạ: dùng đường DOM hiện có. Danh bạ, media, gọi thoại/video và vòng đọc định kỳ vẫn dùng các đường hiện có.

Beta vẫn cần Chromium và phiên Messenger đã đăng nhập; chưa phải client HTTP độc lập. Chưa có subscription nhận realtime riêng hoặc adapter gửi Lightspeed cho hội thoại thường.

## Chạy thử

```sh
git switch beta
npm run dev
```

Mặc định beta bật đọc/gửi API cho hội thoại được hỗ trợ. Có thể giới hạn bằng biến môi trường khi khởi động lại app:

```sh
BUZZ_MESSENGER_API=read npm run dev  # đọc API, gửi bằng DOM
BUZZ_MESSENGER_API=off npm run dev   # dùng các đường trước beta
```

Log chỉ chứa nhãn cố định, không ghi nội dung tin, ID hội thoại, JID, cookie/token hoặc khóa:

- `read:mps+dom-media`: có tin DOM được bổ sung metadata từ API.
- `read:dom-fallback` / `read:dom-no-overlap`: dùng dữ liệu DOM.
- `send:maw-bridge`: bridge trả ACK đúng external ID và loại `sendMsg`; chưa chứng minh người nhận đã nhận/đọc.
- `send:dom-fallback-before-attempt`: chưa bắt đầu ghi/gửi API, chuyển về DOM.

## Bảo vệ khi gửi

Kiểm tra HTTPS/origin, tài khoản, thread, loại hội thoại E2EE, ánh xạ và thời hạn trước khi gọi API. Giữ bước kiểm tra hội thoại/người nhận hiện có của Buzz ngay trước lần gửi. Các dependency được kiểm tra trước khi tạo optimistic message.

Sau khi bắt đầu transaction optimistic, lỗi/timeout/ACK không xác định đều dừng và yêu cầu kiểm tra Messenger; không gửi lại bằng DOM. Nếu lỗi xảy ra trước mọi tác dụng ghi/gửi thì mới cho fallback. Tác vụ quá hạn không được thức dậy và gửi sau khi đã fallback. Ngoại lệ từ runtime được thay bằng trạng thái cố định để tránh lọt dữ liệu riêng vào log.

## Kết quả kiểm chứng

- Khảo sát trong phiên thật trước khi thử gửi: MPS trả 50 bản ghi, bộ chuyển đổi có 44 tin text; 13 text khớp phần DOM đang hiển thị. Không lưu nội dung tin vào báo cáo.
- Thử gửi từ giao diện Buzz tới **Le Ngoc Doan**: tin xuất hiện trên các trang Messenger của đúng hội thoại. Log xác nhận `send:dom-fallback-before-attempt`; đây là hội thoại thường, không có ánh xạ cho bridge E2EE. Bộ nhập tự động làm mất dấu, nên nội dung thực tế là `Buzz beta: kim tra gi tin.`
- Gửi trực tiếp qua bridge E2EE được kiểm tra bằng fixture, gồm optimistic state, ACK, lỗi, timeout, thay đổi tài khoản/đường dẫn và chặn gửi lặp; **chưa gửi thật qua bridge E2EE**. Lần đọc bổ sung ở hội thoại E2EE khác bị bộ duyệt tự động chặn do chưa có phạm vi cho phép riêng; không chạy lại.
- Kiểm thử lõi cũng xác minh giữ ID cục bộ/media, không ghép text mơ hồ, và cập nhật metadata mà không nhân đôi tin đã lưu.
- Kiểm tra sau bản sửa phân trang, định danh tin và composer: `npm test` đạt 99/99; `npm run typecheck`, `npm run build` và `git diff --check` đều đạt. `npm run test:pagination` kiểm tra Electron offline với trang tải trễ và tải ảnh qua ID đã đổi. `npm run test:composer` kiểm tra giao diện và gửi tệp qua HTTPS được giả lập hoàn toàn.

## Thanh công cụ và tệp kéo thả

- Các sprite tám frame dùng đúng thứ tự thường/hover/nhấn là 0/2/1, nhóm đã chọn là 4/6/5. Thanh tìm/thêm liên hệ dùng cùng lề ngang với danh sách bên dưới.
- Nút miệng mở **Âm thanh vui**: nghe thử và chọn ba âm thanh Yahoo đi kèm app để đưa vào danh sách tệp chờ gửi; không phải các hoạt cảnh Flash Audibles cũ.
- Nút T mở bảng phông, cỡ, màu và đậm/nghiêng/gạch chân, nhớ lựa chọn cục bộ. Kiểu chữ chỉ áp dụng trong ô soạn Buzz; Messenger nhận văn bản thuần, có ghi chú ngay trong bảng.
- Nút đính kèm mở trình chọn tệp nhiều lựa chọn. Kéo thả tệp/ảnh vào vùng soạn cũng đưa vào khay chờ, có xem trước ảnh và bỏ từng tệp. Chỉ bấm **Gửi** mới tải lên Messenger, có thể kèm nội dung. Giới hạn mỗi lần 10 tệp, 25 MB/tệp và 50 MB tổng.
- Tệp chờ dùng token gắn cửa sổ và người nhận, hết hạn sau 30 phút; đổi phiên đăng nhập xóa token. Trước khi gửi kiểm tra tệp còn nguyên và đúng phiên/người nhận; sau khi bắt đầu tải lên không tự thử lại khi kết quả chưa xác định. Cửa sổ Messenger được giữ để kiểm tra lỗi, còn khi thành công thì tự đóng.
- Kiểm thử Electron offline chạy renderer, preload, IPC và bộ gửi thật: xác minh sprite qua CSS hover/active, căn lề, bảng T/âm thanh, trình chọn tệp, kéo thả `File` có nguồn trên đĩa, ảnh preview, nội dung tệp/caption, không gửi lúc thả hoặc gửi hai lần khi bấm lặp, chặn khi thread đổi và dọn trang gửi. Chưa gửi tệp tới liên hệ thật trong đợt sửa này.

## Tải thêm danh bạ và lịch sử

- Nhóm chat đã xác nhận từ runtime có mục riêng trong buddy list, nhãn nhóm thay trạng thái offline, tác giả/biệt danh cho tin đọc mới và bảng thành viên có quản trị viên, tải lại/phân trang; bấm thành viên mở chat riêng sau khi kiểm tra đúng participants. Xem `GROUP-CHAT-RESEARCH.md` về cách đối chiếu và giới hạn cache cũ; chưa có thao tác quản lý nhóm. `npm run test:groups` kiểm thử toàn bộ luồng offline; bộ kiểm thử lõi hiện đạt 123/123.

- Tìm liên hệ: lọc nhanh tên đã lưu theo chữ không dấu, rồi tìm thêm qua ô tìm kiếm Messenger trong một cửa sổ ẩn riêng. Có trạng thái đang tìm, lỗi và thử lại; đổi/xóa từ khóa hủy lượt cũ. Không chỉ tìm trong các liên hệ đã tải ở inbox.
- Kết quả tìm kiếm chỉ được lưu vào danh bạ khi người dùng mở. App chọn đúng mục trên Messenger rồi xác nhận URL/ID hội thoại và tên người nhận; không lấy ID người dùng làm ID hội thoại mã hóa, không gộp hai kết quả chỉ vì trùng tên. Tìm kiếm không đổi thứ tự inbox, trạng thái chưa đọc hay nội dung nhập ở cửa sổ manager.
- `npm run test:search` chạy Electron offline: kết quả tải trễ ngoài cache, tên trùng, mở đúng thread mã hóa, hủy/đổi/xóa từ khóa, lỗi/thử lại và dọn cửa sổ ẩn.
- Xác nhận trên beta thật: tìm **Cai** trả 20 kết quả (có **Cai Le**, **Lê Ngọc Cai**), thay vì chỉ một tên đã lưu. Loại mục hành động “Tìm kiếm tin nhắn…” khỏi liên hệ và chờ ô tìm kiếm sẵn sàng khi trang mới tải. Bộ kiểm thử lõi đạt 105/105, tích hợp tìm kiếm Electron, typecheck và build đều đạt.

- Vùng cuộn inbox hiện tại nằm bên trong grid. Bộ đọc tìm vùng chứa các liên kết hội thoại, giữ mốc phân trang cho lần tải tiếp và để vòng quét nền cập nhật phần đầu danh sách.
- Danh bạ: cuộn tới cuối hoặc bấm **Tải thêm bạn bè**. App hiển thị lỗi hoặc thông báo chưa tìm thấy thêm trong lần tải hiện tại. Kiểm tra trên app thật đã tăng từ 69 lên 92 liên hệ.
- Hội thoại: cuộn lên đầu hoặc bấm **Tải tin nhắn cũ hơn**. IPC gọi bộ tải lịch sử, gộp yêu cầu chồng nhau, chờ trang trả chậm và giữ vị trí đọc khi chèn tin cũ. Mỗi lần nhắm tới thêm khoảng 100 tin, giới hạn lưu 5.000 tin/hội thoại.
- Tin cũ cùng phút giữ thứ tự DOM; backfill không phát âm báo như tin vừa đến. Vòng đồng bộ tiếp theo không cắt lịch sử vừa tải về giới hạn 500 tin cũ của bản trước.
- Lần thử ban đầu trong **Le Ngoc Doan** giữ nguyên 57 tin (`added: 0`). Kiểm tra tiếp theo phát hiện worker `WebContentsView` rời không chạy `IntersectionObserver`, nên cuộn đúng đầu vẫn không kích hoạt Messenger tải tiếp; kết quả đó chưa chứng minh hết lịch sử.
- Đã chuyển tải lịch sử sang `BrowserWindow` sở hữu trang, khởi tạo ẩn và không lấy focus. Giới hạn hai tác vụ lịch sử mỗi tài khoản; cửa sổ tự hủy sau khi đọc xong, chỉ hiện ra nếu cần khôi phục/xác minh. Đăng xuất hoặc tắt app cũng đóng các trang này.
- Kiểm thử Electron dùng sentinel `IntersectionObserver` và tải trễ: bản cũ thất bại (chỉ thêm 19 tin sẵn trong DOM), bản sửa tải đủ hơn 100 tin và không để lại cửa sổ ẩn. Trên phiên thật của **Trang**, nút tải cũ tăng từ 18 lên 118 tin; cuộn lên đầu tiếp tục tăng lên 218 tin. Không trùng ID cục bộ/ID Messenger, tin mới nhất vẫn ở cuối và cửa sổ tải không hiển thị hay lấy focus.

## Tin mới bị nằm giữa lịch sử

Kiểm tra **Trang** phát hiện tin mới nhất đã nằm trong kho Buzz nhưng còn các tin cũ thiếu ngày tháng phía sau, khiến cuối giao diện hiển thị tin cũ. Vòng đọc ở cuối dòng thời gian hiện dùng timestamp/ID API đã xác minh để đặt lại cửa sổ tin mới sau lịch sử chưa rõ ngày; giữ các tin có thời gian mới hơn nếu snapshot bị cũ. Tải lịch sử vẫn dùng đường gộp riêng và không xóa bản ghi cũ.

Xác nhận trên phiên thật sau sửa: API mới nhất của Trang khớp bản ghi cuối kho và dòng cuối giao diện; số lượng giữ nguyên 31 tin, cửa sổ đang ở cuối lịch sử. Hộp khôi phục E2EE đã hoàn tất bằng luồng PIN được cấu hình sẵn trong app; không đổi PIN hay cờ bảo vệ.

## Dòng bị lặp do đổi nhãn ngày/giờ

Lần kiểm tra tiếp theo phát hiện 13 bản ghi cục bộ trỏ tới các tin đã lưu dưới fingerprint khác. Phần gộp hiện ưu tiên ID Messenger, giữ ID cục bộ đầu tiên và lưu các ID cũ trong `aliasIds`. Tin có ID Messenger khác nhau vẫn là hai tin, kể cả cùng nội dung.

Dữ liệu cũ chỉ được sửa khi có một chuỗi ít nhất năm tin API khớp thứ tự và lần đọc, hoặc một dòng khớp duy nhất trong khoảng có hai ID API làm mốc. Các bản ghi không đủ bằng chứng được giữ. Trước khi gộp, toàn bộ danh sách được sao lưu một lần vào `messageRepairBackup`, được mã hóa cùng vault; không sửa hoặc xóa tin trên Messenger.

Trang đã được sửa từ 31 dòng xuống 18 tin, giữ hai ảnh riêng biệt và các tin cũ ngoài cửa sổ đang đọc. Kiểm thử xác minh đổi fingerprint nhiều lần không tăng số tin, tin giống nội dung nhưng khác ID không bị gộp, và ảnh vẫn tải qua ID cũ.

Xác minh lại trên app thật: khởi động lại beta, đóng/mở hội thoại Trang và chờ đọc/tải lịch sử hoàn tất vẫn giữ 18 tin, 14 tin có ID nền tảng, không trùng ID cục bộ hoặc ID Messenger. Giao diện render đủ 18 dòng và dòng cuối khớp bản ghi cuối cache; bản sao lưu vẫn có đủ 31 dòng trước sửa.

Các tên module là API nội bộ Facebook và có thể thay đổi. Khi contract không còn phù hợp, beta quay về DOM trước lần gửi hoặc báo kết quả chưa xác định sau lần thử gửi. Không xuất bản release hay đẩy nhánh lên remote trong đợt thử cục bộ này.
