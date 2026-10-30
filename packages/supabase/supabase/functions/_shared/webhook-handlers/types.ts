// _shared/webhook-handlers/types.ts
// Shape every webhook handler conforms to.

import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';

export interface HandlerContext {
  supa: SupabaseClient;
  stripe: Stripe;
  event: Stripe.Event;
}

export interface HandlerResult {
  /** HTTP status to return to Stripe. Always 200 for successful handling,
   *  even when nothing to do. Non-2xx triggers Stripe's retry. */
  status: number;
  /** Short tag written to `stripe_events.notes` for observability. */
  notes?: string;
}

export type Handler = (ctx: HandlerContext) => Promise<HandlerResult>;
