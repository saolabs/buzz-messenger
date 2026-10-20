export type Emoticon = { id: string; title: string; file: string; codes: string[] };
export type Token = { text: string } | { emoticon: Emoticon; code: string };

const URL_RE = /(?:https?:\/\/|www\.)\S+/g;

// Tách văn bản thành chữ + emoticon. Khớp mã dài nhất trước (":))" thắng ":)", ">:D<" thắng ":D"),
// không đụng vào URL.
export function tokenize(text: string, emoticons: Emoticon[]): Token[] {
  const codes = emoticons
    .flatMap((emoticon) => emoticon.codes.map((code) => ({ code, emoticon })))
    .sort((a, b) => b.code.length - a.code.length);
  const out: Token[] = [];
  const pushText = (s: string) => {
    if (!s) return;
    const last = out.at(-1);
    if (last && "text" in last) last.text += s;
    else out.push({ text: s });
  };
  let cursor = 0;
  const scan = (end: number) => {
    let plain = "";
    while (cursor < end) {
      const hit = codes.find(({ code }) => text.startsWith(code, cursor) && cursor + code.length <= end);
      if (hit) {
        pushText(plain);
        plain = "";
        out.push({ emoticon: hit.emoticon, code: hit.code });
        cursor += hit.code.length;
      } else plain += text[cursor++];
    }
    pushText(plain);
  };
  for (const m of text.matchAll(URL_RE)) {
    scan(m.index);
    pushText(m[0]);
    cursor = m.index + m[0].length;
  }
  scan(text.length);
  return out;
}
