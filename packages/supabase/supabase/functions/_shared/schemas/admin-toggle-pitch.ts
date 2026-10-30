// _shared/schemas/admin-toggle-pitch.ts
// Zod schemas for the admin-toggle-pitch contract per docs/api-contract.md §7.2.
//
// `action` is intentionally enum-typed rather than a {is_verified, is_active}
// patch object so each call expresses one operator intent and writes one
// admin_actions audit row. Composing two boolean flips into a single call
// would force two audit rows or a generic "other" action_type, neither of
// which makes the audit log greppable later.
//
// 'unverify' is deliberately omitted in v1: admin_actions.action_type's CHECK
// constraint allows 'verify_pitch' / 'activate_pitch' / 'deactivate_pitch'
// but not 'unverify_pitch'. If unverification turns out to be a real ops
// need, extend the CHECK + add 'unverify' here in a follow-up.

import { z } from 'zod';

export const PITCH_TOGGLE_ACTIONS = ['verify', 'activate', 'deactivate'] as const;
export type PitchToggleAction = (typeof PITCH_TOGGLE_ACTIONS)[number];

export const AdminTogglePitchInput = z.object({
  pitch_id: z.string().uuid(),
  action: z.enum(PITCH_TOGGLE_ACTIONS),
  reason: z.string().min(10).max(500),
});

export type AdminTogglePitchInputT = z.infer<typeof AdminTogglePitchInput>;

export const AdminTogglePitchOutput = z.object({
  pitch: z.object({
    id: z.string().uuid(),
    is_verified: z.boolean(),
    is_active: z.boolean(),
  }),
  admin_action_id: z.string().uuid().nullable(),
});

export type AdminTogglePitchOutputT = z.infer<typeof AdminTogglePitchOutput>;
