'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { Portal } from '@/components/portal';
import { fromDateInput, toDateInput } from '@/lib/dates';
import { MoneyInput } from '@/components/invoices/money-input';

/**
 * The little "i" next to a label. Its words show on hover, on keyboard focus and on a tap (phones have no hover),
 * in a bubble drawn above everything else, so a card that clips its contents cannot cut it off.
 */
export function Tip({ text }: { text: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const id = useId();
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(280, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8));
    const below = r.top < 90;
    setPos({ left, top: below ? r.bottom + 6 : r.top - 6, below });
  };
  const hide = () => setPos(null);
  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'pointerdown' && ref.current?.contains(e.target as Node)) return;
      setPos(null);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', close);
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', close);
      window.removeEventListener('pointerdown', close);
    };
  }, [pos]);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="ct-tip"
        aria-label={text}
        aria-describedby={pos ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={show}
      >
        i
      </button>
      {pos && (
        <Portal>
          <div
            id={id}
            role="tooltip"
            className={`ct-tip-pop${pos.below ? ' below' : ''}`}
            style={{ left: pos.left, top: pos.top, width: Math.min(280, window.innerWidth - 16) }}
          >
            {text}
          </div>
        </Portal>
      )}
    </>
  );
}

export function Label({ htmlFor, children, required, tip }: { htmlFor?: string; children: React.ReactNode; required?: boolean; tip?: string }) {
  return (
    <div className="ct-label">
      <label htmlFor={htmlFor}>
        {children}
        {required && <span className="req"> *</span>}
      </label>
      {tip && <Tip text={tip} />}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="ct-switch" onClick={() => onChange(!on)} />;
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="ct-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" className={value === o.id ? 'on' : ''} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  required,
  tip,
  placeholder,
  full,
  type = 'text',
  maxLength = 200,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  tip?: string;
  placeholder?: string;
  full?: boolean;
  type?: 'text' | 'email' | 'tel';
  maxLength?: number;
}) {
  return (
    <div className={`ct-field${full ? ' full' : ''}`}>
      <Label htmlFor={id} required={required} tip={tip}>
        {label}
      </Label>
      <input id={id} type={type} value={value} placeholder={placeholder} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function AreaField({
  id,
  label,
  value,
  onChange,
  tip,
  placeholder,
  rows = 2,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  tip?: string;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div className="ct-field full">
      <Label htmlFor={id} tip={tip}>
        {label}
      </Label>
      <textarea id={id} rows={rows} value={value} placeholder={placeholder} maxLength={2000} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function DateField({
  id,
  label,
  value,
  onChange,
  required,
  tip,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  required?: boolean;
  tip?: string;
}) {
  return (
    <div className="ct-field">
      <Label htmlFor={id} required={required} tip={tip}>
        {label}
      </Label>
      <input id={id} type="date" value={value === null ? '' : toDateInput(value)} onChange={(e) => onChange(fromDateInput(e.target.value))} />
    </div>
  );
}

export function MoneyField({
  id,
  label,
  value,
  onChange,
  symbol,
  suffix,
  tip,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  onChange?: (value: number) => void;
  symbol: string;
  suffix?: string;
  tip?: string;
  disabled?: boolean;
}) {
  return (
    <div className="ct-field">
      <Label htmlFor={id} tip={tip}>
        {label}
      </Label>
      <div className="ct-money">
        <span>{symbol}</span>
        <MoneyInput id={id} value={value} onChange={(v) => onChange?.(v)} disabled={disabled} readOnly={!onChange} blankZero={!!onChange} placeholder="0.00" />
        {suffix && <span>{suffix}</span>}
      </div>
    </div>
  );
}

export function NumberField({ id, label, value, onChange, tip }: { id: string; label: string; value: number; onChange: (v: number) => void; tip?: string }) {
  return (
    <div className="ct-field">
      <Label htmlFor={id} tip={tip}>
        {label}
      </Label>
      <MoneyInput id={id} value={value} onChange={onChange} decimals={0} maxDecimals={2} className="ct-input" />
    </div>
  );
}

export function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  tip,
}: {
  id: string;
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
  tip?: string;
}) {
  return (
    <div className="ct-field">
      <Label htmlFor={id} tip={tip}>
        {label}
      </Label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const svg = (children: React.ReactNode, size = 15) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

/** Icons for the built-in parts and the three ways a service works. */
export function PartIcon({ part, kind, size = 15 }: { part?: string | null; kind?: string; size?: number }) {
  switch (part) {
    case 'website':
      return svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></>, size);
    case 'domain':
      return svg(<><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>, size);
    case 'hosting':
      return svg(<><rect x="2" y="3" width="20" height="8" rx="2" /><rect x="2" y="13" width="20" height="8" rx="2" /><path d="M6 7h.01M6 17h.01" /></>, size);
    case 'email':
      return svg(<><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></>, size);
    case 'maintenance':
      return svg(<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />, size);
    case 'ssl':
      return svg(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></>, size);
    default:
      if (kind === 'visits') return <PartIcon part="maintenance" size={size} />;
      if (kind === 'renews') return svg(<><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></>, size);
      return svg(<><path d="M21 8l-9-5-9 5v8l9 5 9-5z" /><path d="M3.3 7.5 12 12l8.7-4.5" /><path d="M12 22V12" /></>, size);
  }
}

export function IconBox({ part, kind, muted }: { part?: string | null; kind?: string; muted?: boolean }) {
  return (
    <span className={`ct-icon${muted ? ' muted' : ''}`}>
      <PartIcon part={part} kind={kind} />
    </span>
  );
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '').slice(0, 2)) || '?').toUpperCase();
}
