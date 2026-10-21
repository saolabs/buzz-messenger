import type { WebContents } from "electron";

// Executed only after the host proves session, thread, selection and recipient.
export function uploadDOM(action: "input" | "ready", tag: string, names: string[]) {
  const boxes = [...document.querySelectorAll<HTMLElement>('[contenteditable="true"][role="textbox"]')]
    .filter(e => e.getClientRects().length > 0);
  if (boxes.length !== 1) throw new Error("Không xác định được ô soạn để đính kèm.");
  const main = boxes[0].closest('[role="main"]') ?? boxes[0].parentElement!;
  const scope = window as unknown as { __buzzUpload?: { tag: string; images: string[] } };
  if (action === "input") {
    const inputs = [...main.querySelectorAll<HTMLInputElement>('input[type="file"]')]
      .filter(e => !e.disabled && (!e.accept || e.accept === "*/*"));
    if (inputs.length !== 1) throw new Error("Không tìm thấy duy nhất ô đính kèm tệp Messenger.");
    if (inputs[0].files?.length) throw new Error("Messenger còn tệp chưa gửi. Kiểm tra bản nháp trước khi gửi tiếp.");
    scope.__buzzUpload = { tag, images: [...main.querySelectorAll<HTMLImageElement>("img")].map(img => img.src) };
    inputs[0].setAttribute("data-buzz-upload", tag);
    return { ready: false };
  }
  const input = main.querySelector<HTMLInputElement>(`input[data-buzz-upload="${tag}"]`);
  const selected = Array.from(input?.files ?? []);
  const draftNodes = [...main.querySelectorAll<HTMLElement>('[aria-label],img,a,span')]
    .filter(e => !e.closest('[role="log"],[role="article"],[role="grid"]') && !e.querySelector('[role="log"],[role="article"],[role="grid"]'));
  const draftText = draftNodes.map(e => `${e.getAttribute("aria-label") ?? ""} ${e.textContent ?? ""}`).join(" ");
  const filesPresent = selected.length === names.length && selected.every((f, i) => f.name === names[i]);
  const namesPresent = names.every(name => draftText.includes(name));
  // React may clear/recreate the native input after taking ownership of Files.
  // Image drafts often show only thumbnails, without their file names.
  const imageNames = names.filter(name => /\.(png|jpe?g|gif|webp)$/i.test(name));
  const newImages = scope.__buzzUpload?.tag === tag ? draftNodes.filter((e): e is HTMLImageElement => e instanceof HTMLImageElement)
    .filter(img => img.getClientRects().length && !!img.src && !scope.__buzzUpload!.images.includes(img.src)).length : 0;
  const previewsPresent = imageNames.length > 0 && newImages >= imageNames.length
    && names.filter(name => !imageNames.includes(name)).every(name => draftText.includes(name));
  const busy = !!main.querySelector('[role="progressbar"]');
  const send = [...main.querySelectorAll<HTMLElement>('button[aria-label],[role="button"][aria-label]')]
    .find(e => e.getClientRects().length > 0 && !e.closest('[role="log"],[role="article"]') && /^(?:Nhấn Enter để gửi|Press Enter to send|Send|Gửi)$/i.test(e.getAttribute("aria-label") ?? ""));
  return { ready: (filesPresent || namesPresent || previewsPresent) && !busy && !!send && !send.hasAttribute("disabled") && send.getAttribute("aria-disabled") !== "true" };
}

export async function uploadState(wc: WebContents, action: "input" | "ready", tag: string, names: string[]) {
  return wc.executeJavaScript(`(()=>{const __name=x=>x;return (${uploadDOM.toString()})(${JSON.stringify(action)},${JSON.stringify(tag)},${JSON.stringify(names)})})()`);
}
