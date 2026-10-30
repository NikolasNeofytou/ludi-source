// A human from inside the app (plans/ops-readiness.md O8). One address,
// read daily — that is the whole SLA. The mail opens with the version, the
// OS and the opaque user id already under the signature, so the first reply
// does not have to ask which phone and which build.
import { Linking, Platform } from 'react-native';

import { appVersion } from '@/lib/app-gate';

export const HELP_EMAIL = 'hello@ludi.football';

export function openHelpMail(subject: string, userId?: string | null): void {
  const os = Platform.OS === 'ios' ? 'iOS' : 'Android';
  const footer = `\n\n\n—\nLudi ${appVersion()} · ${os} ${Platform.Version}${userId ? ` · ${userId}` : ''}`;
  const url = `mailto:${HELP_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(footer)}`;
  // No mail app set up: nothing opens, and the address is printed beside
  // the row so it can still be copied by hand.
  Linking.openURL(url).catch(() => {});
}
