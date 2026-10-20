## macOS window fix in v0.1.2

- Opens the main window before accessing Keychain or starting Messenger. A Keychain confirmation after an app signature change can otherwise block the main thread long enough for the first renderer's connection to time out, leaving the app running without a window.
- Enables the renderer sandbox and restores the main window when the Dock icon is activated after loading. The preload uses only APIs supported in the sandbox.
- Replaces the process-only startup check with a packaged app smoke test: the main window must be visible, React must render, preload IPC must respond, and bundled skin/media resources must load. The test uses a disposable profile without connecting to Messenger.

## macOS packaging

- Replaces the invalid macOS signature in v0.1.0 with a complete ad-hoc signature for the app and its nested helpers/frameworks.
- Both macOS CI jobs verify signatures and test the packaged window before uploading installers.
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
