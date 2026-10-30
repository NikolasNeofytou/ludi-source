// Placeholder. Currently i18n resources come from @ludi/ui COPY.
// When we split translation JSON out of the UI package (to let designers edit
// copy without touching TS), this package will own those JSON files.
export const LOCALES = ['en', 'gr'] as const;
export type Locale = (typeof LOCALES)[number];
