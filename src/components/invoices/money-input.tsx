'use client';

import React, { useState } from 'react';
import { fmtNumber, parseMoneyInput } from '@/lib/invoices';

/** Keeps digits and a single decimal point, so typing never fights the formatter. */
function sanitize(text: string, maxDecimals: number): string {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  const whole = cleaned.slice(0, dot);
  const fraction = cleaned.slice(dot + 1).replace(/\./g, '').slice(0, maxDecimals);
  return `${whole}.${fraction}`;
}

/**
 * Number field for money, quantities and rates. While focused it shows exactly
 * what was typed (no reformatting, so the caret never jumps and the field can
 * be cleared); on blur it shows the formatted value.
 */
export function MoneyInput({
  value,
  onChange,
  decimals = 2,
  maxDecimals = 4,
  blankZero = false,
  format,
  ...rest
}: {
  value: number;
  onChange: (value: number) => void;
  /** Decimals shown when not editing. */
  decimals?: number;
  /** Decimals accepted while typing. */
  maxDecimals?: number;
  /** Show an empty field (and the placeholder) instead of 0.00. */
  blankZero?: boolean;
  format?: (value: number) => string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const [text, setText] = useState<string | null>(null);
  const number = Number(value) || 0;
  const shown = text ?? (blankZero && number === 0 ? '' : format ? format(number) : fmtNumber(number, decimals));

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={shown}
      onFocus={(e) => {
        setText(number === 0 ? '' : String(number));
        const input = e.currentTarget;
        requestAnimationFrame(() => input.select());
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        setText(null);
        rest.onBlur?.(e);
      }}
      onChange={(e) => {
        const next = sanitize(e.target.value, maxDecimals);
        setText(next);
        onChange(parseMoneyInput(next));
      }}
    />
  );
}
