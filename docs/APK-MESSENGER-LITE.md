# Phân tích APK Messenger Lite và khả năng tích hợp Buzz!

Ngày phân tích: **2026-10-21**. Dự án được đối chiếu là `buzz-messenger`.

**Kết luận:** Có thể trích xuất giao thức để nghiên cứu một transport trực tiếp cho Buzz, nhưng APK này chưa đủ cơ sở để thay Chromium bằng API. Đã tìm được luồng HTTP đăng nhập/GraphQL, MQTT và cầu nối MSYS `/ls_req`–`/ls_resp`. Phần payload MSYS nằm sau native/JNI, còn khả năng đăng nhập, đồng bộ và giải mã hội thoại hiện tại chưa được kiểm chứng với máy chủ. Nên giữ transport web và chỉ phát triển adapter thử nghiệm khi có bằng chứng tương thích thực tế.

## 1. Mẫu và phạm vi kiểm tra

| Thuộc tính | Kết quả |
| --- | --- |
| File | `com.facebook.mlite.apk` |
| Kích thước | 7,576,481 byte |
| SHA-256 | `3ae161483afbed5a2dd98890cb35380de1fee7b6127a58c2251b9c91378e5b2d` |
| Package | `com.facebook.mlite` |
| Version / versionCode | `62.2.1.14.283` / `162713145` |
| Android min / target SDK | 14 / 26 |
| Bytecode | 1 DEX; 6,947 lớp định nghĩa; 35,069 mục method trong DEX, gồm cả tham chiếu |
| Native | 18 thư viện, chỉ ABI `armeabi-v7a` |
| Công cụ | Androguard 4.1.4, decompiler DAD |

Đã giải mã manifest, xuất chuỗi DEX và tham chiếu đến hàm gọi, decompile 25 lớp chọn lọc cùng các hàm liên quan, trích schema SQL và thư viện native. **Đây là phân tích tĩnh chọn lọc, không phải decompile hoàn chỉnh toàn bộ app hay reverse engineering hoàn chỉnh native.** Source DAD có biến/tên lớp bị obfuscate, đôi chỗ suy luận kiểu hoặc control flow không chính xác; dùng để lần dấu và cần đối chiếu bytecode khi triển khai.

Chưa chạy APK, chưa đăng nhập, chưa dùng cookie/token tài khoản, chưa thử API có xác thực và chưa gửi tin. Các endpoint dưới đây là hành vi trong mẫu APK, **không phải xác nhận server còn hỗ trợ**.

Chứng thư trong APK khai chủ thể Facebook Corporation / Facebook Mobile. Chỉ đọc chứng thư không đồng nghĩa đã xác minh đầy đủ chữ ký và nguồn phân phối. `build-data.properties` thuộc Google Play Services; timestamp trong đó không được dùng làm ngày build của APK.

## 2. Các API và giao thức tìm thấy

### Đăng nhập và phiên

| Chức năng | Đường dẫn trong APK | Bằng chứng |
| --- | --- | --- |
| Đăng nhập | `https://api.facebook.com/method/auth.login` | `X/1U5.D`: tier `api`, path `method/auth.login`; `X/1TU.DD/wN` ghép host HTTPS |
| Chuyển phiên giữa app | `https://b-api.facebook.com/method/auth.getSessionForApp` | `X/1U4.D`: `access_token`, `new_app_id` |
| Bổ sung thông tin thiết bị | Cùng request đăng nhập | `X/0Pt.A`: `device_id`, `generate_session_cookies=1`, `machine_id` hoặc `generate_machine_id=1` |
| Header xác thực | `Authorization: OAuth <token>` | `X/1TW.lH`, `X/1ba.B` |

`X/1U5.D` đặt các trường `email`, `password`, `credentials_type`, `error_detail_type`. Nhánh `two_factor` bổ sung `userid`, `twofactor_code`, `first_factor`. Đây là luồng xác thực của app nội bộ; tìm thấy tên trường không chứng minh có thể dùng client tùy ý để đăng nhập hiện nay. Không xem token web và token mobile là tương đương khi chưa xác minh.

`X/1U8.LL` đọc phản hồi gồm `uid`, `access_token`, `machine_id`, `secret`, `session_cookies`, `session_key`, `confirmed`. Đây là **tên trường**, không phải thông tin tài khoản lấy được từ APK.

`X/0OT.C` thực sự tạo HTTP **POST**, thêm trường `method` và mặc định bọc body bằng gzip. Vì vậy giá trị `E="get"` hoặc `E="auth.getSessionForApp"` trong builder không thể được diễn giải thẳng thành HTTP verb GET. Muốn tái tạo request cần đọc cả serializer/interceptor và metadata ứng dụng.

### Đọc inbox, hội thoại và hồ sơ

Đường dẫn là `https://graph.facebook.com/graphql`. `X/0OU` chọn tier `graph`, path `graphql`, gắn `query_id` và `query_name`. `X/0hk.call` còn gắn `query_params`, `flat_buffer_idl`, `oss_response_format=true` cho một nhánh hàng đợi GraphQL. Không mặc định phản hồi luôn là JSON dễ đọc.

Các ID sau lấy từ **`X/1TZ.C`**, đã đối chiếu với tên ở **`X/1TZ.B`**. Không nhầm với bộ số khác trong `X/1TZ.A`.

| Query | query_id trong mẫu |
| --- | --- |
| `ThreadListInitialQuery` | `1990976881198949` |
| `ThreadByIdQuery` | `627533151032557` |
| `MessageQuery` | `364638224337931` |
| `MessageThreadAndContactQuery` | `1267258626782119` |
| `ContactsQuery` | `359153961295912` |
| `ProfileDetailsQuery` | `297802904402532` |
| `MessageReactionMutation` | `268959453538558` |

Đây là persisted query ID của phiên bản APK này. Chưa thử độ hiệu lực, bộ biến đầu vào đầy đủ, quyền của token hoặc pagination trên tài khoản hiện tại; không nên hardcode vào transport production.

### Nhận/gửi thời gian thực

`X/0go.B` cấu hình **MQTT qua TLS tới `mqtt-mini.facebook.com:443`**, đưa định danh người dùng và token vào cấu hình kết nối. Nhánh có override địa chỉ mạng dùng port `9002`; không coi đó là port mặc định. `edge-mqtt.facebook.com` cũng xuất hiện trong cấu hình `X/0Tz`, nhưng chưa lần được một luồng kết nối hoạt động tới host đó.

Có hai mức bằng chứng khác nhau:

| Nhóm | Bằng chứng và giới hạn |
| --- | --- |
| `/ls_req`, `/ls_resp` | Có luồng gọi thực: `MqttNetworkSessionPlugin.onPublish` chỉ chấp nhận `/ls_req`, đưa payload byte vào publish topic ID 178; `X/0Vx.qM` đăng ký topic ID 179 (`/ls_resp`) khi feature gate MSYS bật. Payload nhận được chuyển tới JNI/native. |
| `ls_sv`, `ls_fdid` | `X/0Vx.kM` thêm phiên bản schema MSYS và family device ID vào metadata kết nối. |
| `/send_message`, `/send_message2`, `/send_message_response`, `/t_ms`, `/messenger_sync*` | Có trong bảng ánh xạ topic `X/0UP.B`. Chưa chứng minh đây là nhánh gửi/nhận được chọn khi chạy. Không gọi các tên này là REST endpoint. |
| Thrift/Omnistore | Có parser Thrift và translator delta/receipt; callback stored procedure nhận tin trong `X/1dS` gọi `X/0r1.J`. Cần lần tiếp nhánh tương ứng nếu muốn tái hiện đầy đủ. |

MSYS có các hàm native `onMqttPublishReceived`, `onGetMsysSchemaVersion`, `onMqttPubAck`... Do đó chỉ dùng một MQTT client rồi publish JSON vào tên topic tìm thấy sẽ chưa tái tạo được hành vi app. Còn phải xác định framing/codec, handshake, schema, snapshot/delta, cursor, ACK, reconnect và đối soát ID tin gửi.

### Gửi media

`X/1ba.C` chọn các URL gốc:

- `https://rupload.facebook.com/messenger_image/`
- `https://rupload.facebook.com/messenger_audio/`
- `https://rupload.facebook.com/messenger_video/`
- `https://rupload.facebook.com/messenger_file/`

URL hoàn chỉnh được ghép thêm định danh. Luồng có GET để đọc `offset`, rồi POST upload với `Offset`, `X-Entity-Length`, `X-Entity-Name`, `X-Entity-Type`; header dùng OAuth token. Phản hồi đọc `media_id` và `success`. Upload thành công chưa đồng nghĩa attachment đã được gửi vào hội thoại; cần tiếp luồng tạo/gửi message và nhận ACK.

## 3. Điểm chặn với Messenger hiện tại

**E2EE và lịch sử:** Meta đã thay đổi giao thức để hỗ trợ Signal, nhiều thiết bị và kho lịch sử mã hóa Labyrinth. Token và danh sách endpoint không thay thế khóa thiết bị hoặc quy trình khôi phục lịch sử. Xem [giải thích kỹ thuật của Meta](https://engineering.fb.com/2023/12/06/security/building-end-to-end-security-for-messenger/).

Mẫu APK có chuỗi loader `LibSignalProtocolCV2` trong DEX và `MSMSignalProtocolWrapper` trong `libomnibus.so`. **Không được kết luận APK hoàn toàn không có Signal/E2EE.** Tuy nhiên các dấu này chưa chứng minh khả năng xử lý E2EE, quản lý thiết bị và khôi phục lịch sử của Messenger hiện tại; chưa reverse xong nhánh native đó.

**Tuổi đời sản phẩm:** Messenger Lite đã dừng hoạt động từ tháng 9/2023. [Nguồn thông tin đóng sản phẩm](https://techcrunch.com/2023/08/24/meta-is-shutting-down-messenger-lite-for-android-in-september/). Không suy ra mọi endpoint chung Facebook đều đã tắt; từng luồng vẫn cần kiểm chứng riêng.

**API công khai:** Messenger Platform của Meta yêu cầu Facebook Page, quyền `pages_messaging` và Page access token. Nó phục vụ nhắn tin với Page; không phải phương án thay trực tiếp inbox cá nhân đang dùng trong Buzz. Tham khảo [collection do Meta cung cấp](https://www.postman.com/meta/messenger-platform-api/collection/iyp204x/messenger-platform-api).

**Native/desktop:** Thư viện trong APK là Android ARMv7, không thể đưa trực tiếp vào Electron trên macOS/Windows/Linux để chạy. Cần port protocol hoặc dùng một bridge Android riêng; bridge vẫn chịu giới hạn tương thích của app/server.

## 4. Áp dụng vào Buzz!

Hiện tại `MessengerService` gọi `Browsers` để đăng nhập, quét inbox, đọc/gửi qua DOM. Cookie và PIN nằm trong vault; app dựa vào Messenger web để xử lý E2EE/khôi phục. `INBOX_EVERY=5000`, `WATCH_EVERY=1000`; vì thế transport trực tiếp có tiềm năng giảm số trang Chromium và độ trễ, nhưng **chưa có benchmark hay thử nghiệm chức năng để xác nhận lợi ích**.

| Hướng | Đánh giá |
| --- | --- |
| Dùng ngay các API trong APK thay Chromium | Chưa đủ bằng chứng: auth, codec native và E2EE hiện tại đều chưa xác nhận. |
| Adapter trực tiếp ở chế độ thử nghiệm | Khả thi để nghiên cứu; phải vượt qua các mốc xác thực, đọc lịch sử E2EE, realtime và đối soát gửi. |
| Giữ transport web hiện tại | Phương án áp dụng ngay cho mục tiêu chat cá nhân; vẫn phụ thuộc DOM Messenger. |
| Messenger Platform cho fanpage | Có đường tích hợp công khai nhưng thuộc loại tài khoản khác, cần adapter riêng nếu sản phẩm mở rộng sang Page. |

Nếu tiếp tục triển khai, thứ tự đề xuất:

1. Thu thập mẫu giao thức từ client hiện còn hoạt động với tài khoản thử được phép sử dụng; đối chiếu với APK này. Làm rõ token, thiết bị, E2EE và native payload trước.
2. Tách hợp đồng transport quanh các thao tác `connect`, `listThreads`, `readMessages`, `subscribe`, `send`, `signOut`, giữ `Browsers` làm implementation hiện tại. Đây mới là đề xuất, chưa sửa runtime.
3. Prototype **chỉ đọc** một hội thoại E2EE có sẵn: khôi phục lịch sử, nhận một tin mới, reconnect và đối soát không thiếu/trùng tin. Chỉ thấy danh bạ hoặc login thành công chưa đạt mốc này.
4. Khi đọc ổn định mới thử gửi với người nhận thử đã xác định: giữ client message ID, nhận server ACK, kiểm tra kết quả khi mất kết nối/timeout, không tự gửi lại khi kết quả chưa rõ.
5. Chỉ cân nhắc thay transport mặc định sau khi xác nhận media, nhiều thiết bị, đăng xuất và xóa phiên. Giữ định danh message/cursor/key material riêng theo transport; không trộn vào ID DOM bằng giả định.

## 5. Đầu ra để kiểm tra lại

Thư mục giải nén cục bộ: [`../_extracted/mlite/`](../_extracted/mlite/), nằm trong vùng Git đã bỏ qua. APK và source bên thứ ba chưa được thêm vào Git.

| File/thư mục | Nội dung |
| --- | --- |
| `AndroidManifest.decoded.xml` | Package, version và permissions đã giải mã |
| `analysis-summary.json` | Metadata và phạm vi phân tích |
| `dex-strings.txt` | Chuỗi trong DEX |
| `string-xrefs.json`, `expanded-string-xrefs.json` | Chuỗi → hàm gọi |
| `topic-callers.json` | Call site bytecode tới bảng tên MQTT topic |
| `classes/` | 25 lớp decompile chọn lọc |
| `decompiled/`, `expanded/` | Hàm decompile theo nhóm tham chiếu |
| `lib/armeabi-v7a/` | 18 thư viện native đã trích |
| `assets/sql/Processed/Schema.sql` | Schema lưu trữ; không phải đặc tả wire protocol |
| `tools/` | Script phân tích đã dùng và phiên bản dependency |

Danh mục endpoint/query/topic dạng máy đọc: [`research/mlite-api-catalog.json`](research/mlite-api-catalog.json).

Các file nguồn bằng chứng chính: `classes/X_1U5.java`, `decompiled/LX_0Pt___A_25.java`, `classes/X_1U8.java`, `classes/X_0OT.java`, `classes/X_1TZ.java`, `decompiled/LX_0go___B_52.java`, `classes/X_0Vx.java`, `classes/com_facebook_msys_mci_MqttNetworkSessionPlugin.java`, `expanded/LX_1ba___C_32.java`.

Không chạy build/test app vì chỉ tạo báo cáo và dữ liệu nghiên cứu. Đã kiểm tra checksum, manifest, tham chiếu hàm, ánh xạ query ID và tính hợp lệ của danh mục JSON. Chưa có kết quả kiểm thử tích hợp API thật.
