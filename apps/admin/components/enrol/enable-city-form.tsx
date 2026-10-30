'use client';

import { ActionForm } from '@/components/ui/form';
import { enableCity } from '@/lib/enrol-actions';

// The founder's one decision on the Review page, as a button under the
// line that raises it. Admin only (the page is); the action flips
// cities.is_enabled and audits it as enable_city.
export function EnableCityForm({
  venueId,
  cityId,
  cityName,
}: {
  venueId: string;
  cityId: string;
  cityName: string;
}) {
  return (
    <ActionForm
      action={enableCity}
      submitLabel={`Enable ${cityName} for players`}
      hidden={{ venue_id: venueId, city_id: cityId }}
    >
      {() => (
        <p className="field-hint" style={{ margin: 0 }}>
          Players in {cityName} start seeing every published venue there, this one
          included — its courts still wait for verification. A founder decision;
          it is audited.
        </p>
      )}
    </ActionForm>
  );
}
