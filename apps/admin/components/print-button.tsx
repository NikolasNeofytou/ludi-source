'use client';

import { useCopy } from '@/components/locale-provider';

// The "PDF" an owner asks for is the browser's print dialog: every phone and
// laptop offers Save as PDF there, the page carries its own print
// stylesheet, and nothing has to be generated or stored.
export function PrintButton() {
  const t = useCopy();
  return (
    <button type="button" className="btn btn-primary no-print" onClick={() => window.print()}>
      {t.common.printPdf}
    </button>
  );
}
