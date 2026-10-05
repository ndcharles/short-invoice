'use client';

import React from 'react';
import { ChevronDown } from '@/components/icons';

/**
 * The domain half of the "domain / alias" field. A plain label when there is
 * only one domain, otherwise a native select styled like the label.
 */
export function DomainPicker({
  value,
  domains,
  onChange,
  disabled,
}: {
  value: string;
  domains: string[];
  onChange: (domain: string) => void;
  disabled?: boolean;
}) {
  const options = domains.includes(value) ? domains : [value, ...domains];
  if (options.length <= 1) {
    return (
      <div className="alias-domain" style={{ cursor: 'default' }}>
        <span>{value}</span>
      </div>
    );
  }
  return (
    <label className="alias-domain" style={{ position: 'relative' }} title="Short-link domain">
      <span>{value}</span>
      <ChevronDown />
      <select
        aria-label="Short-link domain"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
      >
        {options.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </label>
  );
}
