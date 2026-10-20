// Tên + avatar của chính mình — chỉ đọc DOM công khai.
// Trang cá nhân (/me) không vẽ nội dung khi chạy ẩn, nhưng trang chủ (/home.php) vẫn vẽ cột trái có liên kết
// tới trang cá nhân kèm họ tên + avatar. Liên kết được nhận theo đường dẫn mà /me chuyển tới, hoặc ?id=<c_user>.
function readOwnLink(profilePath: string, userId: string) {
  const plain = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().trim();
  const ui = /^(facebook|messenger|thong bao|notifications|doan chat|chats|trang chu|home|ban be|friends|watch|marketplace|nhom|groups)$/;
  const own = (href: string) => {
    try {
      const u = new URL(href);
      if (!/^(www\.)?facebook\.com$/.test(u.hostname)) return false;
      if (userId && u.pathname === "/profile.php" && u.searchParams.get("id") === userId) return true;
      return Boolean(profilePath) && profilePath !== "/" && u.pathname.replace(/\/$/, "") === profilePath.replace(/\/$/, "");
    } catch {
      return false;
    }
  };
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('[role="navigation"] a[href]')).filter((a) => own(a.href));
  const named = links.map((a) => (a.textContent ?? "").trim()).find((t) => t && t.length < 100 && !ui.test(plain(t)));
  const pic = links.map((a) => a.querySelector("image, img")).find(Boolean);
  const avatar = pic ? pic.getAttribute("xlink:href") || pic.getAttribute("href") || pic.getAttribute("src") : null;
  return {
    name: named?.normalize("NFC"),
    avatar: avatar && /^https:\/\/[^/]*(fbcdn\.net|facebook\.com)\//.test(avatar) ? avatar : undefined,
  };
}
// esbuild (tsx/vite) chèn __name(...) vào hàm khi build; trang Facebook không có hàm này → khai báo rỗng (như master-chat).
export const ownLinkScript = (profilePath: string, userId: string) =>
  `(() => {const __name = (v) => v; return (${readOwnLink.toString()})(${JSON.stringify(profilePath)}, ${JSON.stringify(userId)});})()`;
