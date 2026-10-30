'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The home hero as a scroll-scrubbed scene: a Cypriot five-a-side cage seen
 * from the rooftops, dusk turning to night and the floodlights coming on as
 * you scroll through the room. The frames are a Higgsfield (Seedance 2.5)
 * clip of a flat illustration, cut to stills — see docs/plans/site.md's
 * 2026-10-01 entry for the source and how to rebuild them.
 *
 * THE POSTER IS THE PAGE. Frame 1 ships as a plain <picture> in the server
 * HTML, so first paint, no-JS, reduced motion and Save-Data all get the full
 * hero as a still. The canvas only ever paints over it with the same crop, so
 * the moment it takes over is invisible.
 *
 * Two frame sets, chosen once at mount: 61 desktop frames (1600w, 16:9) and
 * 61 phone frames pre-cropped to 3:4 around the pitch, so a phone never
 * downloads the half of each frame it would crop away. Frames load coarse to
 * fine (every 8th, then 4th, 2nd, all), so an early scroll already moves; the
 * draw falls back to the nearest loaded frame below and cross-fades into the
 * next one, which is what lets 61 frames read as continuous motion.
 *
 * Motion lives inside the artwork only — the copy over it holds still.
 */
const FRAMES = 61;
const PHONE = '(max-width: 899px)';
const frameSrc = (set: 'd' | 'm', i: number) =>
  `/home/floodlit/${set}/f${String(i + 1).padStart(3, '0')}.webp`;

/** Horizontal crop bias — must match `object-position` on the poster. */
const BIAS = { d: 0.7, m: 0.5 } as const;

export function FloodlitHero({ children }: { children: ReactNode }) {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!section || !canvas || !ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
      ?.saveData;
    if (reduced || saveData) return;

    const set = window.matchMedia(PHONE).matches ? 'm' : 'd';
    const requested: HTMLImageElement[] = [];
    // A frame's slot is filled only once it has decoded.
    const loaded: (HTMLImageElement | null)[] = new Array(FRAMES).fill(null);

    for (const step of [8, 4, 2, 1]) {
      for (let i = 0; i < FRAMES; i += step) {
        if (loaded[i] !== null || requested[i]) continue;
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          loaded[i] = img;
          dirty = true;
        };
        img.src = frameSrc(set, i);
        requested[i] = img;
      }
    }

    let current = 0;
    let drawn = -1;
    let dirty = true;
    let raf = 0;
    let running = false;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      dirty = true;
    };

    const paint = (img: HTMLImageElement, alpha: number) => {
      const { width: cw, height: ch } = canvas;
      const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, (cw - w) * BIAS[set], (ch - h) / 2, w, h);
    };

    const draw = (position: number) => {
      const floor = Math.floor(position);
      let base = floor;
      while (base > 0 && !loaded[base]) base--;
      const baseImg = loaded[base];
      if (!baseImg) return;
      paint(baseImg, 1);
      // Cross-fade into the next frame only from the exact frame below it.
      const nextImg = base === floor ? loaded[floor + 1] : null;
      const blend = position - floor;
      if (nextImg && blend > 0.01) paint(nextImg, blend);
      ctx.globalAlpha = 1;
      drawn = position;
    };

    const progress = () => {
      const rect = section.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      return span > 0 ? Math.min(1, Math.max(0, -rect.top / span)) : 0;
    };

    const tick = () => {
      const target = progress() * (FRAMES - 1);
      current += (target - current) * 0.2;
      if (Math.abs(target - current) < 0.002) current = target;
      if (dirty || Math.abs(current - drawn) > 0.002) {
        dirty = false;
        draw(current);
      }
      raf = running ? requestAnimationFrame(tick) : 0;
    };

    // Only run the loop while the hero is on screen.
    const observer = new IntersectionObserver((entries) => {
      running = entries.some((entry) => entry.isIntersecting);
      if (running && !raf) raf = requestAnimationFrame(tick);
    });

    resize();
    window.addEventListener('resize', resize);
    observer.observe(section);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      for (const img of requested) if (img) img.onload = null;
    };
  }, []);

  return (
    <section ref={sectionRef} className="room room--floodlit" data-room={0}>
      <div className="floodlit__stage">
        <picture className="floodlit__poster">
          <source media={PHONE} srcSet={frameSrc('m', 0)} />
          <img src={frameSrc('d', 0)} alt="" fetchPriority="high" />
        </picture>
        <canvas ref={canvasRef} className="floodlit__canvas" aria-hidden="true" />
        <div className="floodlit__scrim" />
        <div className="floodlit__copy">{children}</div>
      </div>
    </section>
  );
}
