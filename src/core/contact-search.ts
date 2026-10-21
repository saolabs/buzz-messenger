export type MessengerContactHit = { providerId: string; name: string; avatar?: string };

export const foldContactName = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();

// Only the Messenger combobox and the listbox it owns are search results.
// The inbox remains in the DOM behind that popup; never parse its rows here.
export function contactSearchDOM(action: "focus" | "read" | "select", query: string, hit?: MessengerContactHit) {
  if (location.protocol !== "https:" || !["www.facebook.com", "facebook.com"].includes(location.hostname) || !location.pathname.startsWith("/messages/"))
    throw new Error("Trang tìm kiếm Messenger không hợp lệ.");
  const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
  const visible = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest('[aria-hidden="true"]');
  const inputs = [...document.querySelectorAll<HTMLInputElement>('input[role="combobox"]')].filter(el =>
    visible(el) && /^(?:tim kiem tren messenger|search messenger)$/i.test(fold(el.getAttribute("aria-label") ?? el.placeholder).trim()));
  if (inputs.length !== 1) return { ready: false, hits: [] as MessengerContactHit[] };
  const input = inputs[0];
  if (action === "focus") {
    input.focus();
    input.select();
    return { ready: true, hits: [] as MessengerContactHit[] };
  }
  if (input.value.normalize("NFC").trim() !== query.normalize("NFC").trim()) return { ready: false, hits: [] as MessengerContactHit[] };
  const box = document.getElementById(input.getAttribute("aria-controls") ?? "");
  if (!box || box.getAttribute("role") !== "listbox" || !visible(box)) return { ready: false, hits: [] as MessengerContactHit[] };
  const rows = [...box.querySelectorAll<HTMLElement>('[role="option"]')].filter(el => visible(el) && /^\d+$/.test(el.id));
  const hits: MessengerContactHit[] = [];
  for (const row of rows) {
    const name = (row.getAttribute("aria-label") ?? row.querySelector('span[dir="auto"]')?.textContent ?? "").normalize("NFC").trim();
    if (!name || /^(?:tim kiem tin nhan cho|search messages for)(?:\s|$)/.test(fold(name)) || hits.some(h => h.providerId === row.id)) continue;
    const raw = row.querySelector<HTMLImageElement>("img")?.src;
    let avatar: string | undefined;
    if (raw) {
      try { const u = new URL(raw); if (u.protocol === "https:" && /(^|\.)fbcdn\.net$/.test(u.hostname)) avatar = u.href; } catch {}
    }
    hits.push({ providerId: row.id, name, avatar });
  }
  if (action === "select") {
    const matches = rows.filter(el => el.id === hit?.providerId && hits.some(h => h.providerId === el.id && h.name === hit.name));
    if (matches.length !== 1) throw new Error("Kết quả tìm kiếm đã thay đổi. Hãy tìm lại liên hệ.");
    const link = matches[0].querySelector<HTMLAnchorElement>("a[href]");
    if (!link) throw new Error("Không mở được liên hệ từ kết quả Messenger.");
    const url = new URL(link.href);
    if (url.protocol !== "https:" || !["www.facebook.com", "facebook.com"].includes(url.hostname) || !url.pathname.startsWith("/messages/"))
      throw new Error("Liên kết liên hệ không hợp lệ.");
    link.click();
  }
  return { ready: true, busy: !!box.querySelector('[role="progressbar"],[aria-busy="true"]'), hits: hits.slice(0, 50) };
}

export function contactSearchScript(action: Parameters<typeof contactSearchDOM>[0], query: string, hit?: MessengerContactHit) {
  return `(()=>{const __name=(fn)=>fn;return (${contactSearchDOM.toString()})(${JSON.stringify(action)},${JSON.stringify(query)},${JSON.stringify(hit)})})()`;
}
