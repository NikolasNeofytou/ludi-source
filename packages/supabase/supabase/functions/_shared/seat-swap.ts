// _shared/seat-swap.ts
// The swap's refusals, as the database raises them (migration
// 20261013000002) and as the clients switch on them. One table so
// take-seat and its tests agree on every code.

import type { ErrorCode } from './errors.ts';

export interface SwapRefusal {
  code: ErrorCode;
  status: number;
  message: string;
}

const REFUSALS: Partial<Record<ErrorCode, Omit<SwapRefusal, 'code'>>> = {
  INVALID_INVITE: { status: 404, message: 'This invite is not valid' },
  SEAT_NOT_TAKEABLE: { status: 409, message: 'This match is not taking replacements' },
  FIXTURE_STARTED: { status: 409, message: 'This match has already kicked off' },
  ALREADY_IN: { status: 409, message: 'You are already on this match' },
  NO_SEAT_TO_TAKE: { status: 409, message: 'Nobody is waiting to hand over a seat' },
  SEAT_REQUIRES_PAYMENT: { status: 409, message: 'This seat is paid for' },
  ALREADY_PAID_HERE: { status: 409, message: 'You already paid a share on this match' },
  INVALID_SLOT_KIND: { status: 400, message: 'Unknown slot kind' },
  FIXTURE_FULL: { status: 409, message: 'Every slot of that kind is taken' },
};

/** Maps a Postgres error raised by _swap_seat to a typed refusal, or null. */
export function swapRefusalFromPg(err: { code?: string; message?: string } | null): SwapRefusal | null {
  if (!err || err.code !== 'P0001' || !err.message) return null;
  for (const [code, refusal] of Object.entries(REFUSALS) as [ErrorCode, Omit<SwapRefusal, 'code'>][]) {
    if (err.message === code || err.message.startsWith(code)) {
      return { code, ...refusal };
    }
  }
  return null;
}
