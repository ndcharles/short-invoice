'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Step = 'email' | 'password' | 'setup';

const PASSWORD_MIN = 12;

/** Only same-site paths, so `?next=` can never send someone to another site. */
function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/login') ? value : '/links';
}

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const next = safeNext(useSearchParams().get('next'));
  const [brand, setBrand] = useState<{ name: string; logo: string } | null>(null);
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/auth/brand')
      .then((res) => res.json())
      .then(setBrand)
      .catch(() => setBrand({ name: 'Workspace', logo: '' }));
  }, []);

  useEffect(() => {
    if (step === 'password') passwordRef.current?.focus();
    if (step === 'setup') codeRef.current?.focus();
  }, [step]);

  const checkEmail = async () => {
    const value = email.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    const { data } = await post('/api/auth/check', { email: value });
    setBusy(false);
    // Unknown emails get no response at all: the page simply stays as it is.
    if (data.next === 'password' || data.next === 'setup') setStep(data.next);
  };

  const signIn = async () => {
    if (!password) return;
    setBusy(true);
    setError(null);
    const { ok, data } = await post('/api/auth/login', { email: email.trim(), password });
    if (ok) {
      window.location.replace(next);
      return;
    }
    setBusy(false);
    setPassword('');
    setError(data.error ?? 'Could not sign in');
  };

  const setUp = async () => {
    if (password.length < PASSWORD_MIN) return setError(`Use at least ${PASSWORD_MIN} characters for your password.`);
    if (password !== confirm) return setError('The two passwords do not match.');
    if (!name.trim()) return setError('Enter your name.');
    setBusy(true);
    setError(null);
    const { ok, data } = await post('/api/auth/setup', { email: email.trim(), code, name: name.trim(), password });
    if (ok) {
      window.location.replace(next);
      return;
    }
    setBusy(false);
    setError(data.error ?? 'Could not set up your account');
  };

  const changeEmail = (value: string) => {
    setEmail(value);
    // Editing the email starts over, so nothing typed for one account leaks into another.
    if (step !== 'email') {
      setStep('email');
      setPassword('');
      setConfirm('');
      setCode('');
      setError(null);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (step === 'email') void checkEmail();
    else if (step === 'password') void signIn();
    else void setUp();
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit} noValidate>
        <div className="login-brand">
          {brand?.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logo} alt={brand.name} className="login-logo" />
          ) : (
            <div className="login-logo login-logo-fallback">{(brand?.name ?? ' ').slice(0, 1).toUpperCase()}</div>
          )}
          <div className="login-workspace">{brand?.name ?? ''}</div>
        </div>

        <label className="login-field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="username"
            autoFocus
            inputMode="email"
            value={email}
            onChange={(e) => changeEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </label>

        {step === 'email' && (
          <button className="btn btn-primary login-button" type="submit" disabled={busy || !email.trim()}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
        )}

        {step === 'password' && (
          <>
            <label className="login-field">
              <span>Password</span>
              <div className="login-password">
                <input
                  ref={passwordRef}
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button type="button" className="login-show" onClick={() => setShow(!show)}>
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>
            <button className="btn btn-primary login-button" type="submit" disabled={busy || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="login-hint">Forgot your password? Ask your admin to reset your access.</p>
          </>
        )}

        {step === 'setup' && (
          <>
            <p className="login-hint">First time here: enter the setup code your admin gave you, then choose a password.</p>
            <label className="login-field">
              <span>Setup code</span>
              <input
                ref={codeRef}
                autoComplete="one-time-code"
                spellCheck={false}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="XXXXX-XXXXX"
              />
            </label>
            <label className="login-field">
              <span>Your name</span>
              <input autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="login-field">
              <span>New password</span>
              <div className="login-password">
                <input
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={`At least ${PASSWORD_MIN} characters`}
                />
                <button type="button" className="login-show" onClick={() => setShow(!show)}>
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>
            <label className="login-field">
              <span>Confirm password</span>
              <input type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            <button className="btn btn-primary login-button" type="submit" disabled={busy || !code || !password}>
              {busy ? 'Setting up…' : 'Create account and sign in'}
            </button>
          </>
        )}

        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}
      </form>
    </div>
  );
}
