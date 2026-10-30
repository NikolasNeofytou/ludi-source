'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Scroll machinery for the home page's five rooms.
 *
 * One IntersectionObserver drives three things: the rise (contents enter
 * bottom-up, staggered in reading order), the sweep (ink rooms only, once), and
 * the dot rail. Rise and sweep each run once per room — scrolling back up does
 * not replay them, so the page holds still once you have read it. The rail is
 * the only thing that keeps reacting.
 *
 * `root: null` deliberately: the scroller is the page itself at ≥900px and an
 * ordinary document below that, so observing the viewport works for both.
 *
 * The rise is ARMED here rather than declared in CSS. Content ships visible;
 * this effect hides it and then reveals it. That ordering matters: with
 * `opacity: 0` as the CSS default, a blocked, slow or failed bundle leaves a
 * permanently white page, and the first paint is empty even on a good
 * connection. Arming in a layout effect means the hide-then-reveal happens
 * before the browser paints, so there is no flash of un-animated content
 * either.
 */
// useLayoutEffect warns when React renders this on the server; the behaviour we
// need (run before paint) only exists in the browser anyway.
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function Rooms({ labels, children }: { labels: string[]; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useBeforePaint(() => {
    const node = scroller.current;
    if (!node) return;

    node.classList.add('is-armed');

    const sections = Array.from(node.querySelectorAll<HTMLElement>('[data-room]'));

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // How much of the VIEWPORT the room fills, not how much of the room
          // is visible: the floodlit hero is three viewports tall, so its own
          // intersectionRatio never passes a third. For a one-viewport room
          // the two are the same number.
          const viewport = entry.rootBounds?.height || window.innerHeight;
          const fills = entry.intersectionRect.height / viewport;
          if (!entry.isIntersecting || fills < 0.45) continue;
          const target = entry.target as HTMLElement;

          target.querySelectorAll<HTMLElement>('.rise').forEach((el, i) => {
            // Stagger is applied here rather than in CSS so the delay follows
            // DOM order — i.e. reading order — without hard-coding nth-child.
            el.style.transitionDelay = `${i * 80}ms`;
            el.classList.add('is-in');
          });

          target.querySelector<HTMLElement>('.sweep')?.classList.add('is-in');

          const index = Number(target.dataset.room);
          if (!Number.isNaN(index)) setActive(index);
        }
      },
      // Fine-grained so a tall room still reports as it crosses the 0.45 mark.
      { threshold: Array.from({ length: 21 }, (_, i) => i / 20) },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const goTo = (index: number) => {
    const node = scroller.current;
    node?.querySelectorAll<HTMLElement>('[data-room]')[index]?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  return (
    <>
      <div className="rooms" ref={scroller}>
        {children}
      </div>

      {/* Buttons, not dots: this is real navigation, so it has to be reachable
       * from the keyboard and carry a name. */}
      <nav className="rail-dots" aria-label="Sections">
        {labels.map((label, i) => (
          <button
            key={label}
            type="button"
            className="rail-dots__dot"
            aria-current={i === active}
            aria-label={label}
            onClick={() => goTo(i)}
          />
        ))}
      </nav>
    </>
  );
}

/** One full-height room. `ground` sets the chalk · ink rhythm. */
export function Room({
  index,
  ground = 'chalk',
  centred = false,
  sweep = false,
  children,
}: {
  index: number;
  ground?: 'chalk' | 'ink' | 'deep';
  centred?: boolean;
  /** Ink rooms only — a Λ outline expanding from the room's centre, once. */
  sweep?: boolean;
  children: ReactNode;
}) {
  const className = [
    'room',
    ground === 'ink' ? 'room--ink' : ground === 'deep' ? 'room--deep' : '',
    centred ? 'room--centred' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={className} data-room={index}>
      {sweep ? (
        <svg className="sweep" width="260" height="260" viewBox="0 0 180 180" aria-hidden="true">
          <path d="M90 20 L178 172 L2 172 Z" fill="none" stroke="#63A6B7" strokeWidth="1.6" />
        </svg>
      ) : null}
      <div style={{ position: 'relative', width: '100%', maxWidth: '62rem', margin: '0 auto' }}>
        {children}
      </div>
    </section>
  );
}
