# Nghiên cứu nhóm chat Messenger — 2026-10-21

## Trạng thái triển khai beta

Đã tích hợp giai đoạn đọc nhóm: nhận diện từ runtime, tách các nhóm đã xác nhận khỏi bạn bè, dùng nhãn Nhóm chat thay Ngoại tuyến, hiển thị tác giả/biệt danh và bảng thành viên. Bấm thành viên mở chat riêng sau khi xác minh người nhận. Bảng có vai trò quản trị viên, tải lại, phân trang 100 thành viên/lượt và báo rõ khi cache Messenger chưa đủ.

Adapter kiểm tra tài khoản/thread trước và sau mỗi lượt, giới hạn dữ liệu theo threadKey và deadline; tắt API bằng `BUZZ_MESSENGER_API=off` cũng tắt các truy vấn nhóm. Chuỗi được đọc qua `MAWVault.unvault` ngay trong trang, không xuất khóa ra ngoài. Tin thiếu ID API dùng tác giả từ nhãn DOM và ánh xạ tên/biệt danh duy nhất trong danh sách thành viên đã xác minh; tên trùng không được gán chung ID.

Fingerprint của nhóm có tác giả; phép ghép API phải một-một và không dùng cửa sổ API còn thiếu để ghép theo text. Nâng cấp cache có `groupRepairBackup`; các bản gộp alias còn có `messageRepairBackup`. Chỉ giữ lại/gộp ID cũ khi có bằng chứng duy nhất hoặc một đoạn media không đổi nằm giữa hai ID API làm mốc. Dòng cache cũ chưa xác minh tác giả được giữ và hiện “Thành viên”, không gán tên nhóm hay đoán tác giả. Nạp lại lịch sử sẽ bổ sung tác giả cho phần đối chiếu được.

Kiểm thử: 123 test lõi, typecheck/build và kiểm thử Electron nhóm đều đạt. Kiểm thử Electron kiểm tra chuỗi được bảo vệ, giữ ID/backup, hai tác giả gửi cùng text/phút, vai trò, phân trang thành viên, thông báo hệ thống, danh sách nhóm và đổi phiên. Các kiểm thử tải lịch sử, composer và tìm kiếm cũng đã đạt sau khi nối tính năng nhóm. Script `research-group-fixture.ts` hiện kiểm tra kết quả sau sửa: đủ 3 tin và 3 người gửi.

Sửa lỗi lặp sau phản hồi: fingerprint dùng mã thành viên khi có ánh xạ duy nhất, nên thay đổi giữa tên thật/biệt danh không tạo ID mới. Cache API 2 giây gắn với khoảng thời gian/số tin của từng khung đọc; cuộn sang lịch sử khác phải truy vấn lại. Các cặp fingerprint cũ/mới được đối chiếu theo dấu gốc, phút, nội dung, chiều, media và tác giả; không gộp khi có nhiều tác giả, lần lặp có hậu tố hoặc ID nền tảng khác nhau. Trước sửa giữ thêm `groupIdentityBackup`.

Bấm thành viên: đọc đúng participant bằng iterator khóa ghép giới hạn chính xác `[threadKey, contactId]`, sau đó cho Messenger điều hướng từ liên kết người dùng. Chỉ nhận hội thoại riêng khi URL, tài khoản, loại thread và toàn bộ participants xác nhận đúng người dùng hiện tại + thành viên đã chọn. Không lấy user ID làm bằng chứng cho ID hội thoại E2EE. Đổi phiên hủy kết quả; giao diện có trạng thái chờ/lỗi và chặn bấm lặp. Chưa có thao tác quản lý thành viên.

Xác nhận trên beta thật sau sửa: đã gộp 29 cặp cache cũ/mới và xử lý phần tên thật/biệt danh còn lại bằng một lượt tải lịch sử. Nhóm có 269 dòng, không còn dòng thiếu tác giả hoặc bản sao cùng fingerprint/tác giả; không trùng ID cục bộ hay ID Messenger. Backup giữ 233 dòng trước sửa và cả 233 vẫn được bảo toàn qua ID/alias; đủ 17 bản ghi ảnh ban đầu. Bấm thành viên mẫu mở đúng cửa sổ chat riêng, đã đóng cửa sổ thử. Không gửi tin hay thay đổi thành viên/quyền của nhóm thật.


Chưa thêm tạo/đổi tên nhóm, thêm/bớt thành viên, chuyển quyền hay rời nhóm. Chưa gửi text/tệp thật vào nhóm; nhóm secure cần kiểm chứng thêm adapter riêng. Phần dưới ghi lại kết quả nghiên cứu ban đầu trước triển khai.

## Kết luận

Có thể tích hợp đọc nhóm, người gửi, biệt danh và danh sách thành viên từ phiên Messenger đang chạy. Đã kiểm tra **Doãn đẹp trai và những người bạn**, nhóm người dùng chỉ định bằng ảnh. Đây là kết quả nghiên cứu; chưa triển khai tính năng nhóm vào beta, chưa thử gửi hay thực hiện thao tác quản lý nhóm.

## Bằng chứng từ nhóm mẫu

| Hạng mục | Kết quả chỉ đọc |
| --- | --- |
| Nhận diện | `LSMessagingThreadTypeUtil.isGroup(thread.threadType) === true` |
| Loại runtime | `I64.to_string(thread.threadType) === "2"`; `isArmadilloSecure` và `isArmadilloSecureGroup` đều false |
| Số thành viên | `threads.memberCount = 3`; truy vấn participants đúng thread cũng trả 3 |
| Hồ sơ | Có 3 bản ghi contacts tương ứng |
| Biệt danh | Cả 3 participants có nickname |
| Vai trò | 1 participant có `isAdmin === true` |
| DOM hiện tại | 15 nhãn tin semantic có người gửi, 3 tác giả phân biệt gồm tài khoản hiện tại |
| Metadata tin | 20 bản ghi gần nhất có `messageId` và `senderId`; cả 3 người gửi đều thuộc nhóm |
| Bảng thông tin | Có điều khiển thông tin cuộc trò chuyện, tùy chỉnh, thành viên và quyền riêng tư/hỗ trợ |

Không lưu ID thread, ID thành viên, tên/biệt danh thành viên, nội dung tin, cookie hay khóa vào báo cáo. Số 20 là giới hạn khảo sát, không phải tổng lịch sử. Cờ runtime trên chỉ xác định adapter phù hợp; không dùng riêng URL để kết luận chính sách mã hóa của mọi loại nhóm.

## Nguồn dữ liệu và cách giới hạn truy vấn

Các module dưới đây là API nội bộ của trang Messenger đã đăng nhập, không phải API công khai có contract ổn định:

- `LSDatabaseSingleton.getLSDatabaseSingletonPromiseOrValue()` lấy database runtime.
- `threads.get(threadKey)` có `threadType`, `threadName`, `memberCount`, `needsAdminApprovalForNewParticipant`.
- `LSMessagingThreadTypeUtil.isGroup` xác nhận nhóm; không suy đoán từ tên hay ảnh đại diện.
- `participants` có khóa chính `[threadKey, contactId]` và các trường `nickname`, `isAdmin`, `isSuperAdmin`, `authorityLevel`, `threadRoles`.
- `contacts.get(contactId)` có `name`, `firstName`, ảnh đại diện và các trường hết hạn/fallback ảnh. Chỉ lấy hồ sơ của participants vừa xác nhận thuộc nhóm.
- `messages` có khóa chính `[threadKey, timestampMs, messageId]`, với `senderId` và `isAdminMessage`.

Chữ ký đọc đã kiểm chứng:

```ts
const key = I64.of_string(verifiedThreadId);
const bounds = { gte: [key], lte: [key] };
const members = db.table("participants").entries(undefined, "asc", bounds);
const recent = db.table("messages").entries(undefined, "desc", bounds);
const next = await members.next(); // { done, value: [primaryKey, row] }
```

`ReQLBounds.extendBounds` mở rộng cận trên bằng MAX_KEY cho các phần khóa còn lại. Vì vậy `lte: [key]` bao gồm mọi thành viên/tin của đúng thread. Khảo sát giới hạn 10 participants và 20 messages; kiểm tra lại `row.threadKey` sau từng dòng, dừng nếu lệch. Không chạy iterator không có cận hoặc quét toàn bộ contacts/messages.

Nhóm mẫu không đi qua adapter MPS hiện tại: `messengerBetaPage` yêu cầu `isArmadilloSecure === true` trước khi gọi `MpsOverBridge`. Cần adapter đọc LS riêng cho loại nhóm này, đồng thời giữ DOM làm nguồn đối chiếu. Nhóm secure cần khảo sát riêng; kết quả nhóm mẫu không chứng minh mọi loại nhóm đều dùng cùng schema.

## Những chỗ hiện đang sai hoặc thiếu

1. **Mất người gửi:** `messengerDOM` đã bắt tên trong `match[1]` của nhãn “Tin nhắn do … gửi lúc …”, nhưng chỉ dùng để xác định incoming/outgoing rồi bỏ tên. `Message`/`BetaText` chưa có dữ liệu người gửi. `Conversation` trong renderer dùng tên hội thoại cho mọi tin incoming, nên hiện tên nhóm thay vì người gửi.
2. **Có thể mất tin do trùng fingerprint:** fallback ID dùng thread, chiều, text và phút/nhãn thời gian, chưa có tác giả. Hai thành viên khác nhau gửi cùng nội dung trong cùng phút có thể cùng ID; bước ingest sau đó giữ một dòng. Đây là trường hợp tái hiện offline, chưa kết luận dữ liệu thật của nhóm mẫu đã bị mất theo cách này.
3. **Ghép API và sửa alias chưa xét tác giả:** chữ ký trong `enrichBetaMessages` và `message-identity` chưa có sender. Khi hỗ trợ nhóm phải bổ sung bằng chứng tác giả; không dùng chỉ text/thời gian để ghép hai người khác nhau.
4. **Thông báo hệ thống:** renderer thay `$PARTICIPANT_FIRST_NAME(...)` không phải tài khoản hiện tại bằng phần cuối tên hội thoại. Với nhóm phải tra đúng participant; nếu chưa biết thì giữ nhãn trung tính, không gán tên nhóm.
5. **Danh sách và trạng thái:** chưa có loại direct/group/unknown, bộ lọc nhóm hoặc danh sách thành viên. Nhóm không nên mang nhãn “Ngoại tuyến” như một người.

Tái hiện bằng dữ liệu hoàn toàn tổng hợp:

```sh
node --import tsx scripts/research-group-fixture.ts
```

Kết quả trước sửa: 3 tin từ 3 người; khi thiếu ID nền tảng chỉ có 2 fingerprint và ingest giữ 2 dòng. Khi có 3 ID nền tảng riêng thì giữ đủ 3 dòng, nhưng cả hai trường hợp đều không giữ người gửi. Script đã được cập nhật để kiểm tra kết quả sau sửa ở đầu báo cáo.

## Thiết kế tích hợp đề xuất

### Bước 1 — đọc đúng và hiển thị đúng

- Thêm loại hội thoại `direct | group | unknown` và metadata nhóm đã xác minh. Loại unknown phải được giữ khi API không sẵn sàng.
- Thêm sender metadata vào Message: ID nếu được xác nhận, tên và biệt danh nếu có. Hiện biệt danh của thành viên trước, tên hồ sơ sau; DOM chỉ biết tên thì giữ tên, không đoán ID theo tên trùng.
- Với mỗi tin, nối `senderId` sang participants/contacts trong đúng thread. Ưu tiên `messageId` nền tảng; đối chiếu DOM và API có kiểm tra tác giả, thứ tự và phạm vi.
- Tách nhóm khỏi bạn bè hoặc cung cấp bộ lọc, hiển thị số thành viên thay trạng thái online/offline; hỗ trợ tìm nhóm và mở nhóm hiện có.
- Mở bảng thành viên chỉ đọc: tên, biệt danh, avatar và vai trò đã xác nhận. Các nhóm lớn cần phân trang, không lấy memberCount làm bằng chứng cache đã đủ.

### Bước 2 — gửi và lịch sử

- Kiểm chứng riêng gửi text, ảnh/tệp và backfill trên nhóm; giữ các chốt đúng tài khoản/thread và không tự gửi lại sau kết quả chưa xác định.
- Kiểm thử hai tác giả gửi cùng text/cùng phút, reply, người rời nhóm, nickname đổi và tin hệ thống. Giữ tin/ảnh có ID khác nhau.
- Dữ liệu cũ chưa có sender không được suy đoán rồi ghi đè. Giữ ID cục bộ/alias và bản sao lưu trước mọi sửa định danh; không chạy lại thuật toán gộp cũ lên nhóm một cách mù quáng.

### Bước 3 — quản lý nhóm

Tạo nhóm, đổi tên/ảnh, đổi biệt danh, thêm/bớt thành viên, chuyển quyền và rời nhóm cần khảo sát luồng thao tác/quyền riêng. Trong đợt này chỉ xác minh khả năng đọc, chưa gọi API ghi và chưa chứng minh contract của các thao tác quản lý.

## Giới hạn và an toàn khi triển khai

Kiểm tra HTTPS origin, tài khoản hiện tại, thread đang chọn và tên/metadata nhóm trước và sau mỗi lượt. Trả về dữ liệu tối thiểu, giữ deadline/hủy tác vụ, đóng trang tạm khi xong và tôn trọng checkpoint/rate-limit/PIN. API nội bộ có thể thay đổi; thiếu contract thì báo không khả dụng hoặc dùng DOM đã xác minh, không đoán nhóm từ một cờ hay số thành viên.

Đợt nghiên cứu chỉ đọc nhóm mẫu và chạy fixture tổng hợp; không gửi tin/tệp, tạo nhóm, thêm/xóa thành viên, đổi tên/biệt danh, chuyển quyền hay rời nhóm. Không thay đổi mã chạy beta trong đợt này.
