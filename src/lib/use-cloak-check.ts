'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CloakCheck } from '@/lib/links/cloak-check';
import { parseHttpUrl } from '@/lib/validate';

/** Asks the server whether `dest` can be cloaked on `domain`. Never throws: a request that fails is "could not tell". */
async function fetchCloakCheck(dest: string, domain: string): Promise<CloakCheck> {
  try {
    const res = await fetch(`/api/links/cloak-check?url=${encodeURIComponent(dest)}&domain=${encodeURIComponent(domain)}`);
    if (!res.ok) return { status: 'unknown', why: 'unreachable' };
    const data = (await res.json()) as { cloak?: CloakCheck };
    return data.cloak ?? { status: 'unknown', why: 'unreachable' };
  } catch {
    return { status: 'unknown', why: 'unreachable' };
  }
}

/**
 * Can the destination be shown in a cloaked link? Some sites forbid being shown inside another site, and a
 * cloaked link to one is a blank page (see worker/lib/cloak-check.ts for how the server tells).
 *
 * - While `active` (cloaking is on) the destination is checked on its own, shortly after it stops changing,
 *   so a link that is already cloaked is flagged the moment its editor opens.
 * - `check()` asks right now, for the moment the switch is turned on; it resolves with the answer.
 * Answers are kept per destination and domain, so an answer is never shown for another address. A real answer
 * is kept for as long as the editor is open; "could not tell" is asked again the next time `check()` is called.
 */
export function useCloakCheck(dest: string, domain: string, active: boolean) {
  const key = `${domain}|${dest.trim()}`;
  const [answers, setAnswers] = useState<Record<string, CloakCheck>>({});
  const [asking, setAsking] = useState<string | null>(null);
  const inFlight = useRef(new Map<string, Promise<CloakCheck>>());
  const settled = useRef(new Map<string, CloakCheck>());

  const check = useCallback((address: string, onDomain: string): Promise<CloakCheck> => {
    // Nothing to ask about yet (no address, or one still being typed): say nothing, and ask once it is readable.
    if (!parseHttpUrl(address).ok) return Promise.resolve({ status: 'unknown', why: 'not-checked' });
    const asked = `${onDomain}|${address.trim()}`;
    const known = settled.current.get(asked);
    if (known) return Promise.resolve(known);
    const running = inFlight.current.get(asked);
    if (running) return running;

    setAsking(asked);
    const promise = fetchCloakCheck(address.trim(), onDomain).then((answer) => {
      inFlight.current.delete(asked);
      if (answer.status !== 'unknown') settled.current.set(asked, answer);
      setAnswers((prev) => ({ ...prev, [asked]: answer }));
      setAsking((current) => (current === asked ? null : current));
      return answer;
    });
    inFlight.current.set(asked, promise);
    return promise;
  }, []);

  const answer = answers[key] ?? null;
  useEffect(() => {
    // Only a readable address is worth asking about, and each address is looked at on its own once.
    if (!active || answer || !parseHttpUrl(dest).ok) return;
    const timer = setTimeout(() => void check(dest, domain), 500);
    return () => clearTimeout(timer);
  }, [active, answer, dest, domain, check]);

  return { answer, checking: asking === key, check };
}
