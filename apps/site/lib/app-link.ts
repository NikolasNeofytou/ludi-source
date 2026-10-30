// Which "Get the app" button was pressed: a closed list, for the same reason
// as the scan sources in lib/scan-source.ts. An enum can be counted without
// ever carrying anything about the person, and anything unknown counts as
// 'other' rather than as whatever string a URL happened to hold.
export const APP_LINK_SOURCES = [
  'home-app',
  'home-hero',
  'home-close',
  'players-hero',
  'players-close',
  'invite',
] as const;

export type AppLinkSource = (typeof APP_LINK_SOURCES)[number] | 'other';

export function parseAppLinkSource(value: string | null): AppLinkSource {
  return (APP_LINK_SOURCES as readonly string[]).includes(value ?? '') ? (value as AppLinkSource) : 'other';
}
