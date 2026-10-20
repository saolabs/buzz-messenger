# Build và phát hành bộ cài

[README tiếng Việt](../README.vi.md) · [Tài liệu phát triển](PHAT-TRIEN.md)

Người dùng tải bộ cài tại [GitHub Releases](https://github.com/saolabs/buzz-messenger/releases). Mỗi bộ cài đã chứa Electron, giao diện React và tài nguyên trong `resources/ym/`; người dùng không cần Node.js, npm, Python hoặc mã nguồn.

## Các bản được cấu hình

| Nền tảng | Runner GitHub Actions | Đầu ra |
| --- | --- | --- |
| Mac Apple Silicon | `macos-15`, arm64 | DMG, ZIP |
| Mac Intel | `macos-15-intel`, x64 | DMG, ZIP |
| Windows Intel/AMD 64-bit | `windows-2022`, x64 | NSIS setup EXE, portable EXE |
| Linux Intel/AMD 64-bit | `ubuntu-24.04`, x64 | AppImage, DEB |

Tên file có phiên bản, nền tảng và kiến trúc. Ví dụ `buzz-messenger-0.1.0-win-x64-setup.exe` và `buzz-messenger-0.1.0-mac-arm64.dmg`. Windows ARM, Linux ARM và bản 32-bit chưa nằm trong workflow.

## Đưa mã nguồn lên GitHub lần đầu

Repository cần có mã nguồn, `package-lock.json`, `.github/workflows/release.yml` và toàn bộ `resources/ym/`. APK, bộ cài gốc, `_extracted/`, `node_modules/`, `out/` và `dist/` đã được Git bỏ qua.

Từ thư mục dự án, sau khi kiểm tra các file sẽ commit:

```sh
git add .
git commit -m "Prepare Buzz! Messenger desktop releases"
git push -u origin main
```

Các lệnh này là hướng dẫn cho maintainer; việc thêm workflow cục bộ không tự push mã nguồn hoặc chạy GitHub Actions.

## Tạo một phiên bản

1. Sửa `version` trong `package.json` cho bản mới; cập nhật lockfile bằng `npm install --package-lock-only` nếu đổi phiên bản. Cập nhật `docs/RELEASE-NOTES.md` khi cần.
2. Commit và push thay đổi lên GitHub, bao gồm tài nguyên runtime.
3. Tạo tag trùng với phiên bản, có tiền tố `v`. Với phiên bản hiện tại:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. Mở **Actions → Build desktop release** để theo dõi. Workflow kiểm tra phiên bản, tài nguyên, typecheck và test, rồi chạy 4 job đóng gói trên đúng hệ điều hành/kiến trúc.
5. Khi cả 4 job thành công, workflow gom đủ 8 bộ cài, tạo `SHA256SUMS.txt` và tải lên một **draft release**. Nếu một nền tảng thất bại, không tạo Release với bộ cài thiếu.
6. Tải các bản từ draft để thử trên máy tương ứng. Kiểm tra ghi chú ký ứng dụng trong Release, rồi bấm **Publish release** để người dùng tải được.

Cũng có thể chạy **Run workflow** với một tag đã tồn tại, chẳng hạn `v0.1.0`. Workflow phải có trên nhánh mặc định để nút chạy thủ công xuất hiện. Chạy lại có thể cập nhật file của draft hiện có; workflow từ chối thay thế file của Release đã công bố. Bản đã công bố cần được sửa bằng phiên bản/tag mới.

Workflow dùng `GITHUB_TOKEN` có sẵn, không cần tạo personal access token. Chỉ job gom Release có quyền `contents: write`; các job build chỉ đọc repository. Chính sách Actions của tổ chức vẫn có thể hạn chế quyền tạo Release.

## Ký ứng dụng

Đóng gói và ký ứng dụng là hai việc riêng. Bản không ký vẫn là bộ cài hoàn chỉnh nhưng có thể bị hệ điều hành cảnh báo hoặc chặn. Để phân phối cho người dùng thông thường, nên chuẩn bị ký Windows và ký/notarize macOS.

Workflow đã nối các **repository secrets** tùy chọn vào bước đóng gói:

| Nền tảng | Secrets |
| --- | --- |
| macOS signing | `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` |
| macOS notarization | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Windows signing | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` |

Các giá trị `*_CSC_LINK` dùng định dạng chứng chỉ mà electron-builder hỗ trợ, chẳng hạn nội dung base64 của chứng chỉ `.p12`/`.pfx`, cùng mật khẩu tương ứng. Chứng chỉ macOS cần danh tính Developer ID Application hợp lệ. Không commit chứng chỉ hoặc mật khẩu vào repository. Khi chưa có secrets, workflow vẫn build; bản tạo ra chưa được bảo đảm ký/notarize. Sau khi cấu hình, kiểm tra log và kết quả ký thực tế trước khi công bố.

## Build thủ công

Nếu cần build trên máy tương ứng mà không chạy Actions:

```sh
npm ci
npm run dist:mac -- --arm64 --publish never
# Mac Intel: npm run dist:mac -- --x64 --publish never
# Windows: npm run dist:win -- --x64 --publish never
# Linux: npm run dist:linux -- --x64 --publish never
```

Đầu ra nằm trong `dist/`. Dùng đúng máy/runner cho từng nền tảng; workflow đã bố trí sẵn nên không cần build chéo tất cả từ Mac. `--publish never` chỉ tạo file cục bộ; nó không tự tải lên Release.

## Nguồn tham khảo

- [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
- [Sự kiện chạy workflow](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
- [electron-builder: build đa nền tảng](https://www.electron.build/docs/features/multi-platform-build/).
- [electron-builder: ký ứng dụng](https://www.electron.build/code-signing/).
