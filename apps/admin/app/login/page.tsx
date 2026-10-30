'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { LocaleSwitch } from '@/components/locale-switch';
import { useCopy } from '@/components/locale-provider';
import type { AdminCopy } from '@/lib/copy';
import { createClient } from '@/lib/supabase/client';

type Method = 'email' | 'phone';
type PhoneStep = 'phone' | 'otp';

/**
 * The venue's front door.
 *
 * `/` redirects straight to `/bookings`, so this is the only screen a
 * signed-out venue owner ever sees — it is the landing page whether or not it
 * was designed as one.
 *
 * The layout is a plate and a form: the plate states what the tool is for and
 * carries a live readout, the form asks the one question. Below 880px the
 * plate is dropped rather than stacked — a hero above the field would push it
 * under the fold — but its *voice* is not dropped with it: `.entry-compact`
 * restates the eyebrow and the live readout in two lines. The owner is on a
 * phone, so the small screen is the real screen, and it should not be the one
 * that says nothing about what this is.
 *
 * Voice note (ADR-0024): this surface speaks to a venue owner, not to Ludi
 * staff. Nothing here calls itself "admin" or asks for an "admin phone
 * number" — Ioannis runs a futsal club; he is not our administrator. The
 * word survives in route names and guards, where only we read it.
 *
 * **Email is the primary method (ADR-0024)** and phone OTP is retained
 * beneath it. The order is deliberate and it is not a preference about
 * channels: email works today, and phone cannot until Twilio Verify is live.
 * Offering the broken one first would be a worse product than offering one
 * method. When Verify lands, the toggle stays and only this comment changes.
 *
 * Motion follows cato's vocabulary (dev/domitor) and stays inside three
 * gestures: content rises once with a stagger, the status dot breathes to say
 * the system is live, and a rejected code shakes. See globals.css — the
 * reduced-motion guard there turns all three off, and restores opacity for
 * `.rise` so the screen cannot animate itself into invisibility.
 */

// GoTrue's messages are written for whoever wired the integration, not for
// the person holding the phone: "Signups not allowed for otp", "Token has
// expired or is invalid", "For security purposes, you can only request this
// after 46 seconds". Passing `error.message` straight through — which this
// screen did — hands the owner developer English and leaks how the auth is
// configured. Map the cases we can name; keep the raw text in the console so
// it is still debuggable.
function humanError(raw: string, t: AdminCopy['login']): string {
  const m = raw.toLowerCase();

  if (m.includes('expired') || m.includes('invalid') || m.includes('incorrect')) {
    return t.errCode;
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return t.errRateLimit;
  }
  if (m.includes('smtp') || m.includes('sending') || m.includes('mail')) {
    return t.errEmail;
  }
  if (m.includes('phone') || m.includes('sms')) {
    return t.errPhone;
  }
  return t.errGeneric;
}

// The answers only an address's existence decides (audit C2, 2026-10-19).
// With `shouldCreateUser: false`, an address Ludi never set up gets
// "Signups not allowed for otp", and only a real account can be inside the
// resend cooldown ("For security purposes, you can only request this after
// N seconds"). This screen used to say "no account" for the first, which let
// anyone type addresses in and learn which venues' owners have one. Both now
// land on the same "if there's an account, it's on its way" screen as a real
// send — true for the cooldown too, since the earlier link is still coming.
// Errors that do not depend on the address (the IP or project-wide rate
// limit, the network, SMTP) still show, in generic words.
//
// GoTrue's own reply to a direct API call still differs; this closes the
// form, which is where a person would try it.
function answersLikeSent(err: { message: string; code?: string }): boolean {
  const code = err.code ?? '';
  if (code === 'otp_disabled' || code === 'signup_disabled' || code === 'user_not_found') {
    return true;
  }
  const m = err.message.toLowerCase();
  return (
    m.includes('signups not allowed') ||
    m.includes('signup is disabled') ||
    m.includes('user not found') ||
    m.includes('security purposes')
  );
}

// Failures the /auth/callback route hands back. Kept as short codes rather
// than messages in the URL: an error string in a query parameter is a free
// billboard for anyone who can get someone to click a link.
function callbackError(code: string, t: AdminCopy['login']): string | null {
  if (code === 'device') return t.errDevice;
  if (code === 'link') return t.errLink;
  return null;
}

export default function LoginPage() {
  const router = useRouter();
  // The guest locale (cookie → browser): there is no account yet to ask.
  // The switch below writes the cookie, so a Greek owner on an English
  // phone gets Greek from the second load on.
  const t = useCopy().login;
  const [method, setMethod] = useState<Method>('email');
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('phone');
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Bumped on every failure so the error node remounts and the shake replays.
  // Without it, a second wrong code changes the text but plays no animation,
  // which reads as the form having ignored the submit.
  const [errorNonce, setErrorNonce] = useState(0);

  function fail(message: string) {
    setError(message);
    setErrorNonce((n) => n + 1);
  }

  // Read the callback's ?error= once on mount, then strip it from the URL so
  // a refresh does not re-accuse the user of a failure they already read.
  // Deliberately not `useSearchParams`: that forces a Suspense boundary on a
  // page whose whole job is to render one form immediately.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error');
    if (!code) return;
    const message = callbackError(code, t);
    if (message) fail(message);
    window.history.replaceState(null, '', window.location.pathname);
    // Read once on mount; the language of a message already shown is
    // whatever it was when it was shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchTo(next: Method) {
    setMethod(next);
    setError(null);
    setEmailSent(false);
    setPhoneStep('phone');
    setOtp('');
  }

  async function sendMagicLink(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        // Access is granted, not requested (ADR-0019). This surface must
        // never mint an account, and saying so here means it holds even
        // while the project-level signup toggle is still open.
        shouldCreateUser: false,
      },
    });
    setLoading(false);
    if (sendError && !answersLikeSent(sendError)) {
      console.error('signInWithOtp(email) failed:', sendError.message);
      fail(humanError(sendError.message, t));
      return;
    }
    setEmailSent(true);
  }

  async function sendOtp(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: sendError } = await supabase.auth.signInWithOtp({
      phone,
      options: { shouldCreateUser: false },
    });
    setLoading(false);
    if (sendError && !answersLikeSent(sendError)) {
      console.error('signInWithOtp(phone) failed:', sendError.message);
      fail(humanError(sendError.message, t));
      return;
    }
    setPhoneStep('otp');
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone,
      token: otp,
      type: 'sms',
    });
    setLoading(false);
    if (verifyError) {
      console.error('verifyOtp failed:', verifyError.message);
      fail(humanError(verifyError.message, t));
      return;
    }
    router.push('/');
    router.refresh();
  }

  const stepLabel =
    method === 'email'
      ? emailSent
        ? t.step2Email
        : t.step1Email
      : phoneStep === 'phone'
        ? t.step1Phone
        : t.step2Phone;

  const lede =
    method === 'email'
      ? emailSent
        ? t.ledeEmailSent(email)
        : t.ledeEmail
      : phoneStep === 'phone'
        ? t.ledePhone
        : t.ledeOtp(phone);

  const onSubmit =
    method === 'email' ? sendMagicLink : phoneStep === 'phone' ? sendOtp : verifyOtp;

  return (
    <main className="entry">
      <aside className="entry-plate" aria-hidden="true">
        <div>
          <p className="entry-eyebrow rise" style={{ '--i': 0 } as React.CSSProperties}>
            {t.eyebrow}
          </p>
          <h2 className="entry-title rise" style={{ '--i': 1 } as React.CSSProperties}>
            {t.plateTitle}
          </h2>
          <p className="entry-lede rise" style={{ '--i': 2 } as React.CSSProperties}>
            {t.plateLede}
          </p>
        </div>

        <div className="entry-readout rise" style={{ '--i': 3 } as React.CSSProperties}>
          <hr className="entry-rule" />
          <div className="entry-readout-row">
            <span className="entry-dot breathe" />
            <span>{t.secure}</span>
          </div>
          <div className="entry-readout-row">
            {/* Cyprus, not Larnaca — the same drift `apps/site` corrected in
                PR #117. Camares and Piacere are both Larnaca today; the
                product is not. */}
            <span>{t.country}</span>
          </div>
        </div>
      </aside>

      <div className="entry-form-side">
        {/* The plate's voice, restated for the phone. Hidden at ≥880px where
            the plate itself carries it — `display: none` keeps it out of the
            accessibility tree too, so exactly one copy is ever announced. */}
        <div className="entry-compact">
          <p className="entry-eyebrow">{t.eyebrow}</p>
          <div className="entry-compact-readout">
            <span className="entry-dot breathe" aria-hidden="true" />
            <span>{t.secure}</span>
          </div>
        </div>

        <form onSubmit={onSubmit} className="entry-form">
          <div className="entry-step-row rise" style={{ '--i': 0 } as React.CSSProperties}>
            <p className="entry-step">{stepLabel}</p>
            <LocaleSwitch />
          </div>

          <header className="rise" style={{ '--i': 1 } as React.CSSProperties}>
            <h1 style={{ fontSize: 26, margin: 0 }}>{t.title}</h1>
            <p style={{ margin: '6px 0 0', color: 'var(--ludi-ink2)', fontSize: 14 }}>
              {lede}
            </p>
          </header>

          <div className="rise" style={{ '--i': 2 } as React.CSSProperties}>
            {method === 'email' && !emailSent ? (
              <label className="field">
                <span className="field-label">{t.email}</span>
                <input
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  placeholder={t.emailPlaceholder}
                  value={email}
                  onChange={(event) => setEmail(event.target.value.trim())}
                  className="input"
                />
              </label>
            ) : null}

            {method === 'phone' && phoneStep === 'phone' ? (
              <label className="field">
                <span className="field-label">{t.phone}</span>
                <input
                  type="tel"
                  required
                  autoFocus
                  autoComplete="tel"
                  placeholder={t.phonePlaceholder}
                  value={phone}
                  // Strip every space and dash rather than only trimming the
                  // ends: people write numbers the way the hint shows them,
                  // and an interior space is a cryptic provider rejection.
                  // The hint promises this works, so it has to.
                  onChange={(event) =>
                    setPhone(event.target.value.replace(/[\s-]/g, ''))
                  }
                  className="input"
                />
                <span className="field-hint">{t.phoneHint}</span>
              </label>
            ) : null}

            {method === 'phone' && phoneStep === 'otp' ? (
              <label className="field">
                <span className="field-label">{t.otp}</span>
                <input
                  type="text"
                  required
                  autoFocus
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  placeholder="123456"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(event) =>
                    setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  className="input otp-input"
                />
              </label>
            ) : null}
          </div>

          {error ? (
            <p key={errorNonce} role="alert" className="auth-error shake">
              {error}
            </p>
          ) : null}

          <div
            className="rise"
            style={{ '--i': 3, display: 'flex', flexDirection: 'column', gap: 12 } as React.CSSProperties}
          >
            {/* The sent state has no field to submit, so the primary action
                becomes "I didn't get it" rather than a dead button. */}
            {method === 'email' && emailSent ? (
              <button
                type="submit"
                disabled={loading}
                className="btn btn-secondary btn-block"
              >
                {loading ? t.sending : t.sendAnother}
              </button>
            ) : (
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary btn-block"
              >
                {loading
                  ? t.working
                  : method === 'email'
                    ? t.emailMe
                    : phoneStep === 'phone'
                      ? t.sendCode
                      : t.verify}
              </button>
            )}

            {method === 'email' ? (
              <button
                type="button"
                onClick={() => switchTo('phone')}
                className="btn btn-secondary btn-block"
              >
                {emailSent ? t.differentAddress : t.usePhone}
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  phoneStep === 'otp' ? setPhoneStep('phone') : switchTo('email')
                }
                className="btn btn-secondary btn-block"
              >
                {phoneStep === 'otp' ? t.differentNumber : t.emailInstead}
              </button>
            )}
          </div>
        </form>
      </div>
    </main>
  );
}
