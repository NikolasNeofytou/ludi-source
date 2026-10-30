'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useCopy } from '@/components/locale-provider';
import { createClient } from '@/lib/supabase/client';

export function SignOutButton() {
  const router = useRouter();
  const t = useCopy();
  const [loading, setLoading] = useState(false);

  async function signOut() {
    setLoading(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push('/login');
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={loading}
      className="btn btn-secondary"
    >
      {loading ? t.shell.signingOut : t.shell.signOut}
    </button>
  );
}
