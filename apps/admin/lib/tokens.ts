// Web-friendly subset of @ludi/ui tokens.ts — "Chalk & Aegean".
//
// Why duplicated: @ludi/ui re-exports React Native primitives (Pressable, View, Text)
// that don't compile in a webpack/Next.js build. ADR-0007 plans a sibling
// `packages/ui-web/` once the admin needs real shared components — at which point
// this file goes away in favor of `import { tokens } from '@ludi/ui-web'`.
//
// Until then, mirror values verbatim from packages/ui/src/tokens.ts. If you change
// one, change the other.

export const tokens = {
  bg: '#F2F4F3',
  surface: '#FFFFFF',
  ink: '#10181C',
  ink2: '#3F4C51',
  ink3: '#5F6E73',
  line: 'rgba(16,24,28,0.07)',
  lineBold: 'rgba(16,24,28,0.12)',
  primary: '#175E77',
  primaryDeep: '#0F3F52',
  primarySoft: '#DCE9EC',
  pitch: '#1F6640',
  pitchDeep: '#174028',
  pitchSoft: '#DFECE3',
  sun: '#D99520',
  sunDeep: '#8A5A0E',
  sunSoft: '#F8E8C9',
  // Semantic only — errors, cancellation, refunds, deactivation. FILLS
  // ONLY on the bg ground; error *text* uses `alertDeep`, because the base
  // at text size is 4.3:1 on bg and fails AA.
  //
  // `alert*` is the role name and what new code should use. These were
  // missing from this mirror until #41c — packages/ui/src/tokens.ts has
  // carried them since the Chalk & Aegean pass, and the `terra*` spellings
  // below are the same values under their old decorative name, kept as
  // aliases so un-rewritten call sites keep working. A colour named after
  // a material invites being used as an accent, which is exactly what this
  // token must never be.
  alert: '#C1502E',
  alertSoft: '#F4E1D4',
  alertDeep: '#8B3415',
  terracotta: '#C1502E',
  terraSoft: '#F4E1D4',
  terraDeep: '#8B3415',
  // legacy aliases (pre-handoff pages referenced `sea`)
  sea: '#175E77',
  seaSoft: '#DCE9EC',
} as const;

// ── CSS custom properties ────────────────────────────────────────────
// The admin's responsive shell needs media queries, which inline style
// objects cannot express, so real CSS has to reach these values.
//
// `apps/site` solves that by hand-mirroring the hex into its globals.css,
// which makes the palette a FOUR-way duplication (packages/ui, this file,
// site/lib/tokens.ts, site globals.css). Rather than add a fifth copy,
// the admin emits the same object as `--ludi-*` custom properties at the
// document root, so globals.css can say `var(--ludi-primary)` and there is
// exactly one place the admin's values live: the object above.
//
// Worth lifting into `packages/ui-web/` whenever that extraction happens
// (ADR-0007) — it is the mechanism that makes the extraction cheap.
export function tokensToCssVars(): string {
  const decls = Object.entries(tokens)
    .map(([key, value]) => `  --ludi-${kebab(key)}: ${value};`)
    .join('\n');
  return `:root {\n${decls}\n}`;
}

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
