import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { TEXT_SIZES, ZOOMS } from "../core/types.ts";
import { useT } from "./i18n.ts";
import { Icon, Slice, ViewContext } from "./skin.tsx";

export type MenuItem = { label: string; onClick?: () => void; checked?: boolean; disabled?: boolean } | "-";
export type Menu = { label: string; items: MenuItem[] };

// Các mục "Gom tab", "Cỡ chữ" và "Cỡ hiển thị" dùng chung cho menu Xem của mọi cửa sổ.
const TEXT_KEYS = ["text.small", "text.medium", "text.large", "text.xlarge"] as const;
export function useZoomItems(): MenuItem[] {
  const t = useT();
  const { zoom, textSize, tabbed } = useContext(ViewContext);
  return [
    { label: t("menu.tabbed"), checked: tabbed, onClick: () => window.ym.setSettings({ tabbed: !tabbed }) },
    "-" as const,
    ...TEXT_SIZES.map((s, i) => ({ label: t(TEXT_KEYS[i]), checked: s === textSize, onClick: () => window.ym.setSettings({ textSize: s }) })),
    "-" as const,
    ...ZOOMS.map((z) => ({ label: t("menu.zoom", { n: Math.round(z * 100) }), checked: z === zoom, onClick: () => window.ym.setSettings({ zoom: z }) })),
  ];
}

function useActive() {
  const [active, setActive] = useState(document.hasFocus());
  useEffect(() => {
    const on = () => setActive(true);
    const off = () => setActive(false);
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("focus", on);
      window.removeEventListener("blur", off);
    };
  }, []);
  return active;
}

function WindowButtons({ onSkinButton }: { onSkinButton?: () => void }) {
  const t = useT();
  // min/max/close.png: 5 trạng thái 21×21 (thường/hover/nhấn/tắt/không active)
  return (
    <div className="winbtns">
      {onSkinButton && (
        // Nút đổi skin của Y!M 10: không có ảnh trong bộ cài, vẽ lại bằng CSS theo màu đo từ ảnh chụp gốc.
        <button className="skin-btn" onClick={onSkinButton} title={t("menu.skin")}>
          <span />
        </button>
      )}
      <button className="hot" onClick={() => window.ym.minimize()} title={t("win.minimize")}>
        <Icon src="theme/min.png" n={5} states={[0, 1, 2]} w={21} h={21} />
      </button>
      <button className="hot" onClick={() => window.ym.maximize()} title={t("win.maximize")}>
        <Icon src="theme/max.png" n={5} states={[0, 1, 2]} w={21} h={21} />
      </button>
      <button className="hot" onClick={() => window.ym.close()} title={t("win.close")}>
        <Icon src="theme/close.png" n={5} states={[0, 1, 2]} w={21} h={21} />
      </button>
    </div>
  );
}

export function MenuBar({ menus, main }: { menus: Menu[]; main?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className={`menubar ${main ? "main" : ""}`} ref={ref}>
      {menus.map((menu, i) => (
        <div key={menu.label} className="menubar-item">
          <Slice
            src={main ? "theme/mainmenubar.png" : "theme/menubar.png"}
            n={4}
            states={open === i ? [2] : [-1, 1, 2]}
            m={[3, 3, 3, 3]}
            className="btn menubar-btn"
            onMouseDown={() => setOpen(open === i ? null : i)}
            onMouseEnter={() => open !== null && setOpen(i)}
          >
            {menu.label}
          </Slice>
          {open === i && (
            <div className="menu-popup">
              {menu.items.map((item, j) =>
                item === "-" ? (
                  <div key={j} className="menu-sep" />
                ) : (
                  <div
                    key={j}
                    className={`menu-row ${item.disabled ? "disabled" : ""}`}
                    onClick={() => {
                      if (item.disabled) return;
                      setOpen(null);
                      item.onClick?.();
                    }}
                  >
                    <span className="menu-check">{item.checked ? "✓" : ""}</span>
                    {item.label}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Khung cửa sổ tự vẽ từ skin. Ảnh gồm 2 trạng thái xếp dọc (active/inactive); vùng tiêu đề co giãn
// theo resizemargin_top (trái 120 cố định, phải 60 cố định), thân cửa sổ theo resizemargin trái/phải/dưới.
export function Frame({
  main,
  title,
  icon,
  menus,
  onSkinButton,
  children,
}: {
  onSkinButton?: () => void;
  main?: boolean;
  title?: string;
  icon?: ReactNode;
  menus: Menu[];
  children: ReactNode;
}) {
  const active = useActive();
  const src = main ? "theme/mainframewindow.png" : "theme/framewindow.png";
  const [stateH, top, bottom] = main ? [64, 44, 5] : [48, 28, 4];
  const state = active ? 0 : 1;
  return (
    <div className={`frame ${main ? "main-frame" : ""} ${active ? "active" : "inactive"} ${window.ym.platform}`}>
      <Slice src={src} n={2} states={[state]} crop={{ y: 0, h: top }} m={[120, 0, 60, 0]} className="frame-top" style={{ height: top }}>
        <div className="titlebar">
          {main ? (
            <Icon src="theme/Yahoo!_Messenger.png" n={2} states={[state]} w={161} h={17} className="title-logo" />
          ) : (
            <>
              <span className="title-icon">{icon}</span>
              <span className="title-text">{title}</span>
            </>
          )}
          <WindowButtons onSkinButton={onSkinButton} />
        </div>
        {main && <MenuBar menus={menus} main />}
      </Slice>
      <Slice src={src} n={2} states={[state]} crop={{ y: top, h: stateH - top }} m={[4, 0, 4, bottom]} className="frame-body">
        {!main && <MenuBar menus={menus} />}
        <div className="frame-content">{children}</div>
      </Slice>
    </div>
  );
}
