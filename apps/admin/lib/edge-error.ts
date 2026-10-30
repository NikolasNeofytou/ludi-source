// supabase-js wraps non-2xx into FunctionsHttpError with `context` set to the
// underlying Response. Surface the function's structured error message when
// available; fall back to the SDK's generic message otherwise. Every modal
// that calls an Edge Function uses this one — the refund modal's private
// copy read `body.error.message`, but `error` is the CODE string, so every
// refund failure showed the SDK's "non-2xx status code" instead.
export async function readEdgeError(err: unknown): Promise<string> {
  const fallback = err instanceof Error ? err.message : 'Action failed';
  const ctx = (err as { context?: unknown }).context;
  if (!(ctx instanceof Response)) return fallback;
  try {
    const body = (await ctx.json()) as { error?: string; message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}
