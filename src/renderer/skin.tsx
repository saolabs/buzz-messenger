import { createContext, useContext, useEffect, useState, type CSSProperties, type HTMLAttributes } from "react";
import type { Settings } from "../core/types.ts";

// Ảnh skin Y!M là sprite xếp dọc: n trạng thái (thường/hover/nhấn/tắt, toggle thì thêm 4 trạng thái "đã chọn").
// Main process cắt sẵn từng trạng thái: ymres://skin/<Skin>/<file>?n=&i=&y=&h=
export const SkinContext = createContext("Purple");
export const ViewContext = createContext({ zoom: 1.25, textSize: 0.92, tabbed: false });

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [skins, setSkins] = useState<string[]>([]);
  useEffect(() => {
    window.ym.getSettings().then(({ skins, ...s }) => {
      setSettings(s);
      setSkins(skins);
    });
    return window.ym.onSettings(setSettings);
  }, []);
  return { settings, skins };
}

// colors.xml của skin → biến CSS. Giá trị gốc dạng "249,249,242", "3399cc" hoặc "0".
const COLOR_VARS: Record<string, string> = {
  "--back": "mainwndbackcolor",
  "--text": "defaulttextcolor",
  "--tb-text": "button",
  "--status-text": "statusbar",
  "--menubar-text": "menubartext",
  "--menubar-text-h": "menubartext_h",
  "--mainmenubar-text": "mainmenubartext",
  "--mainmenubar-text-h": "mainmenubartext_h",
  "--tab-on": "text_tab_checked",
  "--tab-off": "text_tab_unchecked",
  "--selection": "selection",
  "--menu": "menu",
  "--menu-text": "menuitem",
  "--menu-text-h": "menuitem_h",
  "--name-text": "displaynametextcolor",
  "--list-bg": "lvrow_n",
  "--list-hover": "list_view_selection_bkgnd",
};
const toCss = (v: string) =>
  v.includes(",") ? `rgb(${v.split(",").slice(0, 3).join(",")})` : `#${v.padStart(6, "0").slice(-6)}`;

export function useSkinColors(skin: string | null) {
  useEffect(() => {
    if (!skin) return;
    fetch(skinUrl(skin, "colors.xml"))
      .then((r) => r.text())
      .then((xml) => {
        const colors = new Map(
          [...new DOMParser().parseFromString(xml, "text/xml").querySelectorAll("color")].map((c) => [c.id, c.getAttribute("value")?.trim() ?? ""]),
        );
        const root = document.documentElement.style;
        for (const [cssVar, id] of Object.entries(COLOR_VARS)) {
          const v = colors.get(id);
          if (v) root.setProperty(cssVar, toCss(v));
          else root.removeProperty(cssVar);
        }
      })
      .catch(() => {});
  }, [skin]);
}

type Crop = { y: number; h: number };
export function skinUrl(skin: string, file: string, n = 1, i = 0, crop?: Crop) {
  const q = new URLSearchParams();
  if (n > 1 || crop) q.set("n", String(n)), q.set("i", String(i));
  if (crop) q.set("y", String(crop.y)), q.set("h", String(crop.h));
  const qs = q.toString();
  return `ymres://skin/${encodeURIComponent(skin)}/${file}${qs ? `?${qs}` : ""}`;
}
export const mediaUrl = (file: string) => `ymres://media/${file}`;

function useUrls(file: string, n: number, states: readonly number[], crop?: Crop) {
  const skin = useContext(SkinContext);
  const [normal, hover = normal, down = hover] = states;
  return [normal, hover, down].map((i) => (i < 0 ? "none" : `url("${skinUrl(skin, file, n, i, crop)}")`));
}

type SliceProps = HTMLAttributes<HTMLDivElement> & {
  src: string;
  n?: number;
  // trạng thái [thường, hover, nhấn]; -1 = không vẽ nền (BkgndInvisibleOnNormal)
  states?: readonly number[];
  // resizemargin của skin: trái, trên, phải, dưới
  m: readonly [number, number, number, number];
  crop?: Crop;
};

// Một ô co giãn 9-slice (CSS border-image) theo đúng resizemargin của skin gốc.
export function Slice({ src, n = 1, states = [0], m, crop, className = "", style, ...rest }: SliceProps) {
  const [vn, vh, vd] = useUrls(src, n, states, crop);
  const [l, t, r, b] = m;
  const css = {
    "--bi-n": vn,
    "--bi-h": vh,
    "--bi-d": vd,
    borderImageSlice: `${t} ${r} ${b} ${l} fill`,
    borderImageWidth: `${t}px ${r}px ${b}px ${l}px`,
    ...style,
  } as CSSProperties;
  return <div className={`slice ${className}`} style={css} {...rest} />;
}

type IconProps = HTMLAttributes<HTMLSpanElement> & {
  src: string;
  n?: number;
  states?: readonly number[];
  w: number;
  h: number;
};

// Icon cố định kích thước, đổi trạng thái theo hover/nhấn của phần tử cha có class "hot".
export function Icon({ src, n = 1, states = [0], w, h, className = "", style, ...rest }: IconProps) {
  const [vn, vh, vd] = useUrls(src, n, states);
  const css = { "--bg-n": vn, "--bg-h": vh, "--bg-d": vd, width: w, height: h, ...style } as CSSProperties;
  return <span className={`icon ${className}`} style={css} {...rest} />;
}

// pushbuttons.png có 6 trạng thái: 0 thường, 1 hover, 2-3 nhấn, 4 tắt, 5 nút mặc định (Enter) — tím nhạt.
// Nút mặc định của form (Sign In, Send) dùng 5 khi đứng yên, giống ảnh chụp Y!M 10.
export const PUSH_DEFAULT = [5, 1, 2] as const;

// Combobox kiểu Y!M (theme.xml style "combobox"): ô trắng viền xám, nút bên phải là combo_back.png
// (4 trạng thái, resizemargin 2) + mũi tên combo_arrow.png. Danh sách thả xuống vẫn là <select> của hệ điều hành.
export function Combo({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="combo hot">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      <Slice src="theme/combo_back.png" n={4} states={[0, 1, 2]} m={[2, 2, 2, 2]} className="combo-btn">
        <Icon src="theme/combo_arrow.png" n={4} states={[0, 1, 2]} w={7} h={7} />
      </Slice>
    </div>
  );
}

export function playSound(file: "buzz.wav" | "message.wav" | "online.wav" | "offline.wav" | "alert.wav") {
  new Audio(mediaUrl(file)).play().catch(() => {});
}
