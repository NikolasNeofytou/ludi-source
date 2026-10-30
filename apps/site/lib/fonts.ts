import { JetBrains_Mono, Literata } from 'next/font/google';

// The two documents that carry their own <html>, `app/[locale]/layout.tsx`
// and `app/global-not-found.tsx`, both put these on it, so they're declared
// once here.
//
// Literata, not Fraunces. The mobile app's display face is Fraunces
// (packages/ui/src/tokens.ts, ADR-0007), but Fraunces ships only
// latin/latin-ext/vietnamese — no Greek. Half this site is Greek, so
// Fraunces meant every `/el/*` heading silently fell back to a system
// serif. Literata carries greek + greek-ext with the same 500/600 +
// italic range, so EN and EL render in the same real display face.
// The app has the same gap and hasn't been changed yet — see
// docs/plans/site.md §Visual direction.
const literata = Literata({
  subsets: ['latin', 'greek'],
  weight: ['500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'greek'],
  weight: ['400', '500', '700'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

/** The className for <html>: defines both font CSS variables. */
export const fontVariables = `${literata.variable} ${jetbrainsMono.variable}`;
