import React from 'react';

/* Inline icon set mirrored from the design prototype's ICONS object
   (design/prototype/shell.js). */

type IconProps = React.SVGProps<SVGSVGElement>;

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function Plus(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} strokeWidth={2.5} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function Filter(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

export function Display(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

export function Sort(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <path d="M3 6h13" />
      <path d="M3 12h9" />
      <path d="M3 18h5" />
      <path d="m18 9 3-3-3-3" />
      <path d="M21 6h-9" />
      <path d="m18 15 3 3-3 3" />
      <path d="M12 18h9" />
    </svg>
  );
}

export function Search(props: IconProps) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" {...stroke} {...props}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function ChevronDown(props: IconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" {...stroke} {...props}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function ChevronRight(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function ChevronLeft(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export function Copy(props: IconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" {...stroke} {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function Check(props: IconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function More(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}

export function Cursor(props: IconProps) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" {...stroke} {...props}>
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

export function ExternalLink(props: IconProps) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" {...stroke} {...props}>
      <path d="m3 21 8-8" />
      <path d="M15 3h6v6" />
      <path d="M21 3l-8 8" />
    </svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function Shuffle(props: IconProps) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" {...stroke} {...props}>
      <polyline points="16 3 21 3 21 8" />
      <line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" />
      <line x1="15" y1="15" x2="21" y2="21" />
      <line x1="4" y1="4" x2="9" y2="9" />
    </svg>
  );
}

export function Wand(props: IconProps) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" {...stroke} {...props}>
      <path d="M15 4V2m0 14v-2M8 9h2M20 9h2M17.8 11.8 19 13m-1.2-8.2L19 4M2 22l14-14m-3.6-2.4L11 4" />
    </svg>
  );
}

export function Info(props: IconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" {...stroke} {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

export function Edit(props: IconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" {...stroke} {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

export function Globe(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export function XLogo(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function LinkedIn(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

export function Facebook(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

export function Lock(props: IconProps) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" {...stroke} {...props}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function Clock(props: IconProps) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" {...stroke} {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function Eye(props: IconProps) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" {...stroke} {...props}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function Archive(props: IconProps) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" {...stroke} {...props}>
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

export function Duplicate(props: IconProps) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" {...stroke} {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function Trash(props: IconProps) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" {...stroke} {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} {...props}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={2.5} {...props}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" {...stroke} {...props}>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

/* Simplified decorative QR mark — replaced at runtime by a real encoder. */
export function QrMark(props: IconProps) {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }} {...props}>
      <rect width="100" height="100" fill="white" />
      <rect x="4" y="4" width="24" height="24" fill="black" />
      <rect x="8" y="8" width="16" height="16" fill="white" />
      <rect x="12" y="12" width="8" height="8" fill="black" />
      <rect x="72" y="4" width="24" height="24" fill="black" />
      <rect x="76" y="8" width="16" height="16" fill="white" />
      <rect x="80" y="12" width="8" height="8" fill="black" />
      <rect x="4" y="72" width="24" height="24" fill="black" />
      <rect x="8" y="76" width="16" height="16" fill="white" />
      <rect x="12" y="80" width="8" height="8" fill="black" />
      <g fill="black">
        <rect x="32" y="4" width="4" height="4" /><rect x="40" y="4" width="4" height="4" /><rect x="52" y="4" width="4" height="4" /><rect x="60" y="4" width="4" height="4" />
        <rect x="32" y="12" width="4" height="4" /><rect x="44" y="12" width="4" height="4" /><rect x="56" y="12" width="4" height="4" /><rect x="64" y="12" width="4" height="4" />
        <rect x="36" y="16" width="4" height="4" /><rect x="48" y="16" width="4" height="4" /><rect x="60" y="16" width="4" height="4" />
        <rect x="32" y="20" width="4" height="4" /><rect x="40" y="20" width="4" height="4" /><rect x="52" y="20" width="4" height="4" />
        <rect x="36" y="24" width="4" height="4" /><rect x="44" y="24" width="4" height="4" /><rect x="56" y="24" width="4" height="4" /><rect x="64" y="24" width="4" height="4" />
        <rect x="4" y="32" width="4" height="4" /><rect x="12" y="32" width="4" height="4" /><rect x="20" y="32" width="4" height="4" /><rect x="28" y="32" width="4" height="4" /><rect x="36" y="32" width="4" height="4" /><rect x="48" y="32" width="4" height="4" /><rect x="60" y="32" width="4" height="4" /><rect x="72" y="32" width="4" height="4" /><rect x="80" y="32" width="4" height="4" /><rect x="88" y="32" width="4" height="4" /><rect x="92" y="32" width="4" height="4" />
        <rect x="8" y="36" width="4" height="4" /><rect x="16" y="36" width="4" height="4" /><rect x="32" y="36" width="4" height="4" /><rect x="44" y="36" width="4" height="4" /><rect x="52" y="36" width="4" height="4" /><rect x="64" y="36" width="4" height="4" /><rect x="76" y="36" width="4" height="4" /><rect x="84" y="36" width="4" height="4" />
        <rect x="4" y="40" width="4" height="4" /><rect x="20" y="40" width="4" height="4" /><rect x="28" y="40" width="4" height="4" /><rect x="40" y="40" width="4" height="4" /><rect x="56" y="40" width="4" height="4" /><rect x="72" y="40" width="4" height="4" /><rect x="88" y="40" width="4" height="4" />
        <rect x="12" y="44" width="4" height="4" /><rect x="24" y="44" width="4" height="4" /><rect x="36" y="44" width="4" height="4" /><rect x="48" y="44" width="4" height="4" /><rect x="60" y="44" width="4" height="4" /><rect x="68" y="44" width="4" height="4" /><rect x="80" y="44" width="4" height="4" /><rect x="92" y="44" width="4" height="4" />
        <rect x="4" y="48" width="4" height="4" /><rect x="16" y="48" width="4" height="4" /><rect x="32" y="48" width="4" height="4" /><rect x="44" y="48" width="4" height="4" /><rect x="52" y="48" width="4" height="4" /><rect x="64" y="48" width="4" height="4" /><rect x="76" y="48" width="4" height="4" /><rect x="88" y="48" width="4" height="4" />
        <rect x="8" y="52" width="4" height="4" /><rect x="20" y="52" width="4" height="4" /><rect x="28" y="52" width="4" height="4" /><rect x="40" y="52" width="4" height="4" /><rect x="48" y="52" width="4" height="4" /><rect x="60" y="52" width="4" height="4" /><rect x="72" y="52" width="4" height="4" /><rect x="84" y="52" width="4" height="4" /><rect x="92" y="52" width="4" height="4" />
        <rect x="4" y="56" width="4" height="4" /><rect x="16" y="56" width="4" height="4" /><rect x="24" y="56" width="4" height="4" /><rect x="32" y="56" width="4" height="4" /><rect x="44" y="56" width="4" height="4" /><rect x="56" y="56" width="4" height="4" /><rect x="68" y="56" width="4" height="4" /><rect x="80" y="56" width="4" height="4" />
        <rect x="12" y="60" width="4" height="4" /><rect x="20" y="60" width="4" height="4" /><rect x="36" y="60" width="4" height="4" /><rect x="48" y="60" width="4" height="4" /><rect x="60" y="60" width="4" height="4" /><rect x="72" y="60" width="4" height="4" /><rect x="84" y="60" width="4" height="4" /><rect x="92" y="60" width="4" height="4" />
        <rect x="4" y="64" width="4" height="4" /><rect x="24" y="64" width="4" height="4" /><rect x="40" y="64" width="4" height="4" /><rect x="52" y="64" width="4" height="4" /><rect x="64" y="64" width="4" height="4" /><rect x="76" y="64" width="4" height="4" /><rect x="88" y="64" width="4" height="4" />
        <rect x="32" y="68" width="4" height="4" /><rect x="40" y="68" width="4" height="4" /><rect x="52" y="68" width="4" height="4" /><rect x="60" y="68" width="4" height="4" /><rect x="68" y="68" width="4" height="4" /><rect x="80" y="68" width="4" height="4" />
        <rect x="32" y="72" width="4" height="4" /><rect x="44" y="72" width="4" height="4" /><rect x="56" y="72" width="4" height="4" /><rect x="60" y="72" width="4" height="4" />
        <rect x="36" y="76" width="4" height="4" /><rect x="48" y="76" width="4" height="4" /><rect x="52" y="76" width="4" height="4" /><rect x="64" y="76" width="4" height="4" />
        <rect x="32" y="80" width="4" height="4" /><rect x="40" y="80" width="4" height="4" /><rect x="56" y="80" width="4" height="4" /><rect x="60" y="80" width="4" height="4" /><rect x="72" y="80" width="4" height="4" /><rect x="80" y="80" width="4" height="4" /><rect x="88" y="80" width="4" height="4" />
        <rect x="36" y="84" width="4" height="4" /><rect x="44" y="84" width="4" height="4" /><rect x="52" y="84" width="4" height="4" /><rect x="64" y="84" width="4" height="4" /><rect x="76" y="84" width="4" height="4" /><rect x="84" y="84" width="4" height="4" /><rect x="92" y="84" width="4" height="4" />
        <rect x="32" y="88" width="4" height="4" /><rect x="40" y="88" width="4" height="4" /><rect x="48" y="88" width="4" height="4" /><rect x="56" y="88" width="4" height="4" /><rect x="72" y="88" width="4" height="4" /><rect x="80" y="88" width="4" height="4" /><rect x="88" y="88" width="4" height="4" />
        <rect x="36" y="92" width="4" height="4" /><rect x="44" y="92" width="4" height="4" /><rect x="52" y="92" width="4" height="4" /><rect x="60" y="92" width="4" height="4" /><rect x="68" y="92" width="4" height="4" /><rect x="80" y="92" width="4" height="4" /><rect x="92" y="92" width="4" height="4" />
      </g>
    </svg>
  );
}

export function Refresh(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

/* --- Icons for the advanced-option popups --------------------------------- */

export function Activity(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

export function Flag(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

export function Gift(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <polyline points="20 12 20 22 4 22 4 12" />
      <rect x="2" y="7" width="20" height="5" />
      <line x1="12" y1="22" x2="12" y2="7" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
    </svg>
  );
}

export function FileText(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}

export function TermIcon(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="11" cy="11" r="3.5" />
      <line x1="13.6" y1="13.6" x2="17" y2="17" />
    </svg>
  );
}

export function Calendar(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export function Upload(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

export function Sparkle(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2l1.9 5.6L19.5 9.5 13.9 11.4 12 17l-1.9-5.6L4.5 9.5l5.6-1.9z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </svg>
  );
}

export function EyeOff(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export function DiamondOutline(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <path d="M12 3.5 20.5 12 12 20.5 3.5 12z" />
    </svg>
  );
}

export function Drag(props: IconProps) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

export function Send(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

export function Receipt(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M9 15h6M9 11h6" />
    </svg>
  );
}

export function Download(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
