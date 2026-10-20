import { useEffect, useState } from "react";
import { tokenize, type Emoticon } from "../core/emoticons.ts";
import { mediaUrl } from "./skin.tsx";

// Mã quen tay mà file Y!M 10 không có: big hug ở đó là "<:D>", người dùng thường gõ ">:D<".
const ALIASES: Record<string, string[]> = { "6": [">:D<"] };

// Bảng emoticon chính thức của Y!M 10 (Media/Smileys/emoticons.xml), nạp một lần cho cả cửa sổ.
let loading: Promise<Emoticon[]> | null = null;
function loadEmoticons() {
  loading ??= fetch(mediaUrl("Smileys/emoticons.xml"))
    .then((r) => r.text())
    .then((xml) =>
      [...new DOMParser().parseFromString(xml, "text/xml").querySelectorAll("emoticon")].map((el) => ({
        id: el.getAttribute("id") ?? "",
        title: el.getAttribute("title") ?? "",
        file: `Smileys/${el.getAttribute("fname")}.gif`,
        // shortcut network="2" là mã MSN/Live (vd "(L)") — bỏ để tránh chuyển nhầm chữ thường.
        // ":-" (confused) trong file gốc nuốt mất ký tự "\" → sẽ chuyển nhầm mọi ":-"; bỏ.
        codes: [...el.querySelectorAll("shortcut")]
          .filter((s) => !s.hasAttribute("network"))
          .map((s) => (s.textContent ?? "").trim())
          .filter((c) => c && c !== ":-")
          .concat(ALIASES[el.getAttribute("id") ?? ""] ?? []),
      })),
    );
  return loading;
}

export function useEmoticons() {
  const [list, setList] = useState<Emoticon[]>([]);
  useEffect(() => {
    loadEmoticons().then(setList, () => setList([]));
  }, []);
  return list;
}

export function Rich({ text, emoticons }: { text: string; emoticons: Emoticon[] }) {
  return (
    <>
      {tokenize(text, emoticons).map((t, i) =>
        "text" in t ? (
          <span key={i}>{t.text}</span>
        ) : (
          <img key={i} className="emo" src={mediaUrl(t.emoticon.file)} alt={t.code} title={`${t.emoticon.title}  ${t.code}`} />
        ),
      )}
    </>
  );
}
