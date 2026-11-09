/**
 * Original line icons (16×16 viewBox, stroke = currentColor). Drawn for MachSim; no third-party
 * artwork. Usage: <Icon name="undo" /> — decorative by default (aria-hidden).
 */
import type { ReactNode } from 'react';

const PATHS: Record<string, ReactNode> = {
  new: (
    <>
      <path d="M4 1.5h5.5L12.5 4.5v10h-8.5z" />
      <path d="M9.5 1.5v3h3" />
    </>
  ),
  open: (
    <>
      <path d="M1.5 4V13.5h11l2-6.5H4.5L2.5 13" />
      <path d="M1.5 4h4l1.5 1.5h5v1.5" />
    </>
  ),
  save: (
    <>
      <path d="M2 2h10l2 2v10H2z" />
      <path d="M4.5 2v3.5h6V2M4.5 14v-4.5h7V14" />
    </>
  ),
  undo: (
    <>
      <path d="M5 3.5L2 6.5l3 3" />
      <path d="M2.5 6.5h7a4 4 0 010 8H6" />
    </>
  ),
  redo: (
    <>
      <path d="M11 3.5l3 3-3 3" />
      <path d="M13.5 6.5h-7a4 4 0 000 8H10" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="6.5" cy="6.5" r="4.5" />
      <path d="M10 10l4.5 4.5M4.5 6.5h4M6.5 4.5v4" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="6.5" cy="6.5" r="4.5" />
      <path d="M10 10l4.5 4.5M4.5 6.5h4" />
    </>
  ),
  zoomFit: (
    <>
      <path d="M1.5 5V1.5H5M11 1.5h3.5V5M14.5 11v3.5H11M5 14.5H1.5V11" />
      <rect x="5" y="5" width="6" height="6" />
    </>
  ),
  zoomSel: (
    <>
      <path d="M1.5 5V1.5H5M11 1.5h3.5V5M14.5 11v3.5H11M5 14.5H1.5V11" />
      <path d="M5 8h6M8 5v6" />
    </>
  ),
  select: <path d="M3 1.5l9 6.5-4 .8L10.5 13l-1.8.9L6.3 9.7 3 12.5z" />,
  wire: (
    <>
      <path d="M2 13V6h7V2.5h5" />
      <circle cx="2" cy="13" r="1.3" />
      <circle cx="14" cy="2.5" r="1.3" />
    </>
  ),
  label: (
    <>
      <path d="M1.5 8h3l2-3h8v6h-8l-2-3" />
      <path d="M8.5 7h4M8.5 9h3" />
    </>
  ),
  probe: (
    <>
      <path d="M2 14l4-4" />
      <path d="M5 8l3 3 6-6-3-3z" />
    </>
  ),
  text: (
    <>
      <path d="M3 3.5V2h10v1.5M8 2v12M6 14h4" />
    </>
  ),
  rotateCw: (
    <>
      <path d="M13 3v3.5H9.5" />
      <path d="M13 6.5A5.5 5.5 0 102.5 9" />
    </>
  ),
  rotateCcw: (
    <>
      <path d="M3 3v3.5h3.5" />
      <path d="M3 6.5A5.5 5.5 0 1113.5 9" />
    </>
  ),
  flipH: (
    <>
      <path d="M8 1.5v13" strokeDasharray="1.5 1.5" />
      <path d="M6 4L1.5 12H6zM10 4l4.5 8H10z" />
    </>
  ),
  flipV: (
    <>
      <path d="M1.5 8h13" strokeDasharray="1.5 1.5" />
      <path d="M4 6L12 1.5V6zM4 10l8 4.5V10z" />
    </>
  ),
  run: <path d="M4 2.5l9 5.5-9 5.5z" />,
  pause: <path d="M4.5 2.5v11M11.5 2.5v11" strokeWidth="2.4" />,
  stop: <rect x="3.5" y="3.5" width="9" height="9" />,
  settings: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </>
  ),
  close: <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />,
  plus: <path d="M8 3v10M3 8h10" />,
  search: (
    <>
      <circle cx="6.5" cy="6.5" r="4.5" />
      <path d="M10 10l4.5 4.5" />
    </>
  ),
  chevronRight: <path d="M6 3.5L10.5 8 6 12.5" />,
  chevronDown: <path d="M3.5 6L8 10.5 12.5 6" />,
  cut: (
    <>
      <circle cx="4" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M5.5 10.5L12 2M10.5 10.5L4 2" />
    </>
  ),
  copy: (
    <>
      <rect x="5" y="5" width="9" height="9" />
      <path d="M11 5V2H2v9h3" />
    </>
  ),
  paste: (
    <>
      <path d="M5.5 2.5H3v12h10v-12h-2.5" />
      <rect x="5.5" y="1.5" width="5" height="2.5" />
    </>
  ),
  trash: (
    <>
      <path d="M2.5 4h11M6 4V2h4v2M4 4l.8 10h6.4L12 4" />
    </>
  ),
  grid: (
    <>
      <path d="M1.5 5.5h13M1.5 10.5h13M5.5 1.5v13M10.5 1.5v13" />
    </>
  ),
  erc: (
    <>
      <path d="M8 1.5l6.5 12h-13z" />
      <path d="M8 6v3.5M8 11.2v.6" />
    </>
  ),
  window: (
    <>
      <rect x="1.5" y="2.5" width="13" height="11" />
      <path d="M1.5 5h13" />
    </>
  ),
  part: (
    <>
      <path d="M1 8h3M12 8h3" />
      <rect x="4" y="5.5" width="8" height="5" />
    </>
  ),
  /** open book: lessons */
  book: (
    <>
      <path d="M8 4c-1.6-1.2-3.6-1.5-6.5-1.2v10c2.9-.3 4.9 0 6.5 1.2 1.6-1.2 3.6-1.5 6.5-1.2v-10C11.6 2.5 9.6 2.8 8 4z" />
      <path d="M8 4v10" />
    </>
  ),
  /** page with lines: description box / reports */
  doc: (
    <>
      <path d="M3.5 1.5h6l3 3v10h-9z" />
      <path d="M9.5 1.5v3h3M5.5 8h5M5.5 10.5h5M5.5 5.5h2" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, title }: { name: string; size?: number; title?: string }) {
  return (
    <svg
      className="ms-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name] ?? PATHS.part}
    </svg>
  );
}
