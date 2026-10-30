'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';

export type NavItem = { href: string; label: string };

// Client-only because `aria-current` needs the active path. Kept as small
// as possible so the rest of the shell stays a server component.
export function ShellNav({ items, sectionsLabel }: { items: NavItem[]; sectionsLabel: string }) {
  const pathname = usePathname();

  return (
    <nav className="shell-nav" aria-label={sectionsLabel}>
      {items.map((item) => {
        // '/' would prefix-match every route; it is active only exactly.
        const active =
          item.href === '/'
            ? pathname === '/'
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
          >
            <NavLabel label={item.label} />
          </Link>
        );
      })}
    </nav>
  );
}

// Every page renders on the server, so on a slow phone connection a tapped
// tab used to do nothing visible until the next page arrived — long
// enough to tap it again, or give up. useLinkStatus marks the tab that is
// on its way; it must sit inside the <Link> it reports on.
function NavLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return (
    <span className="shell-nav-label" data-pending={pending || undefined}>
      {label}
    </span>
  );
}
