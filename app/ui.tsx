import type { CSSProperties } from "react";
const paths = {
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  chat: "M21 11.5a8.4 8.4 0 0 1-9 8.5 10 10 0 0 1-4-.8L3 21l1.8-5A8.7 8.7 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5Z M8 11h.01 M12 11h.01 M16 11h.01",
  mail: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z M3 6l9 7 9-7",
  arrow: "M5 12h14 M13 6l6 6-6 6", upload: "M12 16V3 M7 8l5-5 5 5 M4 15v5h16v-5",
  download: "M12 3v13 M7 11l5 5 5-5 M4 16v5h16v-5", search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  chevron: "M9 5l7 7-7 7", shield: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z M8 12l3 3 5-6",
  wallet: "M20 7H5a2 2 0 0 1 0-4h13v4 M4 7v13h17V7 M21 11h-6v5h6 M18 13.5h.01",
  file: "M14 2H5v20h14V7l-5-5Z M14 2v6h5 M8 13h8 M8 17h6", send: "m3 3 19 9-19 9 4-9-4-9Z M7 12h15",
  plus: "M12 4v16 M4 12h16", refresh: "M20 7v5h-5 M20 12a8 8 0 1 0-2 5 M20 7a9 9 0 0 0-4-3", close: "M6 6l12 12 M18 6 6 18", copy: "M9 9h11v11H9z M15 9V3H3v12h6",
} as const;
export function Icon({ name, size = 20, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}
export function Brand() { return <span className="brand"><span className="brand-mark" aria-hidden="true">p<span /></span><span>Payme<span className="brand-dot">.</span></span></span>; }
