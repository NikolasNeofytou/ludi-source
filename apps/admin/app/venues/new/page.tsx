import { redirect } from 'next/navigation';

// The create form was replaced by the counter flow (plans/venue-enrol.md).
// The URL stays so old links and habits land in the right place.
export default function NewVenuePage() {
  redirect('/venues/enrol');
}
