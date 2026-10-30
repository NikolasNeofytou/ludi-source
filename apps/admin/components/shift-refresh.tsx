'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Slice F of plans/venue-staff.md. Today is the page a counter tablet is
// left open on for a whole shift, and "Now and next" is a window that
// moves: rendered at 18:00 and still on screen at 19:30, it would say a
// finished game is on and miss the one that just started. The TV screen
// (tv-screen.tsx) solved the same problem the same way — re-fetch the
// server component once a minute — and this is that, minus the clock.
//
// Two refinements over a bare interval, both for a device left on a
// counter: nothing is fetched while the tab is hidden (a sleeping tablet
// should not poll), and waking it refreshes at once rather than showing
// up to a minute of stale "now".
const EVERY_MS = 60_000;

export function ShiftRefresh() {
  const router = useRouter();

  useEffect(() => {
    const tick = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, EVERY_MS);
    const onVisible = () => {
      if (!document.hidden) router.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router]);

  return null;
}
