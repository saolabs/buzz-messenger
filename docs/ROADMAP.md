# Kế hoạch sau v0.2.1

Ngày cập nhật: 2026-10-21. Đây là kế hoạch triển khai tiếp theo; các mục bên dưới chưa nằm trong v0.2.1. Thứ tự ưu tiên có thể điều chỉnh theo phản hồi sử dụng, chưa ấn định ngày phát hành.

## 1. Tiện ích nhắn tin hằng ngày

Triển khai theo thứ tự: tìm tin trong hội thoại → dán ảnh → lưu bản nháp.

| Hạng mục | Phạm vi | Điều kiện hoàn thành |
| --- | --- | --- |
| Tìm tin trong hội thoại | Ctrl/Cmd+F, tìm không dấu trong lịch sử đã tải, tô sáng, kết quả trước/sau và nhảy tới tin | Ghi rõ phạm vi đã tải; không nhầm với tìm liên hệ; hoạt động với nhóm, xuống dòng và kết quả lặp. Tải thêm lịch sử cập nhật kết quả, không đổi vị trí đọc ngoài thao tác chọn kết quả. |
| Dán ảnh từ clipboard | Ctrl/Cmd+V trong ô soạn đưa ảnh vào khay tệp chờ hiện có | Xem trước/bỏ ảnh được; chỉ bấm Gửi mới upload; giữ giới hạn dung lượng/số tệp và ràng buộc cửa sổ/người nhận. Không mất thao tác dán văn bản thông thường. |
| Bản nháp theo hội thoại | Khôi phục nội dung văn bản khi đổi tab, đóng/mở cửa sổ và khởi động lại | Lưu trong vault mã hóa theo tài khoản + hội thoại; không dùng chung bản nháp giữa các người nhận; chỉ xóa nội dung đã gửi thành công. Tệp chờ hết hạn không được tự gửi lại. |

Kiểm chứng bằng unit test, Electron offline và kiểm tra giao diện. Thử gửi thật chỉ khi người dùng chỉ định người nhận và nội dung/tệp.

## 2. Duyệt ảnh và truy cập nhanh

- Mở rộng trình xem ảnh hiện có: ảnh trước/sau, phím mũi tên, lưu ảnh; giữ đúng liên kết với tin gốc và xử lý nguồn mã hóa/tải trễ.
- Kho ảnh đã tải theo hội thoại; bổ sung video/tài liệu khi bộ đọc đã xác minh đúng loại tệp và nguồn tải.
- Ghim liên hệ/nhóm yêu thích trong Buzz, lưu cục bộ, không thay đổi thứ tự inbox Messenger.
- Tùy chỉnh thông báo/âm báo theo hội thoại trong Buzz; phân biệt rõ với việc tắt thông báo trên Messenger.

Điều kiện hoàn thành: không đưa avatar/ảnh cảm xúc vào kho ảnh; mở/lưu đúng tệp; ghim và tùy chỉnh giữ qua lần mở app.

## 3. Reply, reaction và @mention

Ưu tiên nghiên cứu trả lời một tin cụ thể trước, sau đó thả cảm xúc và tag thành viên nhóm.

1. Xác minh dữ liệu chỉ đọc: ID tin gốc, tác giả, nội dung trích dẫn, reaction và ID người được nhắc.
2. Đối chiếu riêng chat thường, chat E2EE và nhóm; hỗ trợ từng loại khi có bằng chứng, không suy rộng từ một nhóm mẫu.
3. Thêm giao diện chọn/hủy reply, chọn reaction và danh sách gợi ý thành viên khi gõ @.
4. Chỉ bật thao tác ghi khi đã kiểm tra đúng tài khoản, thread, tin đích/người nhận, quyền và ACK. Sau khi đã thử gửi/ghi mà kết quả chưa rõ, không tự fallback hoặc gửi lại.

Điều kiện hoàn thành: reply liên kết đúng tin gốc, reaction đồng bộ với Messenger, @mention có ID thực sự thay vì chỉ là tên dạng text; giữ riêng người/tin trùng tên hoặc nội dung. Có fixture kiểm tra đổi phiên, đổi thread, timeout và bấm lặp.

## 4. Trạng thái tin và tùy chỉnh nhóm

- Nghiên cứu đã gửi/đã nhận/đã xem và đang nhập; chỉ hiển thị khi nguồn dữ liệu chứng minh được, không suy từ trạng thái online.
- Nghiên cứu đổi tên/ảnh nhóm, biệt danh, theme/emoji, thêm thành viên, rời nhóm và thao tác quản trị.
- Mỗi thao tác nhóm phải kiểm tra vai trò/quyền và danh sách thành viên hiện tại. Thao tác thay đổi nhóm thật chỉ thực hiện theo yêu cầu cụ thể của người dùng.

Chưa xác nhận API ghi cho các tính năng này. Nếu module nội bộ không khả dụng, hiển thị trạng thái phù hợp và giữ lối mở trong Messenger.

## Tiêu chí chung trước mỗi release

- Typecheck, unit test và fixture Electron liên quan đều đạt; không gửi tin/call/upload thật trong CI.
- Không tái xuất hiện tin trùng, mất lịch sử, mất ảnh hay gửi nhầm người; giữ bản sao trước các lần sửa cache có gộp bản ghi.
- Không ghi nội dung tin, credential hoặc khóa vào log/test artifact công khai.
- Kiểm tra bộ cài và startup trên các runner phát hành; ghi rõ giới hạn thử nghiệm thực tế.
- Cập nhật hướng dẫn và ghi chú phát hành theo tính năng đã hoàn thành, không trình bày mục trong kế hoạch như tính năng đã có.
