import Link from 'next/link';

import { getCopy } from '@/lib/copy';
import { guestLocale } from '@/lib/locale';

// notFound() is how the owner-scoped pages answer an id outside the
// caller's venues (a pitch or venue that isn't theirs) — same page for
// "doesn't exist" and "isn't yours", on purpose. Renders outside AppShell,
// so the language is the browser's last choice (the cookie), not the
// account's — the switch keeps the two in step.
export default async function NotFound() {
  const t = getCopy(await guestLocale()).notFound;
  return (
    <main className="centre">
      <h1 style={{ fontSize: 30 }}>{t.title}</h1>
      <p style={{ margin: 0, color: 'var(--ludi-ink2)', maxWidth: 460 }}>{t.body}</p>
      <Link href="/" className="btn btn-primary">
        {t.goToday}
      </Link>
    </main>
  );
}
