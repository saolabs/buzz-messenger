import { createRoot } from "react-dom/client";
import { BuddyWindow } from "./buddy.tsx";
import { ImWindow } from "./im.tsx";
import { LangContext } from "./i18n.ts";
import { useEffect } from "react";
import { ZOOMS } from "../core/types.ts";
import { SkinContext, useSettings, useSkinColors, ViewContext } from "./skin.tsx";
import "./styles.css";

function App() {
  const { settings, skins } = useSettings();
  useSkinColors(settings?.skin ?? null);
  const zoom = settings?.zoom ?? 1.25;
  // Ctrl/⌘ + / - / 0: phóng to, thu nhỏ, về 125% (giống trình duyệt).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const i = ZOOMS.indexOf(zoom);
      const next = e.key === "=" || e.key === "+" ? ZOOMS[i + 1] : e.key === "-" ? ZOOMS[i - 1] : e.key === "0" ? 1.25 : undefined;
      if (next === undefined && !["=", "+", "-", "0"].includes(e.key)) return;
      e.preventDefault();
      if (next !== undefined) window.ym.setSettings({ zoom: next });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);
  if (!settings) return null;
  document.documentElement.lang = settings.lang;
  document.documentElement.style.setProperty("--ts", String(settings.textSize));
  return (
    <SkinContext value={settings.skin}>
      <ViewContext value={{ zoom, textSize: settings.textSize, tabbed: settings.tabbed }}>
        <LangContext value={settings.lang}>{location.hash === "#im" ? <ImWindow /> : <BuddyWindow skins={skins} />}</LangContext>
      </ViewContext>
    </SkinContext>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
