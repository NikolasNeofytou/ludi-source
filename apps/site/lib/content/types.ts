export type Locale = 'en' | 'el';

/** A figure in a hero stat rail — "5·7·11" over "a-side". */
export interface StatCopy {
  value: string;
  label: string;
}

/** One numbered step in a process list (owners, players). */
export interface StepCopy {
  title: string;
  body: string;
}

export interface NavCopy {
  playersLink: string;
  keepersLink: string;
  ownersLink: string;
  aboutLink: string;
  roadmapLink: string;
  privacyLink: string;
  termsLink: string;
  switcherLabel: string;
  navLabel: string;
  footerRights: string;
}

export interface ForkCopy {
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
}

export interface HomeCopy {
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  stats: StatCopy[];
  playerFork: ForkCopy;
  ownerFork: ForkCopy;
}

/**
 * Shared shape for the two audience pages. Both are a hero, a stat rail, a
 * numbered process, and a closing contact block — /owners as a sequence of
 * four claims turned into steps, /players as its counterpart.
 */
export interface ProcessPageCopy {
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  /** "Not open yet" strip. Every page says Ludi isn't open. */
  notice?: string;
  stats: StatCopy[];
  steps: StepCopy[];
  ctaTitle: string;
  ctaBody: string;
  ctaLabel: string;
  /** Trust line under the contact button. */
  ctaNote?: string;
  /** Shown instead of ctaLabel once site.APP_URL is set. */
  downloadLabel?: string;
}

export interface AboutCopy {
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  bylineName: string;
  bylinePlace: string;
  sections: StepCopy[];
  ctaTitle: string;
  ctaBody: string;
  ctaLabel: string;
}

export type StageState = 'built' | 'building' | 'planned' | 'later';

export interface RoadmapStageCopy {
  /** Mono marker — BUILT, IN BUILD, NEXT, LATER. */
  marker: string;
  state: StageState;
  title: string;
  body?: string;
  items: string[];
}

export interface RoadmapCopy {
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  notice: string;
  builtLabel: string;
  notBuiltLabel: string;
  stages: RoadmapStageCopy[];
  ctaTitle: string;
  ctaBody: string;
  ctaLabel: string;
}

/** One option in a keeper-signup choice group. `label` is the compact text on
 * the control ("Mon"); `value` is the fuller word that goes into the composed
 * message ("Monday"). Both are localised — the keeper reads the message they
 * are about to send, so it has to be in their own language. */
export interface ChoiceCopy {
  value: string;
  label: string;
}

/**
 * /keepers — goalkeeper recruitment.
 *
 * The one page on the site with a structured ask. It still has no backend:
 * the fields compose a message and hand it to WhatsApp (or email), so Ludi
 * stores nothing and no phone number is ever collected by the site — the
 * keeper's number arrives with their message, in the channel where dispatch
 * already happens. See docs/plans/goalkeeper-trial.md.
 */
export interface KeepersCopy {
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  /** The honest "this is early" strip. Every page says Ludi isn't open. */
  notice: string;
  stats: StatCopy[];
  /** What a keeper actually gets, as a numbered sequence. */
  steps: StepCopy[];
  formTitle: string;
  formBody: string;
  nameLabel: string;
  namePlaceholder: string;
  areaLabel: string;
  areaPlaceholder: string;
  levelLabel: string;
  levels: ChoiceCopy[];
  nightsLabel: string;
  nightsHint: string;
  nights: ChoiceCopy[];
  noteLabel: string;
  notePlaceholder: string;
  previewLabel: string;
  sendLabel: string;
  /** Used while `site.WHATSAPP_NUMBER` is null and the link falls back to mail. */
  sendFallbackLabel: string;
  sendHint: string;
  /** Shown in place of the hint until the one required field is filled. */
  nameRequiredHint: string;
  /** Sits under the button: what the site does and does not keep. */
  privacyNote: string;
  /** One-line nudge rendered on /players, pointing at this page. */
  nudgeBody: string;
  nudgeLabel: string;
  /** First line of the composed message. */
  messageIntro: string;
  /** Field prefixes inside the composed message. */
  messageLabels: {
    name: string;
    area: string;
    level: string;
    nights: string;
    note: string;
  };
}

/**
 * /f/<token> — the fixture invite landing (C1, docs/plans/invite-landing.md).
 *
 * Rendered for a stranger who tapped an invite link in a WhatsApp group and
 * does not have the app. The page is a preview and a funnel, never a surface:
 * it shows what `fixture_preview()` shows — when, where, format, what's open —
 * and never names (ADR-0012 minimisation, ADR-0025).
 */
export interface FixtureInviteCopy {
  /** Generic fallbacks — the real title/description are built per fixture. */
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  joinTitle: string;
  whenLabel: string;
  whereLabel: string;
  formatLabel: string;
  /** Display names for `pitches.type` — the app shows the raw EN string, the
   * site localises it. */
  pitchTypes: Record<'5-a-side' | '7-a-side' | '11-a-side', string>;
  spotsOne: string;
  /** `{n}` is replaced with the count. */
  spotsMany: string;
  /** Court cameras (ADR-0042): a joiner is told before he takes a spot. */
  recordedNotice: string;
  /** The wedge line — a fixture that is short a keeper says so. */
  keeperNeeded: string;
  installTitle: string;
  installBody: string;
  downloadLabel: string;
  /** AppCta fallback while `site.APP_URL` is null. */
  contactLabel: string;
  contactSubject: string;
  openInApp: string;
  /** The honest no-deferred-deep-linking line (ADR-0025): the token does not
   * survive the App Store round trip — tap the link again after installing. */
  tapAgain: string;
  fullTitle: string;
  fullBody: string;
  startedTitle: string;
  startedBody: string;
  offTitle: string;
  offBody: string;
  invalidTitle: string;
  invalidBody: string;
  errorTitle: string;
  errorBody: string;
}

/**
 * /get — the printed QR's landing page (launch plan, `next.config.mjs`).
 *
 * Every physical flyer and the wallet-pass QR encode this URL literally, so
 * it has to make sense to someone with zero context: what Ludi is, one tap
 * to the iOS beta (`site.APP_URL`, via `AppCta`), and something other than
 * silence for the Android visitor the flyer can't tell apart from an iOS one.
 */
export interface GetCopy {
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  title: string;
  body: string;
  /** Sets expectations for the TestFlight hop before the tap, not after. */
  iosNote: string;
  downloadLabel: string;
  /** AppCta fallback while `site.APP_URL` is null. */
  contactLabel: string;
  contactSubject: string;
  androidTitle: string;
  androidBody: string;
  androidLabel: string;
  androidSubject: string;
  androidNote: string;
}

/**
 * /auth/callback/<nonce> — a magic link that opened in a browser instead of
 * in the app (security audit 2026-10-19). The link only ever signs in the
 * app, on the phone that asked for it; this page says how to get it there
 * and never signs anyone in itself.
 */
export interface SignInLinkCopy {
  metaTitle: string;
  eyebrow: string;
  title: string;
  body: string;
  steps: string[];
  /** Only shown for a PKCE code, which is worthless off the asking phone. */
  openInApp: string;
}

export interface NotFoundCopy {
  code: string;
  title: string;
  body: string;
  homeLabel: string;
  playersLabel: string;
  ownersLabel: string;
}

export interface LegalSection {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalCopy {
  metaTitle: string;
  backLabel: string;
  bannerLabel: string;
  bannerBody: string;
  title: string;
  updated: string;
  sections: LegalSection[];
}

/** The venue's own page, `/v/<slug>` (plans/reach.md R1). */
export interface VenuePageCopy {
  metaTitle: (name: string) => string;
  metaDescription: (name: string, city: string) => string;
  notFoundTitle: string;
  courtsLabel: string;
  courtsOne: string;
  courtsMany: (n: number) => string;
  pitchTypes: Record<'5-a-side' | '7-a-side' | '11-a-side', string>;
  fromLabel: string;
  fromValue: (price: string) => string;
  hoursLabel: string;
  hoursValue: (open: string, close: string) => string;
  hoursClosed: string;
  phoneLabel: string;
  /** The app can take the booking (Stripe active, a live court). */
  bookableBody: string;
  /** The counter takes it for now. */
  counterBody: string;
  openInApp: string;
  getApp: string;
  getNote: string;
  /** The island map (plans/maps.md M3). */
  islandTitle: string;
  islandBody: string;
  mapAria: string;
  /** The venue's open games (plans/instagram.md IG-2, ADR-0056). */
  openTitle: string;
  openBody: string;
  openNone: string;
  /** "Wanted: 1 keeper · 2 players". */
  openWanted: (gk: number, outfield: number) => string;
  openSee: string;
}

/** Instagram's and Facebook's own browsers (plans/instagram.md IG-4). */
export interface InAppCopy {
  note: (app: 'Instagram' | 'Facebook') => string;
  openInChrome: string;
}

/** The membership seller's identity, required on a consumer sale (Law 112(I)/2021). */
export interface SellerDetails {
  name: string | null;
  number: string | null;
  address: string | null;
  email: string;
}

/** /member — Ludi Member, the founding membership (plans/ludi-member.md Phase 0). */
export interface MemberCopy {
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  stats: StatCopy[];
  perksTitle: string;
  perks: { title: string; body: string; when: string }[];
  stepsTitle: string;
  steps: StepCopy[];
  notIncludedTitle: string;
  notIncluded: string[];
  buyLabel: string;
  buyNote: string;
  preSaleTitle: string;
  preSaleBody: string;
  preSaleLabel: string;
  preSaleMessage: string;
  manageLabel: string;
  manageFallback: string;
  soldBy: (sellerName: string | null) => string;
  termsLink: string;
  cupTermsLink: string;
}

export interface SiteCopy {
  nav: NavCopy;
  home: HomeCopy;
  owners: ProcessPageCopy;
  players: ProcessPageCopy;
  keepers: KeepersCopy;
  fixture: FixtureInviteCopy;
  venue: VenuePageCopy;
  get: GetCopy;
  signInLink: SignInLinkCopy;
  inApp: InAppCopy;
  about: AboutCopy;
  roadmap: RoadmapCopy;
  notFound: NotFoundCopy;
  privacy: LegalCopy;
  terms: LegalCopy;
  member: MemberCopy;
  /** The membership's own terms; the seller's details are filled at render. */
  memberTerms: (seller: SellerDetails) => LegalCopy;
  /** The member cup and free-match promotion rules (memorandum clause 5.5). */
  cupTerms: (offpeak: string | null, sellerName: string | null) => LegalCopy;
}
