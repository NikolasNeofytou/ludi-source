'use client';

import { startTransition, useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

import { useCopy } from '@/components/locale-provider';
import type { FormState } from '@/lib/schemas';

const IDLE: FormState = { status: 'idle' };

export function SubmitButton({
  label,
  pending: pendingProp,
  className = 'btn btn-primary',
}: {
  label: string;
  pending?: boolean;
  className?: string;
}) {
  const { pending: formPending } = useFormStatus();
  const t = useCopy();
  const pending = pendingProp ?? formPending;
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? t.common.saving : label}
    </button>
  );
}

// A server action behind a form that KEEPS what the owner typed when the
// action refuses it.
//
// React 19 resets a `<form action={…}>` after every submission, errors
// included — so a refused save wiped the fields and the owner retyped
// everything, or worse, re-picked half of it (a Special-hours exception
// with the dropdown silently back on "Closed"). Submitting through
// onSubmit + startTransition skips that reset; `resetOnSuccess` puts it
// back for "add another" forms, where a clean form after a save is right.
export function useKeptAction(
  action: (prev: FormState, data: FormData) => Promise<FormState>,
  { resetOnSuccess = false }: { resetOnSuccess?: boolean } = {},
) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (resetOnSuccess && state.status === 'success') formRef.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    formRef.current = e.currentTarget;
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  }

  const fieldErrors = state.status === 'error' ? (state.fieldErrors ?? {}) : {};
  return { state, pending, onSubmit, fieldErrors };
}

// Wraps a server action so every form gets the same pending state, the same
// error banner, and the same per-field messages without repeating it.
//
// `children` is a render prop rather than plain nodes because the fields
// need the field errors, and threading them through context for four forms
// would be more machinery than it saves.
export function ActionForm({
  action,
  submitLabel,
  hidden,
  resetOnSuccess = false,
  children,
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  submitLabel: string;
  hidden?: Record<string, string>;
  // For forms that add something and stay on the page (granting access),
  // where a filled form after "done" invites a duplicate submit.
  resetOnSuccess?: boolean;
  children: (errors: Record<string, string[]>) => React.ReactNode;
}) {
  const { state, pending, onSubmit, fieldErrors } = useKeptAction(action, {
    resetOnSuccess,
  });

  return (
    <form onSubmit={onSubmit} className="stack">
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {state.status === 'error' ? (
        <p role="alert" className="auth-error">
          {state.message}
        </p>
      ) : null}
      {state.status === 'success' ? (
        <p role="status" className="form-ok">
          {state.message}
        </p>
      ) : null}

      {children(fieldErrors)}

      <div className="filters-actions">
        <SubmitButton label={submitLabel} pending={pending} />
      </div>
    </form>
  );
}

export function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <span className="field-error" role="alert">
      {errors[0]}
    </span>
  );
}
