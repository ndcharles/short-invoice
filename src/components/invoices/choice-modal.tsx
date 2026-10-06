'use client';

import React, { useEffect } from 'react';
import { XIcon } from '@/components/icons';

export interface Choice {
  label: string;
  /** Primary is the recommended action; it is focused when the modal opens. */
  variant?: 'primary' | 'outline' | 'danger';
  onSelect: () => void;
}

/** Small in-app dialog with a few labelled choices, used instead of window.confirm. */
export function ChoiceModal({
  title,
  children,
  choices,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  choices: Choice[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal choice-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="choice-modal-body">{children}</div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            {choices.map((choice) => (
              <button
                key={choice.label}
                className={`btn ${choice.variant === 'primary' ? 'btn-primary' : choice.variant === 'danger' ? 'btn-danger' : 'btn-outline'}`}
                autoFocus={choice.variant === 'primary' || choice.variant === 'danger'}
                onClick={choice.onSelect}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface ConfirmRequest {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
}

/**
 * In-app replacement for window.confirm:
 *   const [ask, confirmModal] = useConfirm();
 *   if (!(await ask({ title, message, confirmLabel }))) return;
 * and render {confirmModal} anywhere in the component.
 */
export function useConfirm(): [(request: ConfirmRequest) => Promise<boolean>, React.ReactNode] {
  const [pending, setPending] = React.useState<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);

  const ask = React.useCallback(
    (request: ConfirmRequest) => new Promise<boolean>((resolve) => setPending({ ...request, resolve })),
    []
  );

  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const modal = pending ? (
    <ChoiceModal
      title={pending.title}
      onClose={() => settle(false)}
      choices={[{ label: pending.confirmLabel, variant: pending.destructive ? 'danger' : 'primary', onSelect: () => settle(true) }]}
    >
      <div>{pending.message}</div>
    </ChoiceModal>
  ) : null;

  return [ask, modal];
}
