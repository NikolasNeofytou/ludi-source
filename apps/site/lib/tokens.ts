// Web-friendly subset of @ludi/ui tokens.ts — "Chalk & Aegean".
//
// Why duplicated: @ludi/ui re-exports React Native primitives (Pressable, View, Text)
// that don't compile in a webpack/Next.js build. ADR-0007 plans a sibling
// `packages/ui-web/` once apps/admin and apps/site need real shared components — at
// which point this file goes away in favor of `import { tokens } from '@ludi/ui-web'`.
//
// Until then, mirror values verbatim from packages/ui/src/tokens.ts and
// apps/admin/lib/tokens.ts. If you change one, change all three.

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
  terracotta: '#C1502E',
  terraSoft: '#F4E1D4',
  terraDeep: '#8B3415',
  // legacy aliases (pre-handoff pages referenced `sea`)
  sea: '#175E77',
  seaSoft: '#DCE9EC',
} as const;
