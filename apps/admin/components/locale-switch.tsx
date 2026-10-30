'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { useCopy, useLocale } from '@/components/locale-provider';
import { LOCALES, type Locale } from '@/lib/copy';
import { setLocale } from '@/lib/locale-actions';

// EN · ΕΛ. Writes the account (when signed in) and the cookie, then
// refreshes so every server component re-renders in the new language.
// The labels are the languages' own names for themselves, so each is
// readable to the person who needs it — an owner in the wrong language
// can still find theirs.
const LABEL: Record<Locale, string> = { en: 'EN', gr: 'ΕΛ' };
const NAME: Record<Locale, string> = { en: 'English', gr: 'Ελληνικά' };

export function LocaleSwitch() {
  const current = useLocale();
  const t = useCopy();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === current || pending) return;
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  return (
    <span className="lang-switch" role="group" aria-label={t.shell.language}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l === 'gr' ? 'el' : 'en'}
          aria-pressed={l === current}
          aria-label={NAME[l]}
          disabled={pending}
          onClick={() => choose(l)}
        >
          {LABEL[l]}
        </button>
      ))}
    </span>
  );
}
