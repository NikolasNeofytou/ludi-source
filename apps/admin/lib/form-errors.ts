import * as Sentry from '@sentry/nextjs';
import type { ZodError } from 'zod';

import { getCopy, type Locale } from '@/lib/copy';
import type { FieldErrors, FormState } from '@/lib/schemas';

// Every mapper answers in the account's language (ADR-0037): the actions
// pass `viewer.locale`. The enrolment actions are the founder's and pass
// nothing — English is the default, as it was.

// Postgres error codes we can turn into something a human can act on.
// Anything else is logged and sent to Sentry with its raw message, and the
// owner gets a sentence with somewhere to go — a Postgres error string
// means nothing to them, and it describes our schema to whoever reads it.
export function toFormError(
  error: { code?: string; message: string },
  locale: Locale = 'en',
): FormState {
  const t = getCopy(locale).actions;
  if (error.code === '42501') {
    return { status: 'error', message: t.notYours };
  }
  if (error.code === '23505') {
    return { status: 'error', message: t.alreadyExists };
  }
  if (error.code === '23514') {
    return { status: 'error', message: t.outOfRange };
  }
  console.error('admin action failed:', error.code, error.message);
  Sentry.captureException(
    new Error(`admin action failed: ${error.code ?? '?'} ${error.message}`),
  );
  return { status: 'error', message: t.saveFailed };
}

// The zod messages are English in schemas.ts (the source of truth); the
// other language maps them by sentence, and an unmapped one — a zod
// default — becomes that language's "check this field" rather than an
// English constraint description.
function translate(message: string, locale: Locale): string {
  if (locale === 'en') return message;
  const v = getCopy(locale).validation;
  return v.messages[message] ?? v.fallback;
}

export function invalid(
  fieldErrors: Record<string, string[] | undefined>,
  locale: Locale = 'en',
): FormState {
  const cleaned: FieldErrors = {};
  for (const [k, v] of Object.entries(fieldErrors)) {
    if (v && v.length) cleaned[k] = v.map((m) => translate(m, locale));
  }
  return {
    status: 'error',
    message: getCopy(locale).actions.checkFields,
    fieldErrors: cleaned,
  };
}

// `flatten()` only keys top-level fields; a row inside an array reports its
// path as ['courts', 2, 'price_per_hour_eur']. Joined with dots so a table
// row can look up its own message as `courts.2.price_per_hour_eur`.
export function invalidDeep(error: ZodError, locale: Locale = 'en'): FormState {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (fieldErrors[key] ??= []).push(translate(issue.message, locale));
  }
  return {
    status: 'error',
    message: getCopy(locale).actions.checkFields,
    fieldErrors,
  };
}
