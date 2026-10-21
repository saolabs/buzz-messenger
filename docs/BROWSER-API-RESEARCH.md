# API nội bộ của Messenger web trong Buzz

> Đây là ảnh chụp khảo sát trước khi triển khai beta. Adapter và kết quả thử nghiệm tiếp theo được ghi tại [BETA.md](BETA.md), gồm đọc MPS đã đối chiếu được text và giới hạn kiểm chứng gửi E2EE.

Kiểm tra trực tiếp ngày **2026-10-21**, trên ứng dụng `buzz-messenger` đang chạy và đã đăng nhập. Không khởi động lại ứng dụng, không gửi tin thử, không xuất cookie/token/khóa mã hóa hoặc lưu nội dung tin nhắn vào báo cáo.

**Kết quả:** Có điểm tích hợp cụ thể trong runtime Messenger web. Đã đọc database Lightspeed bằng API nội bộ và xác định lời gọi của nhánh gửi E2EE. Chưa triển khai adapter, chưa thử gọi gửi trực tiếp, và chưa xác nhận đọc được nội dung E2EE đang hiển thị.

## Những gì đã xác minh trong phiên đang chạy

- Tiến trình là Electron của đúng thư mục `buzz-messenger`, chạy bằng `electron-vite dev --watch`.
- Có trang Messenger nhúng dùng đường dẫn `/messages/e2ee/t/.../`, bên cạnh trang inbox và trang hội thoại thường.
- Loader Facebook `require` có registry khoảng **15,439 module** trong ảnh chụp kiểm tra. `require.__debug` không khả dụng; registry được kiểm tra qua closure bằng debugger, không thay loader hoặc khởi tạo module chưa chạy.
- Các module `LSDatabaseSingleton`, `LSPlatformClient`, `LSPlatformRealtimeTransport`, `LSPlatformGraphQLTransport`, `MAWBridgeSendAndReceive` và `useMAWSendMessageV2` đã được khởi tạo.
- Getter `LSDatabaseSingleton.getLSDatabaseSingletonPromiseOrValue()` trả về database có **310 bảng**, API `table`, `runInTransaction`, `subscribeToCommit` và `subscriptionManager`.
- Bảng có API `entries`, `get`, `keys`, `index`, `subscribe`. Khóa của `messages` là `threadKey`, `timestampMs`, `messageId`.

Ví dụ cấu trúc phép đọc đã thử, với module và database được lấy từ phiên hiện tại:

```js
const db = await LSDatabaseSingleton.getLSDatabaseSingletonPromiseOrValue();
const key = I64.of_string(currentThreadId);
const thread = await db.table("threads").get(key);
const iterator = db.table("messages").entries(undefined, "desc", {
  gte: [key],
  lte: [key],
});
// Đọc giới hạn bằng await iterator.next(); không ghi database.
```

Một ảnh chụp phép đọc trả về **30 bản ghi**, trong đó 27 có trường `text`; tất cả khớp thread key trên URL. Các trường gồm `messageId`, `offlineThreadingId`, `senderId`, `timestampMs`, `sendStatus`, `sendStatusV2` và thông tin reply.

**Giới hạn quan trọng:** Không có text nào trong tập này khớp nội dung DOM ở lần đối chiếu. URL E2EE không chứng minh bảng `messages` chứa đầy đủ nội dung E2EE hiện tại. Các bảng `client_messages`, `local_message_persistence_store` và `occamadillo_most_recent_message_per_thread` cũng không có bản ghi trong phép lấy mẫu. Không thể coi phép đọc LS này là prototype nhận tin E2EE đã đạt.

Nguồn hiển thị thực tế còn có `MAWMessageRangeDataSourceV2`, `MWPMessageListDataSource` và `MWPMessageListSingleDirectionDataSource`; đây là các điểm cần lần tiếp để nối dữ liệu worker với hội thoại đang mở.

## Đường gửi E2EE đã tìm thấy

Source của hook **`useMAWSendMessageV2` đã khởi tạo** gọi:

```js
MAWBridgeSendAndReceive.sendAndReceive("backend", "sendMsg", {
  args,
  chatJid,
  externalId,
  qplEventType,
  qplInstanceKey,
});
```

Trong hook, `args` được tạo từ `content`, `initiatingSource`, `isFirstMsg`, `isForwarded`, `openMessageOtid`, `openMessageParticipantCount`, `optimisticMsg: { msgId, ts }`, `participantCount`, `source`, `specialTextSize`; có thể thêm `quote`, `ephemeralSetting`, `mentionedJids`, `commands`.

Lớp `MAWBridgeSendAndReceive` chuyển tiếp qua `MAWBridge.getBridge().sendAndReceive`, có xử lý ACK, timeout và lỗi. Hook còn gọi `MAWMessageSendReporter` để theo dõi kết quả. Đây là **API trong runtime của trang**, không phải URL HTTP để gọi từ Node. `chatJid`, thread key, `externalId` và optimistic message ID có vai trò khác nhau; không tự thay thế chúng bằng ID trong URL.

Chưa gọi `sendMsg` trong phép kiểm tra này. Việc người dùng đã gửi tin qua giao diện chứng minh luồng UI hoạt động; chưa chứng minh một caller riêng có đủ tham số và vòng đời để tái tạo việc gửi.

## Hướng triển khai cho Buzz

Ưu tiên bridge chạy trong trang Messenger đã đăng nhập, giữ Messenger/worker đảm nhiệm khóa và E2EE. Buzz có thể tiếp tục dùng Chromium nền nhưng giảm việc dò DOM và mô phỏng nhập/bấm.

Thứ tự cần hoàn thành:

1. Lần `MAWMessageRangeDataSourceV2` để đọc và subscribe đúng dữ liệu E2EE đang hiển thị; đối chiếu ID, chiều gửi và timestamp.
2. Xác định ánh xạ thread key → `chatJid`, cách tạo định danh gửi và yêu cầu của reporter/optimistic state từ caller hiện tại.
3. Đưa vào adapter thử nghiệm có fallback về DOM. Chỉ thử gửi khi có người nhận và nội dung thử cụ thể.
4. Kiểm tra nhận realtime, reconnect, ACK và timeout; chưa có xác nhận thì không tự gửi lại.

Registry closure và tên module là chi tiết nội bộ, có thể đổi sau mỗi bản web. Biến minify `o` quan sát trong loader chỉ dùng để khảo sát, không phải giao diện ổn định để hardcode vào production.

## Bằng chứng và trạng thái phiên

Source hàm export chọn lọc và kết quả chỉ chứa metadata được lưu cục bộ trong [`../_extracted/messenger-web-runtime/`](../_extracted/messenger-web-runtime/), được Git bỏ qua. `observations.json` ghi rõ mức kiểm chứng; các file `buzz-runtime-*-modules.json` lưu mã hàm và tên dependency.

Không sửa code runtime của Buzz hoặc cài observer vào hàm gửi. Debugger main process được bật tạm trên localhost phục vụ khảo sát và được đóng sau khi kiểm tra. Các debugger renderer có sẵn của app được giữ; kết nối do phép kiểm tra tự gắn được tháo sau mỗi lượt. Không cần chạy build/test app vì thay đổi chỉ là tài liệu nghiên cứu.
