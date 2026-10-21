import type { WebContents } from "electron";
import { contactSearchScript, type MessengerContactHit } from "../src/core/contact-search.ts";

// Run inside an isolated owning window: typing must never alter the manager's
// search, inbox position or draft. Every operation has cancellation and a bound.
export async function searchMessengerContacts(wc: WebContents, query: string, signal: AbortSignal, check: () => Promise<void>) {
  const deadline = Date.now() + 20_000;
  const delay = () => new Promise(resolve => setTimeout(resolve, 200));
  for (;;) {
    signal.throwIfAborted();
    await check();
    const focus = await wc.executeJavaScript(contactSearchScript("focus", query));
    if (focus.ready) break;
    if (Date.now() >= deadline) throw new Error("Messenger chưa sẵn sàng để tìm liên hệ. Thử lại sau.");
    await delay();
  }
  await wc.insertText(query);
  const started = Date.now();
  let signature = "", changedAt = started;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    await check();
    const result = await wc.executeJavaScript(contactSearchScript("read", query));
    const next = JSON.stringify(result.hits);
    if (next !== signature) { signature = next; changedAt = Date.now(); }
    // The initial popup only contains "search messages". Do not mistake that
    // transient suggestion for an empty contact response while the fetch runs.
    if (result.ready && !result.busy && Date.now() - started >= (result.hits.length ? 1200 : 8000) && Date.now() - changedAt >= 600)
      return result.hits as MessengerContactHit[];
    await delay();
  }
  throw new Error("Messenger chưa trả kết quả tìm kiếm. Thử lại sau.");
}
