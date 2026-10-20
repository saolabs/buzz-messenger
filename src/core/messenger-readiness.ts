import type { MessengerRead } from "./messenger.ts";

// readOnly (Buzz!): chỉ đọc tin trên trang mở riêng cho đúng hội thoại → mã hội thoại trên URL là đủ. Bỏ các kiểm tra
// chống gửi nhầm (dòng đang chọn trong danh sách chat, ô soạn + tên trong ô soạn): danh sách chat ảo hóa thường không
// vẽ dòng của hội thoại ở xa, ô soạn hiện muộn khi trang vừa tải → đọc thất bại, mất tin đến. Gửi vẫn kiểm đủ (preflight).
export function messengerReadIssue(
  read: MessengerRead,
  expected: { platformId: string; name: string; readOnly?: boolean },
): string | null {
  if (read.blocked)
    return (
      read.blockedReason ?? "Messenger có hộp thoại hoặc yêu cầu đăng nhập/PIN."
    );
  if (read.threadId !== expected.platformId)
    return `URL hội thoại chưa khớp (cần ${expected.platformId}, nhận ${read.threadId ?? "không có"}).`;
  if (!expected.readOnly && read.selectedThreadId !== expected.platformId)
    return `Danh sách chat chưa chọn đúng hội thoại (cần ${expected.platformId}, nhận ${read.selectedThreadId ?? "không có"}).`;
  if (!expected.readOnly && !read.composerPresent) return "Ô soạn tin chưa sẵn sàng.";
  // Trang vừa tải: URL đã đúng nhưng React chưa vẽ tin → đọc ra 0 tin, mất tin đến. Cần thấy tin hoặc ô soạn.
  if (expected.readOnly && !read.composerPresent && !read.messages.length) return "Hội thoại chưa hiện tin.";
  if (
    !expected.readOnly &&
    read.name.normalize("NFC").trim().toLocaleLowerCase() !==
      expected.name.normalize("NFC").trim().toLocaleLowerCase()
  )
    return "Tên người nhận trong ô soạn chưa khớp tên hội thoại đã lưu.";
  if (read.ambiguous && !expected.readOnly)
    return `${read.ambiguous} tin trùng định danh DOM; cần ID nền tảng để phân biệt.`;
  return null;
}

// Chỉ đọc (Buzz!): tin giống hệt nhau trong cùng phút ("ok", "BUZZ!!!" gửi liên tiếp) có cùng ID suy từ nội dung → đánh
// số theo thứ tự xuất hiện thay vì từ chối đọc cả hội thoại. Gửi tin vẫn từ chối khi trùng (messengerReadIssue).
// ponytail: thứ tự lệch nếu một phần các tin trùng nằm ngoài vùng DOM đang vẽ; cần ID nền tảng nếu gặp thật.
export function disambiguate<T extends { id: string }>(messages: T[]): T[] {
  const seen = new Map<string, number>();
  return messages.map((m) => {
    const n = (seen.get(m.id) ?? 0) + 1;
    seen.set(m.id, n);
    return n > 1 ? { ...m, id: `${m.id}#${n}` } : m;
  });
}

// Scroll and React hydration can temporarily unmount the selected link/composer.
// Poll actual readiness at every history stage; elapsed time alone never authorizes a read.
export async function waitForMessengerRead(
  capture: () => Promise<MessengerRead>,
  expected: { platformId: string; name: string; readOnly?: boolean },
  stage: string,
  delay = () => new Promise<void>((resolve) => setTimeout(resolve, 250)),
  onRetry?: (read: MessengerRead, attempt: number) => Promise<void>,
): Promise<MessengerRead> {
  let issue = "DOM chưa sẵn sàng.";
  for (let attempt = 0; attempt < 12; attempt++) {
    const read = await capture();
    const current = messengerReadIssue(read, expected);
    if (!current) return read;
    issue = current;
    if (attempt < 11) {
      await onRetry?.(read, attempt);
      await delay();
    }
  }
  throw new Error(`${stage}: ${issue}`);
}
