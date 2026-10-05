'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** In production `public/_redirects` sends `/` to `/links` before this loads. */
export default function Home() {
  const router = useRouter();
  useEffect(() => router.replace('/links'), [router]);
  return null;
}
