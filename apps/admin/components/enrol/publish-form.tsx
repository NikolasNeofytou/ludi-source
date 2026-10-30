'use client';

import { ActionForm } from '@/components/ui/form';
import { publishVenue } from '@/lib/enrol-actions';

// Step 5's one button. Publishing is `is_active = true` and nothing else:
// the venue becomes visible to players, its courts stay hidden until the
// Ludi team verifies them, which the verify guard forbids until Stripe
// clears. The review page says all of that above this button.
export function PublishForm({ venueId, published }: { venueId: string; published: boolean }) {
  if (published) {
    return (
      <p role="status" className="form-ok">
        Published. Players in an enabled city can see the venue; its courts appear once verified.
      </p>
    );
  }
  return (
    <ActionForm action={publishVenue} submitLabel="Publish venue" hidden={{ venue_id: venueId }}>
      {() => null}
    </ActionForm>
  );
}
