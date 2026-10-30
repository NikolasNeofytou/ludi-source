'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { LudiMark } from '@/components/ludi-mark';

/**
 * The overture: the mark holds centre-stage, one ring radiates, then it flies
 * into the header lockup as the curtain lifts.
 *
 * THE CURTAIN IS SERVER-RENDERED AND ANIMATES FROM FIRST PAINT. It used to
 * render `null` on the server and only appear once React had hydrated, which
 * meant the page was already on screen before the curtain dropped — an
 * entrance that arrives after the entrance. No amount of compositor hinting
 * fixes that; the markup has to exist in the first paint.
 *
 * So JavaScript no longer starts the sequence. CSS does. JS does three smaller
 * things: aims the flight, tidies up at the end, and skips it when it should
 * not play. If JS never runs at all, the curtain still lifts and the page is
 * still revealed — the mark simply flies to a fallback position.
 *
 * Aiming can wait, which is what makes this safe: the flight does not begin
 * until 37% of the duration (~960ms), so there is time to measure the real
 * header lockup and update the custom properties before anything moves.
 */
const DURATION_DESKTOP = 2600;
const DURATION_MOBILE = 1800; // "anything longer on a cold 4G load is a bounce"
const MARK_SIZE = 180;
const SESSION_KEY = 'ludi:overture';

const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function Overture() {
  // Starts true so the server emits the curtain. JS takes it away.
  const [present, setPresent] = useState(true);
  const markRef = useRef<HTMLDivElement>(null);

  useBeforePaint(() => {
    const node = markRef.current;
    if (!node) return;

    // `?overture` forces a replay. Once-per-session is right for a visitor and
    // hostile to anyone trying to look at the thing.
    const forced = new URLSearchParams(window.location.search).has('overture');

    let seen = false;
    try {
      seen = window.sessionStorage.getItem(SESSION_KEY) === 'played';
    } catch {
      // Private mode or blocked storage — play it, just don't remember.
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if ((seen && !forced) || reduced) {
      // Pull it before paint, so a repeat visitor never sees it flash.
      setPresent(false);
      return;
    }

    // Aim the flight at the real header lockup rather than a fixed offset,
    // so it lands inside it at any viewport instead of beside it.
    const measure = () => {
      const target = document.querySelector<SVGElement>('.site-header__mark svg');
      if (!target) return;
      const rect = target.getBoundingClientRect();
      if (rect.width === 0) return;
      node.style.setProperty('--dx', `${(rect.left + rect.width / 2 - window.innerWidth / 2).toFixed(1)}px`);
      node.style.setProperty('--dy', `${(rect.top + rect.height / 2 - window.innerHeight / 2).toFixed(1)}px`);
      node.style.setProperty('--s', (rect.width / MARK_SIZE).toFixed(4));
    };

    const duration = window.innerWidth < 900 ? DURATION_MOBILE : DURATION_DESKTOP;
    document.documentElement.style.setProperty('--overture', `${duration}ms`);

    measure();
    document.fonts?.ready.then(measure).catch(() => {});
    // Last reading before the flight begins at 34% — fonts, the header's own
    // fade and any late layout have settled by now.
    const remeasure = window.setTimeout(measure, Math.round(duration * 0.26));

    const done = window.setTimeout(() => {
      setPresent(false);
      try {
        window.sessionStorage.setItem(SESSION_KEY, 'played');
      } catch {
        /* ignore */
      }
    }, duration);

    return () => {
      window.clearTimeout(remeasure);
      window.clearTimeout(done);
    };
  }, []);

  if (!present) return null;

  return (
    <div className="overture" aria-hidden="true">
      <div className="overture__curtain" />
      <div className="overture__ring">
        <svg viewBox="0 0 180 180" width={MARK_SIZE} height={MARK_SIZE}>
          <path d="M90 20 L178 172 L2 172 Z" fill="none" stroke="#63A6B7" strokeWidth="1.6" />
        </svg>
      </div>
      <div className="overture__mark" ref={markRef}>
        <LudiMark size={MARK_SIZE} density="full" />
      </div>
    </div>
  );
}
