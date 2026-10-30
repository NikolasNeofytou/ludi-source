'use client';

import Image from 'next/image';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import type { StoryControls, StoryPanel } from '@/lib/content/rooms';

/**
 * Real screenshots, not mockups — see `docs/plans/site.md`'s 2026-09-14
 * changelog entry. `public/app/*.jpg` are captured from the TestFlight build
 * running in the iOS Simulator, cropped below the status bar, at native
 * screen proportions (see the changelog for how).
 *
 * One phone, shown large, standing on the touchline of an illustrated night
 * pitch; the five steps sit beside it and choose its screen. The layout is
 * Apple's AirPods Pro page: "Take a closer look" (a list of pills beside one
 * big product, the open pill reads "**Title.** One sentence.") on desktop,
 * and "Get the highlights" (a caption under the picture, a pill paginator
 * with a progress bar, a round pause button) on a phone. 2026-10-15
 * changelog entry.
 *
 * Each screenshot is shown WHOLE: never cropped, stretched or retouched. The
 * frame adds only what the capture cut off, the status bar with the island,
 * so the screen reads at the real iPhone ratio (393 × 852 pt, of which the
 * status bar is 54 pt). The stage is generated art (2026-10-01 entry); the
 * screens on it are not.
 *
 * It plays itself through once, then stops. Leaving the viewport holds it,
 * the round button pauses it, choosing a step stops it, and reduced motion
 * never starts it. Hover does not hold it: Apple's doesn't, and a hold under
 * the pointer would swallow a click on Play. The timer is the progress bar's
 * own CSS animation, so holding is `animation-play-state` and the next step
 * comes from its `animationend`: a hidden bar (display: none) never runs, so
 * only the bar the reader can see moves the story on.
 */
const IMAGES: Record<
  StoryPanel['image'],
  { src: string; width: number; height: number; statusBar: string }
> = {
  // statusBar is the screenshot's own top-edge colour, so the drawn status
  // bar runs into the screen without a seam.
  discover: { src: '/app/discover.jpg', width: 640, height: 1307, statusBar: '#F2F4F3' },
  book: { src: '/app/book.jpg', width: 640, height: 1307, statusBar: '#FAFEFD' },
  community: { src: '/app/community.jpg', width: 640, height: 1307, statusBar: '#F2F4F3' },
  bookings: { src: '/app/bookings.jpg', width: 640, height: 1307, statusBar: '#F2F4F3' },
  profile: { src: '/app/profile.jpg', width: 640, height: 1307, statusBar: '#F0F4F7' },
};

export function AppStory({
  panels,
  controls,
  action,
  children,
}: {
  panels: StoryPanel[];
  controls: StoryControls;
  /** The download row: under the steps on desktop, under the phone on a phone. */
  action?: ReactNode;
  /** The room's eyebrow, title and paragraph — they share the left column. */
  children: ReactNode;
}) {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [ended, setEnded] = useState(false);
  const [inView, setInView] = useState(false);

  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const swipeFrom = useRef<number | null>(null);

  const last = panels.length - 1;
  const running = playing && inView;

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(false);

    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(!!entry && entry.isIntersecting && entry.intersectionRatio >= 0.5),
      { threshold: [0, 0.5, 1] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const advance = () => {
    if (active < last) {
      setActive(active + 1);
    } else {
      setPlaying(false);
      setEnded(true);
    }
  };

  /** The reader took over: show their step and stop the clock. */
  const choose = (index: number) => {
    setActive(Math.max(0, Math.min(last, index)));
    setPlaying(false);
    setEnded(false);
  };

  const toggle = () => {
    if (ended) {
      setActive(0);
      setEnded(false);
      setPlaying(true);
    } else {
      setPlaying(!playing);
    }
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    const by = step[event.key];
    let next: number | null = null;
    if (by !== undefined) next = (active + by + panels.length) % panels.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    choose(next);
    tabs.current[next]?.focus();
  };

  const onSwipeStart = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') swipeFrom.current = event.clientX;
  };

  const onSwipeEnd = (event: PointerEvent<HTMLDivElement>) => {
    const from = swipeFrom.current;
    swipeFrom.current = null;
    if (from === null) return;
    const dx = event.clientX - from;
    if (Math.abs(dx) > 40) choose(active + (dx < 0 ? 1 : -1));
  };

  const progress = (className: string) => (
    <span
      key={active}
      className={className}
      style={{ animationPlayState: running ? 'running' : 'paused' }}
      onAnimationEnd={advance}
    />
  );

  const current = panels[active];
  if (!current) return null;
  const toggleLabel = ended ? controls.replay : playing ? controls.pause : controls.play;

  return (
    <div className="showcase" ref={root}>
      <div className="showcase__copy">
        {children}
        <div
          className="showcase__steps rise"
          role="tablist"
          aria-orientation="vertical"
          aria-label={controls.label}
        >
          {panels.map((panel, i) => {
            const on = i === active;
            return (
              <button
                key={panel.image}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`story-tab-${i}`}
                aria-selected={on}
                aria-controls="story-screen"
                tabIndex={on ? 0 : -1}
                className="step"
                onClick={() => choose(i)}
                onKeyDown={onTabKey}
              >
                <span className="mono step__num">{panel.label}</span>
                <span className="step__text">
                  <strong className="step__title">
                    {panel.title}
                    <span className="step__stop">.</span>
                  </strong>
                  <span className="step__body"> {panel.body}</span>
                </span>
                {on ? <span className="step__track">{progress('step__bar')}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="showcase__stage rise" onPointerDown={onSwipeStart} onPointerUp={onSwipeEnd}>
        <div
          className="phone"
          role="tabpanel"
          id="story-screen"
          aria-labelledby={`story-tab-${active}`}
        >
          <div className="phone__screen" style={{ background: IMAGES[current.image].statusBar }}>
            <div className="phone__status" aria-hidden="true">
              <span className="phone__time">9:41</span>
              <span className="phone__island" />
              <span className="phone__battery" />
            </div>
            <div className="phone__stack">
              {panels.map((panel, i) => {
                const image = IMAGES[panel.image];
                const on = i === active;
                return (
                  <Image
                    key={panel.image}
                    src={image.src}
                    alt={on ? `${panel.title} — ${panel.body}` : ''}
                    aria-hidden={!on}
                    width={image.width}
                    height={image.height}
                    sizes="(min-width: 900px) 300px, 250px"
                    className="phone__img"
                    data-on={on}
                    priority={i === 0}
                  />
                );
              })}
            </div>
          </div>
        </div>

        <p className="showcase__caption" aria-hidden="true">
          <strong>{current.title}.</strong> {current.body}
        </p>

        <div className="showcase__controls">
          <div className="showcase__dots">
            {panels.map((panel, i) => (
              <button
                key={panel.image}
                type="button"
                className="dot"
                aria-label={`${panel.label} ${panel.title}`}
                aria-current={i === active}
                onClick={() => choose(i)}
              >
                {i === active ? progress('dot__bar') : null}
              </button>
            ))}
          </div>
          <button type="button" className="showcase__toggle" aria-label={toggleLabel} onClick={toggle}>
            {ended ? <ReplayIcon /> : playing ? <PauseIcon /> : <PlayIcon />}
          </button>
        </div>
      </div>

      {action ? <div className="showcase__action rise">{action}</div> : null}
    </div>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2" y="1.5" width="2.6" height="9" rx="0.8" fill="currentColor" />
      <rect x="7.4" y="1.5" width="2.6" height="9" rx="0.8" fill="currentColor" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 1.6 L10.4 6 L3 10.4 Z" fill="currentColor" />
    </svg>
  );
}

function ReplayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M2.6 7a4.4 4.4 0 1 0 1.3-3.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M2.2 1.6v3h3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
