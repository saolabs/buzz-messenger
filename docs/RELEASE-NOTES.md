# Buzz! Messenger v0.2.1

## What's new

- Group chats have their own buddy-list section, sender names/nicknames, and a paginated member panel with admin labels. Click a member to open a private chat after Messenger verifies the recipient.
- Send files and images with the attachment picker or drag and drop. Preview/remove selections before sending; dropping a file never sends it automatically. Limits: 10 files, 25 MB per file, 50 MB total.
- The composer adds bundled sound clips and local text styling. Formatting affects Buzz only; Messenger receives plain text.
- Contact search now queries Messenger beyond the loaded buddy list and resolves the actual private thread before opening it. Names with and without Vietnamese accents are supported.
- Contact and older-message pagination now use the correct scrolling surfaces and wait for delayed Messenger history loads.
- Improved message identity reconciliation prevents duplicate group rows when Messenger switches between names/nicknames or reloads history. Existing media and encrypted repair backups are retained.
- Corrected multiline message rendering, composer layout, toolbar hover/pressed states and contact search width. The buddy window starts centered along the right screen edge; successful sign-in displays its connected icon for two seconds.
- Added guarded Messenger web API enrichment for supported conversations, with DOM fallback before a send is attempted and no automatic resend after an uncertain result.

## Release validation fix

The v0.2.0 build was not published: CI caught a group fixture checking the buddy list before its contacts IPC response arrived. v0.2.1 waits for the actual group row and adds a delayed contacts response to reproduce that ordering. The application features are unchanged from the prepared v0.2.0 build.

## Verification and limits

- 123 core tests, TypeScript checks and renderer/main/preload builds pass. Offline Electron fixtures cover calls, uploads/composer, pagination, search, groups and verified member opening.
- Real-session checks on macOS cover contact search, older history, group sender/member display, duplicate repair and opening a member's private chat. Automated fixture sends/uploads do not establish delivery to real recipients.
- File sending and live voice/video calls still need end-to-end checks with real recipients on each supported platform. Group administration, reply/reactions/@mentions and sent/delivered/read indicators are not included.
- Messenger integration still needs embedded Chromium and an authenticated Messenger session. Internal web APIs are experimental and can change; this is not an independent HTTP Messenger client.
- [Next implementation plan](https://github.com/saolabs/buzz-messenger/blob/main/docs/ROADMAP.md): in-chat search, clipboard images and persistent drafts first, then image navigation/favorites and research for reply/reactions/mentions.

## Tiếng Việt — thay đổi chính

- Hỗ trợ nhóm, biệt danh người gửi, bảng thành viên/quản trị viên; bấm thành viên mở đúng chat riêng.
- Gửi tệp/ảnh qua nút đính kèm hoặc kéo thả, có xem trước và chỉ gửi khi bấm Gửi.
- Sửa tìm liên hệ, tải thêm danh bạ/tin cũ, tin nhóm bị lặp và hiển thị xuống dòng; giữ ảnh và bản sao sửa cache.
- Hoàn thiện thanh soạn, âm thanh vui, định dạng chữ cục bộ và vị trí cửa sổ sát cạnh phải, căn giữa theo chiều dọc.
- Kế hoạch tiếp theo đã lưu trong ROADMAP; các mục chưa hoàn thành không nằm trong bản này.

## macOS packaging

- Retains complete ad-hoc signing of the app and nested helpers/frameworks when no Developer ID certificate is configured.
- Both macOS CI jobs verify signatures and launch the packaged renderer with an isolated profile before uploading installers. Camera/microphone purpose strings and entitlements are included for user-initiated Messenger calls.
- These preview macOS builds are **ad-hoc signed, not Developer ID signed or notarized**. Gatekeeper may still block downloaded copies. See [Apple's instructions](https://support.apple.com/en-au/102445) and the [Vietnamese installation guide](https://github.com/saolabs/buzz-messenger/blob/main/docs/HUONG-DAN.md#macos-chặn-mở-ứng-dụng).

## Download

Choose the installer for your computer. Node.js, npm, and source builds are not required.

| Computer | File |
| --- | --- |
| Windows, Intel/AMD 64-bit | `win-x64-setup.exe` (installer) or `win-x64-portable.exe` (no installation) |
| Mac with Apple Silicon | `mac-arm64.dmg` or `mac-arm64.zip` |
| Mac with Intel processor | `mac-x64.dmg` or `mac-x64.zip` |
| Linux, Intel/AMD 64-bit | `linux-x86_64.AppImage` or `linux-amd64.deb` (Debian/Ubuntu) |

Every filename starts with `buzz-messenger-<version>-`. Checksums are included in `SHA256SUMS.txt`.

On macOS, open the DMG and drag the app to Applications, or unzip the ZIP. On Windows, run the setup file or launch the portable executable. On Linux, make the AppImage executable before opening it, or install the DEB with your package manager. Linux needs an available OS key store for the encrypted vault.

The app is under development. A successful package build does not confirm every Messenger feature on each platform. Windows builds are currently unsigned.

## Tiếng Việt

Chọn file theo hệ điều hành và bộ xử lý trong bảng trên, tải về và cài/mở ứng dụng. Không cần Node.js, npm hoặc tự build. `arm64` dành cho Mac Apple Silicon; `x64` dành cho bộ xử lý Intel/AMD. Xem [hướng dẫn tiếng Việt](https://github.com/saolabs/buzz-messenger/blob/main/docs/HUONG-DAN.md).
