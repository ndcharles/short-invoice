'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  DiamondOutline,
  Eye,
  EyeOff,
  FileText,
  Flag,
  Gift,
  Globe,
  ImageIcon,
  Info,
  LinkIcon,
  Lock,
  Sparkle,
  TermIcon,
  Upload,
  XIcon,
} from '@/components/icons';
import { OG_DESC_MAX, OG_TITLE_MAX, OgContent } from '@/lib/og';

/* -------------------------------------------------------------------------- */
/* Popup shell                                                                */
/* -------------------------------------------------------------------------- */

interface PopupProps {
  title: string;
  kbd: string;
  hint: string;
  wide?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footerLeft?: React.ReactNode;
  footerRight?: React.ReactNode;
}

export function Popup({ title, kbd, hint, wide, onClose, children, footerLeft, footerRight }: PopupProps) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [onClose]);

  return (
    <div
      className="popup-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`popup${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
        <div className="popup-header">
          <div className="popup-title">
            <span>{title}</span>
            <span className="field-hint" title={hint}>
              <Info />
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="popup-kbd">{kbd}</span>
            <button className="popup-icon-btn" style={{ border: 'none' }} onClick={onClose} aria-label="Close">
              <XIcon width="14" height="14" />
            </button>
          </div>
        </div>
        <div className="popup-body">{children}</div>
        <div className="popup-footer">
          {footerLeft}
          <div className="popup-footer-right">{footerRight}</div>
        </div>
      </div>
    </div>
  );
}

function useDirty<T>(current: T, initial: T) {
  return JSON.stringify(current) !== JSON.stringify(initial);
}

/* -------------------------------------------------------------------------- */
/* UTM builder                                                                */
/* -------------------------------------------------------------------------- */

export interface UtmValues {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  utm_referral: string;
}

export const EMPTY_UTM: UtmValues = {
  utm_source: '',
  utm_medium: '',
  utm_campaign: '',
  utm_term: '',
  utm_content: '',
  utm_referral: '',
};

const UTM_FIELDS: { key: keyof UtmValues; label: string; placeholder: string; icon: React.ReactNode }[] = [
  { key: 'utm_source', label: 'Source', placeholder: 'google', icon: <Globe /> },
  { key: 'utm_medium', label: 'Medium', placeholder: 'cpc', icon: <Activity /> },
  { key: 'utm_campaign', label: 'Campaign', placeholder: 'summer sale', icon: <Flag /> },
  { key: 'utm_term', label: 'Term', placeholder: 'running shoes', icon: <TermIcon /> },
  { key: 'utm_content', label: 'Content', placeholder: 'logo link', icon: <FileText /> },
  { key: 'utm_referral', label: 'Referral', placeholder: 'yoursite.com', icon: <Gift /> },
];

const UTM_TEMPLATES: { name: string; values: Partial<UtmValues> }[] = [
  { name: 'Newsletter', values: { utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'weekly_digest' } },
  { name: 'Paid social', values: { utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: 'retargeting', utm_content: 'carousel' } },
  { name: 'Product launch', values: { utm_source: 'product_hunt', utm_medium: 'referral', utm_campaign: 'launch_week' } },
  { name: 'QR code', values: { utm_source: 'qr', utm_medium: 'offline', utm_campaign: 'print_flyer' } },
];

export function UtmPopup({
  initial,
  baseUrl,
  onClose,
  onSave,
}: {
  initial: UtmValues;
  baseUrl: string;
  onClose: () => void;
  onSave: (values: UtmValues) => void;
}) {
  const [values, setValues] = useState<UtmValues>(initial);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const dirty = useDirty(values, initial);
  const templatesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!templatesOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (templatesRef.current && !templatesRef.current.contains(e.target as Node)) setTemplatesOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [templatesOpen]);

  const composed = useMemo(() => {
    const parts = UTM_FIELDS.filter((f) => values[f.key].trim()).map((f) => ({
      key: f.key,
      value: values[f.key].trim(),
    }));
    return { parts };
  }, [values]);

  return (
    <Popup
      title="UTM Builder"
      kbd="U"
      hint="Tag your destination URL with campaign parameters so your analytics can attribute traffic."
      onClose={onClose}
      footerLeft={
        <div ref={templatesRef} style={{ position: 'relative' }}>
          <button className="btn btn-outline" onClick={() => setTemplatesOpen(!templatesOpen)}>
            <DiamondOutline />
            <span>Templates</span>
            <ChevronDown />
          </button>
          {templatesOpen && (
            <div className="dropdown" style={{ bottom: 'calc(100% + 4px)', left: 0, minWidth: '190px' }}>
              {UTM_TEMPLATES.map((t) => (
                <div
                  key={t.name}
                  className="dropdown-item"
                  onClick={() => {
                    setValues({ ...EMPTY_UTM, ...t.values } as UtmValues);
                    setTemplatesOpen(false);
                  }}
                >
                  <span>{t.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      }
      footerRight={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!dirty} onClick={() => onSave(values)}>
            Save
          </button>
        </>
      }
    >
      {UTM_FIELDS.map((field) => (
        <div className="popup-field" key={field.key}>
          <span className="popup-field-label">
            {field.icon}
            <span>{field.label}</span>
          </span>
          <input
            value={values[field.key]}
            placeholder={field.placeholder}
            onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
          />
        </div>
      ))}

      <div className="popup-label">URL Preview</div>
      <div className="popup-url-preview">
        <span>{baseUrl || 'https://example.com'}</span>
        {composed.parts.length > 0 && (
          <>
            <span className="sep">?</span>
            {composed.parts.map((p, i) => (
              <span key={p.key}>
                {i > 0 && <span className="sep">&amp;</span>}
                <span className="param-key">{p.key}</span>
                <span className="sep">=</span>
                <span className="param-val">{encodeURIComponent(p.value)}</span>
              </span>
            ))}
          </>
        )}
      </div>
    </Popup>
  );
}

/* -------------------------------------------------------------------------- */
/* Password                                                                   */
/* -------------------------------------------------------------------------- */

export function PasswordPopup({
  hasPassword,
  onClose,
  onSave,
}: {
  hasPassword: boolean;
  onClose: () => void;
  onSave: (password: string | null) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = password !== '' || confirm !== '';
  const mismatch = confirm !== '' && password !== confirm;

  const submit = () => {
    if (!password) {
      setError('Enter a password, or use Remove password.');
      return;
    }
    if (password !== confirm) {
      setError('Both passwords must match.');
      return;
    }
    onSave(password);
  };

  return (
    <Popup
      title="Link Password"
      kbd="P"
      hint="Visitors must enter this password before they can open the link."
      onClose={onClose}
      footerLeft={
        hasPassword ? (
          <button className="popup-link-btn" onClick={() => onSave(null)}>
            Remove password
          </button>
        ) : null
      }
      footerRight={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!dirty || mismatch} onClick={submit}>
            Save
          </button>
        </>
      }
    >
      <div className="popup-field">
        <span className="popup-field-label">
          <Lock />
          <span>Password</span>
        </span>
        <input
          type={reveal ? 'text' : 'password'}
          value={password}
          placeholder={hasPassword ? 'Enter a new password' : 'Enter a password'}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          autoFocus
        />
        <button className="popup-field-action" onClick={() => setReveal(!reveal)} title={reveal ? 'Hide' : 'Show'}>
          {reveal ? <EyeOff /> : <Eye />}
        </button>
      </div>

      <div className="popup-field">
        <span className="popup-field-label">
          <Check />
          <span>Confirm</span>
        </span>
        <input
          type={reveal ? 'text' : 'password'}
          value={confirm}
          placeholder="Re-enter the password"
          onChange={(e) => {
            setConfirm(e.target.value);
            setError(null);
          }}
        />
      </div>

      {mismatch && <div className="popup-hint" style={{ color: 'var(--destructive)' }}>Both passwords must match.</div>}
      {error && <div className="popup-hint" style={{ color: 'var(--destructive)' }}>{error}</div>}
      {hasPassword && !dirty && (
        <div className="popup-hint">This link is currently password protected. Saving a new password replaces it.</div>
      )}
    </Popup>
  );
}

/* -------------------------------------------------------------------------- */
/* Expiration                                                                 */
/* -------------------------------------------------------------------------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const hours = d.getHours();
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${h12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** Understands "in 2 hours", "tomorrow at 5pm", "friday 9am", ISO and datetime-local. */
export function parseNaturalDate(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const relative = text.match(/^in\s+(\d+)\s*(minute|min|hour|hr|day|week)s?$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const mult =
      unit.startsWith('min') ? 60_000 : unit.startsWith('hour') || unit === 'hr' ? 3_600_000 : unit === 'day' ? 86_400_000 : 604_800_000;
    return Date.now() + amount * mult;
  }

  const base = new Date();
  let dayOffset: number | null = null;
  const now = new Date();

  if (/^tomorrow\b/.test(text)) dayOffset = 1;
  else if (/^today\b/.test(text)) dayOffset = 0;
  else if (/^next week\b/.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return d.getTime();
  }

  if (dayOffset !== null) {
    const timeMatch = text.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    const d = new Date(base);
    d.setDate(d.getDate() + dayOffset);
    if (timeMatch) {
      let hours = Number(timeMatch[1]);
      const minutes = timeMatch[2] ? Number(timeMatch[2]) : 0;
      const meridiem = timeMatch[3];
      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
      d.setHours(hours, minutes, 0, 0);
    } else {
      d.setHours(23, 59, 0, 0);
    }
    return d.getTime();
  }

  const parsed = Date.parse(input);
  return Number.isNaN(parsed) ? null : parsed;
}

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/** Month grid + time picker, positioned under its anchor input. */
function CalendarPopover({
  value,
  anchorRef,
  onApply,
  onClear,
  onClose,
}: {
  value: number | null;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onApply: (ms: number) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const seed = value ? new Date(value) : null;
  const [view, setView] = useState(() => {
    const base = seed ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [selected, setSelected] = useState<Date | null>(seed);
  const [hour12, setHour12] = useState(() => {
    const h = seed ? seed.getHours() : 23;
    return h % 12 === 0 ? 12 : h % 12;
  });
  const [minute, setMinute] = useState(() => (seed ? seed.getMinutes() : 59));
  const [meridiem, setMeridiem] = useState<'AM' | 'PM'>(() => ((seed ? seed.getHours() : 23) < 12 ? 'AM' : 'PM'));

  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Anchor below the input, flipping above when there is no room and
  // clamping to the viewport so it never lands off-screen.
  React.useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const height = ref.current?.offsetHeight ?? 320;
      const width = ref.current?.offsetWidth ?? 288;
      const below = window.innerHeight - anchor.bottom;
      const top = below > height + 12 ? anchor.bottom + 6 : Math.max(12, anchor.top - height - 6);
      const left = Math.min(Math.max(12, anchor.left), window.innerWidth - width - 12);
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onEsc, true);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onEsc, true);
    };
  }, [onClose, anchorRef]);

  const today = new Date();
  const startDow = (view.getDay() + 6) % 7;
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const daysInPrevMonth = new Date(view.getFullYear(), view.getMonth(), 0).getDate();

  const cells = Array.from({ length: 42 }, (_, i) => {
    const index = i - startDow + 1;
    if (index < 1) {
      const day = daysInPrevMonth + index;
      return { date: new Date(view.getFullYear(), view.getMonth() - 1, day), muted: true };
    }
    if (index > daysInMonth) {
      return { date: new Date(view.getFullYear(), view.getMonth() + 1, index - daysInMonth), muted: true };
    }
    return { date: new Date(view.getFullYear(), view.getMonth(), index), muted: false };
  });

  const sameDay = (a: Date, b: Date | null) =>
    !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const buildValue = (): number => {
    const base = selected ?? today;
    let hours = hour12 % 12;
    if (meridiem === 'PM') hours += 12;
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minute, 0, 0).getTime();
  };

  return (
    <div className="popup-calendar" ref={ref} style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}>
      <div className="popup-calendar-head">
        <span className="popup-calendar-title">
          {MONTHS[view.getMonth()]} {view.getFullYear()}
        </span>
        <span className="popup-calendar-nav">
          <button
            className="icon-btn"
            onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
            aria-label="Previous month"
          >
            <ChevronLeft />
          </button>
          <button
            className="icon-btn"
            onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
            aria-label="Next month"
          >
            <ChevronRight />
          </button>
        </span>
      </div>

      <div className="popup-calendar-grid">
        {DOW.map((d, i) => (
          <span className="popup-calendar-dow" key={`${d}-${i}`}>
            {d}
          </span>
        ))}
        {cells.map(({ date, muted }, i) => (
          <button
            key={i}
            className={`popup-calendar-day${muted ? ' is-muted' : ''}${
              sameDay(date, today) ? ' is-today' : ''
            }${sameDay(date, selected) ? ' is-selected' : ''}`}
            onClick={() => {
              setSelected(date);
              if (muted) setView(new Date(date.getFullYear(), date.getMonth(), 1));
            }}
          >
            {date.getDate()}
          </button>
        ))}
      </div>

      <div className="popup-calendar-time">
        <span className="popup-calendar-time-label">Time</span>
        <select className="popup-input" value={hour12} onChange={(e) => setHour12(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <select className="popup-input" value={minute} onChange={(e) => setMinute(Number(e.target.value))}>
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {m.toString().padStart(2, '0')}
            </option>
          ))}
        </select>
        <select
          className="popup-input"
          value={meridiem}
          onChange={(e) => setMeridiem(e.target.value as 'AM' | 'PM')}
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>

      <div className="popup-calendar-foot">
        <button
          className="popup-link-btn"
          onClick={() => {
            onClear();
            onClose();
          }}
        >
          Clear
        </button>
        <span style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            className="popup-link-btn"
            onClick={() => {
              const now = new Date();
              setSelected(now);
              setView(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
          >
            Today
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => onApply(buildValue())}>
            Done
          </button>
        </span>
      </div>
    </div>
  );
}

export function ExpirationPopup({
  initialExpiresAt,
  initialExpiresUrl,
  onClose,
  onSave,
}: {
  initialExpiresAt: number | null;
  initialExpiresUrl: string | null;
  onClose: () => void;
  onSave: (expiresAt: number | null, expiresUrl: string | null) => void;
}) {
  const [dateText, setDateText] = useState(initialExpiresAt ? formatDateTime(initialExpiresAt) : '');
  const [expiresAt, setExpiresAt] = useState<number | null>(initialExpiresAt);
  const [expiresUrl, setExpiresUrl] = useState(initialExpiresUrl ?? '');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const dirty = expiresAt !== initialExpiresAt || (expiresUrl || null) !== (initialExpiresUrl || null);

  const commitDateText = useCallback((text: string) => {
    if (!text.trim()) {
      setExpiresAt(null);
      setError(null);
      return;
    }
    const parsed = parseNaturalDate(text);
    if (parsed === null) {
      setError('Could not read that date. Try "tomorrow at 5pm" or "in 2 hours".');
      setExpiresAt(null);
      return;
    }
    setError(null);
    setExpiresAt(parsed);
  }, []);

  const toggleCalendar = () => {
    if (!calendarOpen) {
      // Seed the picker from whatever the field currently reads.
      const parsed = parseNaturalDate(dateText);
      if (parsed !== null) {
        setExpiresAt(parsed);
        setError(null);
      }
    }
    setCalendarOpen(!calendarOpen);
  };

  return (
    <Popup
      title="Link Expiration"
      kbd="E"
      hint="After this date the link stops redirecting to its destination."
      onClose={onClose}
      footerLeft={
        initialExpiresAt ? (
          <button className="popup-link-btn" onClick={() => onSave(null, null)}>
            Remove expiration
          </button>
        ) : null
      }
      footerRight={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!dirty || !!error || expiresAt === null}
            onClick={() => onSave(expiresAt, expiresUrl.trim() || null)}
          >
            {initialExpiresAt ? 'Save' : 'Add expiration'}
          </button>
        </>
      }
    >
      <div className="popup-label">Date and Time</div>
      <div className="popup-input-wrap" ref={anchorRef}>
        <input
          className="popup-input"
          value={dateText}
          placeholder='E.g. "tomorrow at 5pm" or "in 2 hours"'
          onChange={(e) => {
            setDateText(e.target.value);
            commitDateText(e.target.value);
          }}
          onBlur={(e) => commitDateText(e.target.value)}
          autoFocus
        />
        <button
          className="popup-input-affix"
          onClick={toggleCalendar}
          title="Pick a date"
          aria-expanded={calendarOpen}
        >
          <Calendar />
        </button>
      </div>

      {calendarOpen && (
        <CalendarPopover
          value={expiresAt}
          anchorRef={anchorRef}
          onClose={() => setCalendarOpen(false)}
          onClear={() => {
            setExpiresAt(null);
            setDateText('');
            setError(null);
          }}
          onApply={(ms) => {
            setExpiresAt(ms);
            setDateText(formatDateTime(ms));
            setError(null);
            setCalendarOpen(false);
          }}
        />
      )}

      {expiresAt !== null && !error && <div className="popup-hint">Expires on {formatDateTime(expiresAt)}.</div>}
      {error && <div className="popup-hint" style={{ color: 'var(--destructive)' }}>{error}</div>}

      <div className="popup-label">
        <span>Expiration URL</span>
        <span className="field-hint" title="Where to send visitors after the link expires.">
          <Info />
        </span>
      </div>
      <input
        className="popup-input"
        value={expiresUrl}
        placeholder="https://example.com"
        onChange={(e) => setExpiresUrl(e.target.value)}
      />
      <div className="popup-hint">Set a default expiration URL for your domain.</div>
    </Popup>
  );
}

/* -------------------------------------------------------------------------- */
/* Link preview (Open Graph)                                                  */
/* -------------------------------------------------------------------------- */

const MAX_IMAGE_BYTES = 300 * 1024;

export function LinkPreviewPopup({
  fallback,
  initialTitle,
  initialDescription,
  initialImage,
  onClose,
  onSave,
  onReset,
}: {
  /** The preview currently shown in the rail (destination metadata or derived). */
  fallback: OgContent;
  initialTitle: string;
  initialDescription: string;
  initialImage: string;
  onClose: () => void;
  onSave: (values: { og_title: string; og_description: string; og_image: string }) => void;
  onReset: () => void;
}) {
  // Open with the live preview pre-filled so every field is editable straight
  // away; saving stores them as explicit overrides.
  const [title, setTitle] = useState(initialTitle || fallback.title);
  const [description, setDescription] = useState(initialDescription || fallback.description);
  const [image, setImage] = useState(initialImage || fallback.image || '');
  const [urlRowOpen, setUrlRowOpen] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty =
    title !== initialTitle || description !== initialDescription || image !== initialImage;

  const onPickFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setImageError('That file is not an image.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError('Images must be under 300 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImage(String(reader.result));
      setImageError(null);
      setUrlRowOpen(false);
    };
    reader.readAsDataURL(file);
  };

  return (
    <Popup
      title="Link Preview"
      kbd="L"
      hint="Choose how this link looks when it is shared on social platforms."
      wide
      onClose={onClose}
      footerLeft={
        <button
          className="popup-link-btn"
          onClick={() => {
            onReset();
            onClose();
          }}
        >
          Reset to default
        </button>
      }
      footerRight={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!dirty}
            onClick={() => onSave({ og_title: title, og_description: description, og_image: image })}
          >
            Save changes
          </button>
        </>
      }
    >
      <div className="popup-label-row" style={{ marginTop: 0 }}>
        <span className="popup-label">
          <span>Image</span>
        </span>
        <span className="popup-label-actions">
          <button
            className="popup-link-btn"
            onClick={() => {
              setImage('');
              setImageError(null);
            }}
          >
            Remove
          </button>
          <button className="popup-icon-btn" title="Use an image URL" onClick={() => setUrlRowOpen(!urlRowOpen)}>
            <LinkIcon width="14" height="14" />
          </button>
          <button className="popup-icon-btn" title="Upload an image" onClick={() => fileRef.current?.click()}>
            <Upload />
          </button>
        </span>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => onPickFile(e.target.files?.[0])}
      />

      {urlRowOpen && (
        <input
          className="popup-input"
          autoFocus
          placeholder="https://example.com/og-image.png"
          value={image.startsWith('data:') ? '' : image}
          onChange={(e) => setImage(e.target.value)}
        />
      )}

      <div
        className="popup-image"
        role="button"
        tabIndex={0}
        title="Click to use an image URL"
        style={{ cursor: 'pointer' }}
        onClick={() => setUrlRowOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setUrlRowOpen(true);
        }}
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="Link preview" />
        ) : (
          <ImageIcon width="26" height="26" />
        )}
      </div>
      {imageError && <div className="popup-hint" style={{ color: 'var(--destructive)' }}>{imageError}</div>}

      <div className="popup-label-row">
        <span className="popup-label">Title</span>
        <span className="popup-label-actions">
          <span className="popup-counter">
            {title.length}/{OG_TITLE_MAX}
          </span>
          <button className="popup-link-btn" title="Use the destination title" onClick={() => setTitle(fallback.title)}>
            <Sparkle />
          </button>
        </span>
      </div>
      <textarea
        className="popup-input"
        style={{ minHeight: '58px' }}
        maxLength={OG_TITLE_MAX}
        value={title}
        placeholder={fallback.title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <div className="popup-label-row">
        <span className="popup-label">Description</span>
        <span className="popup-label-actions">
          <span className="popup-counter">
            {description.length}/{OG_DESC_MAX}
          </span>
          <button
            className="popup-link-btn"
            title="Use the destination description"
            onClick={() => setDescription(fallback.description)}
          >
            <Sparkle />
          </button>
        </span>
      </div>
      <textarea
        className="popup-input"
        maxLength={OG_DESC_MAX}
        value={description}
        placeholder={fallback.description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="popup-hint">
        If the destination page has preview metadata it is used here automatically; anything you save overrides it.
      </div>
    </Popup>
  );
}
