import type { SiteCopy } from './types';

const CONTACT_EMAIL = 'nikiforialicht@gmail.com';

export const en: SiteCopy = {
  nav: {
    playersLink: 'For players',
    keepersLink: 'For keepers',
    ownersLink: 'For pitch owners',
    aboutLink: 'About',
    roadmapLink: 'Roadmap',
    privacyLink: 'Privacy',
    termsLink: 'Terms',
    switcherLabel: 'Language',
    navLabel: 'Main',
    footerRights: '© 2026 Ludi. Cyprus.',
  },

  home: {
    metaTitle: 'Ludi — Football pitches in Cyprus',
    metaDescription:
      'Book 5-, 7-, and 11-a-side football pitches in Cyprus. Pick a slot, pay, play.',
    eyebrow: 'Cyprus',
    heroTitle: 'Book football pitches in Cyprus',
    heroSubtitle:
      'Pick a slot, pay, play. No group chat, no cash at the gate, no double-booked Tuesday.',
    stats: [
      { value: '5·7·11', label: 'a-side' },
      { value: '90%', label: 'stays with the pitch' },
      { value: 'EN·ΕΛ', label: 'both languages' },
    ],
    playerFork: {
      eyebrow: 'For players',
      title: 'Playing',
      body: 'Discover 5-, 7-, and 11-a-side pitches across Cyprus, pick a slot, and pay in the app — no more chasing a WhatsApp group for a court.',
      cta: 'How it works',
    },
    ownerFork: {
      eyebrow: 'Pitch owners',
      title: 'Running a pitch',
      body: 'A free digital booking calendar for your pitch. Ludi brings the players; you keep 90% of every booking.',
      cta: 'See how it works',
    },
  },

  players: {
    metaTitle: 'For players — Ludi',
    metaDescription:
      'Every 5-, 7-, and 11-a-side pitch across Cyprus, with the slots that are actually free and what they actually cost. Book it, split it, play.',
    eyebrow: 'For players',
    heroTitle: 'Get on a pitch this week',
    heroSubtitle:
      "Ludi shows you every 5-, 7-, and 11-a-side pitch across Cyprus — with the slots that are actually free and what they actually cost. Book it, split it, play.",
    stats: [
      { value: '5·7·11', label: 'a-side, across Cyprus' },
      { value: '€0', label: 'to use Ludi — you pay the pitch, not us' },
      { value: 'EN·ΕΛ', label: 'both languages' },
    ],
    steps: [
      {
        title: 'Find a pitch near you',
        body: "Browse the pitches across Cyprus by size, surface, and time of day. You see the owner's own price and the slots that are genuinely still open — Ludi doesn't add anything on top; the pitch pays our commission, not you.",
      },
      {
        title: 'Book the slot and pay in the app',
        body: 'Pick a time and pay by card through Stripe. The slot is blocked the second the payment clears, so nobody can take the pitch out from under you — and there is nothing to settle at the gate.',
      },
      {
        title: 'Get the team there',
        body: 'Share one booking link instead of forty messages. Everyone sees the pitch, the kick-off time, and directions — and who has already said yes.',
      },
      {
        title: 'Turn up and play',
        body: "No phoning ahead to check, no cash at the gate. Your booking is already on the owner's calendar — and if plans change, the venue's own cancellation policy applies, shown before you pay and locked in at the time of booking.",
      },
    ],
    ctaTitle: "Ludi isn't open yet",
    ctaBody:
      "We're building the app and signing up the first pitches across Cyprus in person. Email us and you'll be among the first to get in.",
    ctaLabel: 'Email us',
    downloadLabel: 'Get the app',
    ctaNote: 'Across Cyprus — pitch by pitch.',
  },
  keepers: {
    metaTitle: 'Play in goal, play free — Ludi',
    metaDescription:
      'Games across Cyprus fall through every week because nobody wants to go in goal. If you do not mind the gloves, you play for free — the outfield players cover your share of the pitch.',
    eyebrow: 'For keepers',
    heroTitle: 'Play in goal. Play free.',
    heroSubtitle:
      'Every week across Cyprus a game falls apart because nobody wants to go in goal. If you do not mind the gloves, that is a game a week you get for nothing — the outfield players cover your share of the pitch.',
    notice:
      "Ludi isn't open yet. The keeper list is being put together by hand in Cyprus right now, which is exactly why it is worth being on it early.",
    stats: [
      { value: '€0', label: 'what a game in goal costs you' },
      { value: '5·7', label: 'a-side, across Cyprus' },
      { value: 'EN·ΕΛ', label: 'whichever you prefer' },
    ],
    steps: [
      {
        title: 'Tell us your nights',
        body: 'Four things below — your name, roughly where you are, how you rate yourself in goal, and which nights are realistic. It takes about a minute.',
      },
      {
        title: 'We message you when a team is short',
        body: 'When a game near you needs a keeper, the message goes to everyone on the list at once. First to say yes gets it. If it does not suit, you do not need to reply — nobody chases you.',
      },
      {
        title: 'You play for free',
        body: 'The outfield players cover the pitch between them. You turn up, you play, you pay nothing. On short notice or an awkward hour there is sometimes cash in it as well.',
      },
      {
        title: 'Turning up is the whole thing',
        body: 'We keep one honest record: who said yes, and who actually came. That is what makes a keeper worth calling first — and it is the only thing we track.',
      },
    ],
    formTitle: 'Get on the list',
    formBody:
      'Fill this in and it opens a message with your details ready to send. Nothing is stored on this website — there is no database behind this page, and no field here asks for your number. It arrives with your message, in the thread where the games actually get organised.',
    nameLabel: 'Your name',
    namePlaceholder: 'What the team should shout',
    areaLabel: 'Where in Cyprus',
    areaPlaceholder: 'Roughly — a district or a landmark',
    levelLabel: 'In goal, honestly',
    levels: [
      { value: 'Regular keeper', label: "It's my position — I keep goal" },
      { value: 'Good in there', label: "Not my position, but I'm good in there" },
      { value: 'Will go in goal', label: "I'll go in goal if it means a game" },
    ],
    nightsLabel: 'Nights that work',
    nightsHint: 'Pick any that are usually realistic. Nothing here is a commitment.',
    nights: [
      { value: 'Monday', label: 'Mon' },
      { value: 'Tuesday', label: 'Tue' },
      { value: 'Wednesday', label: 'Wed' },
      { value: 'Thursday', label: 'Thu' },
      { value: 'Friday', label: 'Fri' },
      { value: 'Saturday', label: 'Sat' },
      { value: 'Sunday', label: 'Sun' },
    ],
    noteLabel: 'Anything else',
    notePlaceholder: 'How far you will travel, nights that are impossible, whether you have your own gloves…',
    previewLabel: 'What gets sent',
    sendLabel: 'Send on WhatsApp',
    sendFallbackLabel: 'Send by email',
    sendHint: 'Opens your own app with the message ready. You press send.',
    nameRequiredHint: 'Add your name and the button turns on.',
    privacyNote: 'No account, no database, no phone field. You send the message yourself.',
    nudgeBody: 'Short a keeper — or happy to be one? Goalkeepers play for free.',
    nudgeLabel: 'Play in goal',
    messageIntro: 'Hi — I would like to go on the Ludi keeper list in Cyprus.',
    messageLabels: {
      name: 'Name',
      area: 'Area',
      level: 'In goal',
      nights: 'Nights',
      note: 'Note',
    },
  },

  owners: {
    metaTitle: 'For pitch owners — Ludi',
    metaDescription:
      'A free booking calendar for your football pitch. Ludi brings the players, handles payment, and pays you out weekly — you keep 90%.',
    eyebrow: 'For pitch owners',
    heroTitle: 'Fill your pitch, without the admin',
    heroSubtitle:
      'Ludi takes the bookings, the double-booking risk and the cash off your hands. You keep your prices, your hours, and 90% of every booking.',
    stats: [
      { value: '90%', label: 'of every booking is yours' },
      { value: '€0', label: 'setup, monthly, or unsold slots' },
      { value: 'Weekly', label: 'payouts via Stripe Connect' },
    ],
    steps: [
      {
        title: 'Your evenings stop belonging to the phone',
        body: 'Right now every booking is a message, a call, or someone turning up to ask. Ludi puts your pitch on a calendar players book themselves — you stop being the booking system.',
      },
      {
        title: 'Nobody can sell the same hour twice',
        body: "A slot is blocked the second it is paid for. No more finding out on Saturday that two teams think they have the 7pm, and no more being the one who has to tell one of them.",
      },
      {
        title: 'The money is there before the players are',
        body: 'Every booking is paid up front by card through Stripe. Nothing to collect at the gate, no chasing anyone afterwards, and no team that never turns up and never paid.',
      },
      {
        title: 'Your quiet hours get seen',
        body: 'The Tuesday nobody books is invisible today — it is only in your head and your notebook. On Ludi it is a slot players can find and fill.',
      },
      {
        title: 'What it costs',
        body: 'A 10% commission on the bookings Ludi brings you. Nothing upfront, nothing monthly, nothing at all on a slot that does not sell, and no app for you to install — we set your pitch up with you, in person.',
      },
    ],
    ctaTitle: 'Own a pitch in Cyprus?',
    ctaBody:
      "We'd rather come and see it than send you a link. Email us and we'll arrange a visit.",
    ctaLabel: 'Email us',
    ctaNote: "You'll be talking to the people who build Ludi, not a sales team.",
  },

  venue: {
    metaTitle: (name) => `${name} — Ludi`,
    metaDescription: (name, city) =>
      `${name} in ${city}: courts, prices and today's hours, and the Ludi app to book a game there.`,
    notFoundTitle: 'Venue not found — Ludi',
    courtsLabel: 'Courts',
    courtsOne: '1 court',
    courtsMany: (n) => `${n} courts`,
    pitchTypes: {
      '5-a-side': '5-a-side',
      '7-a-side': '7-a-side',
      '11-a-side': '11-a-side',
    },
    fromLabel: 'From',
    fromValue: (price) => `${price} an hour`,
    hoursLabel: 'Today',
    hoursValue: (open, close) => `${open}–${close}`,
    hoursClosed: 'Closed today',
    phoneLabel: 'Phone',
    bookableBody:
      'Book a court here in the Ludi app: pick a time, pay by card, and the slot is yours the moment the payment clears.',
    counterBody:
      'Bookings here are taken at the counter or by phone for now. The Ludi app shows the courts and the hours.',
    openInApp: 'Open in Ludi',
    getApp: 'Get the app',
    getNote: 'Already installed? "Open in Ludi" takes you straight to this venue.',
    islandTitle: 'On the map',
    islandBody: 'Every venue you can book through Ludi. A pin opens the venue.',
    mapAria: 'Map of Ludi venues in Cyprus',
    openTitle: 'Open games',
    openBody: 'Games here with a seat to fill. Tap one to see it, then join in the Ludi app.',
    openNone: 'No open games here right now. When an organiser opens a game at this venue, it shows here.',
    openWanted: (gk, outfield) =>
      `Wanted: ${[
        gk > 0 ? `${gk} ${gk === 1 ? 'keeper' : 'keepers'}` : null,
        outfield > 0 ? `${outfield} ${outfield === 1 ? 'player' : 'players'}` : null,
      ]
        .filter(Boolean)
        .join(' · ')}`,
    openSee: 'See the game',
  },

  fixture: {
    metaTitle: 'Match invite — Ludi',
    metaDescription: 'Someone is putting a match together on Ludi.',
    eyebrow: 'Match invite',
    joinTitle: "You're invited to a match.",
    whenLabel: 'When',
    whereLabel: 'Where',
    formatLabel: 'Format',
    pitchTypes: {
      '5-a-side': '5-a-side',
      '7-a-side': '7-a-side',
      '11-a-side': '11-a-side',
    },
    spotsOne: '1 spot open',
    spotsMany: '{n} spots open',
    keeperNeeded: 'A goalkeeper is still needed.',
    recordedNotice:
      'This game is recorded. Only the players on it can watch, for 30 days. Rather not be filmed? Ask the organiser to switch it off before kickoff.',
    installTitle: 'Playing? Get Ludi.',
    installBody: 'The roster lives in the app — see who is in, and take your slot.',
    downloadLabel: 'Get the app',
    contactLabel: "Ludi isn't public yet — ask us for an invite",
    contactSubject: 'Ludi — match invite',
    openInApp: 'Open in Ludi',
    tapAgain: 'Already installed? Tap your invite link again and it opens in the app.',
    fullTitle: 'This match is full.',
    fullBody: 'Every slot is taken. Get the app and be ready for the next one.',
    startedTitle: 'This match has already kicked off.',
    startedBody: 'The invite was for a kick-off that has passed.',
    offTitle: 'This match is off.',
    offBody: 'The organiser called it off. Ask them about the next one.',
    invalidTitle: "This invite link isn't valid.",
    invalidBody: 'It may have been replaced. Ask whoever sent it for a fresh one.',
    errorTitle: "Couldn't load this invite.",
    errorBody: 'Something went wrong on our side. Try again in a minute.',
  },

  get: {
    metaTitle: 'Get Ludi',
    metaDescription: 'Find people to play with, book a slot, and play — Ludi in Larnaca.',
    eyebrow: 'Scan · get ludi',
    title: "You're one tap from a game.",
    body: 'Find people to play with. Book your slot in seconds. Play.',
    iosNote:
      "Ludi is in Apple's TestFlight beta, not the App Store yet — the button below opens the free TestFlight app (install it first if this is your first Ludi invite), then Install for Ludi.",
    downloadLabel: 'Get the iOS beta',
    contactLabel: "Ludi isn't public yet — email us for an invite",
    contactSubject: 'Ludi — app download',
    androidTitle: 'On Android?',
    androidBody:
      "Ludi isn't on the Play Store yet. Leave your email and we'll send the install link the day it's ready — no group chat, no spam.",
    androidLabel: 'Notify me on Android',
    androidSubject: 'Ludi — notify me on Android',
    androidNote: 'One email, when it ships. Nothing else.',
  },

  inApp: {
    note: (app) =>
      `You're in ${app}'s own browser. If a button here doesn't open, tap ⋯ at the top and open this page in your browser.`,
    openInChrome: 'Open in Chrome',
  },

  about: {
    metaTitle: 'About — Ludi',
    metaDescription:
      'Ludi is built by one person in Larnaca, signing up pitches in person. How it works, how it makes money, and what it deliberately will not be.',
    eyebrow: 'About',
    heroTitle: 'One person, in Larnaca, walking into pitches',
    heroSubtitle:
      "Ludi is built by one person — me. I live here, I play here, and I'm signing up pitches by turning up at them in person rather than sending emails from somewhere else.",
    bylineName: 'Nikolas Neofytou',
    bylinePlace: 'Larnaca, Cyprus',
    sections: [
      {
        title: "Why I'm building it",
        body: 'Everyone I play with has tried the same things: a WhatsApp group that scrolls past the one message that mattered, a Facebook event nobody replies to, someone ringing a pitch at lunchtime to ask if Tuesday is free. The football is easy. The twenty messages before it are the problem.',
      },
      {
        title: 'How Ludi makes money',
        body: 'A 10% commission on bookings Ludi brings a pitch — from the first booking, not "later, once we\'re big". Players pay the pitch\'s own price, never a mark-up. No subscription, no fee for the owner, nothing when a slot does not sell.',
      },
      {
        title: 'Larnaca and Nicosia first',
        body: 'A handful of pitches people actually use beats a list covering the whole island where every slot is empty — so pitches are signed up in person, one city at a time, starting where we play. 5-a-side first, for the same reason — it is the game people play every week.',
      },
      {
        title: "What Ludi won't be",
        body: 'Not a social network — no feed, no followers, no stories. Not a coaching platform. Football only, not padel or tennis or basketball. Saying no to those is how a one-person project ships anything at all.',
      },
      {
        title: 'If something breaks, you get me',
        body: 'Support is WhatsApp and email, answered by the person who wrote the thing that broke. That stops scaling at some point. It has not yet.',
      },
    ],
    ctaTitle: 'Own a pitch in Cyprus?',
    ctaBody: "We'd rather come and see it than send you a link. Email us and we'll arrange a visit.",
    ctaLabel: 'Email us',
  },

  roadmap: {
    metaTitle: 'Features & roadmap — Ludi',
    metaDescription:
      'What Ludi will do and in what order: what is already built, what is in build now, and what comes after. Nothing is bookable yet.',
    eyebrow: 'Features & roadmap',
    heroTitle: 'What Ludi will do, and in what order',
    heroSubtitle: 'Where Ludi is today, and what comes next.',
    notice:
      "The order follows the build, not a calendar. We don't publish dates, because they'd be guesses — each stage ships when it meets its exit criteria.",
    builtLabel: 'Built',
    notBuiltLabel: 'Not built yet',
    stages: [
      {
        marker: 'Stage 1 · Foundation',
        state: 'built',
        title: 'The ground it stands on',
        body: "Not features you can use — the ground they stand on. This is the part that's finished.",
        items: [
          'The app runs — on iPhone, with Android in testing.',
          'Both languages from day one — every string written in English and Greek as it is built, not translated later.',
          'Database and access rules — schema, row-level security, and signup migrations in place before any feature touched them.',
          'Errors get reported — crash and error monitoring across app, admin and server before real users arrive.',
        ],
      },
      {
        marker: 'Built since',
        state: 'built',
        title: 'For owners and players',
        items: [
          'A web dashboard for owners, in Greek or English: the week on a calendar, a printable day sheet, and the bookings taken at the counter in the same place.',
          'Weekly bookings that repeat on their own — academies and regular teams.',
          "Each pitch's own page and QR code, opening the app at that pitch.",
          'Open games — turn a booking into a game other players can join.',
          'Pitches on a map, with directions.',
        ],
      },
      {
        marker: 'In build now',
        state: 'building',
        title: 'Book a pitch and pay for it',
        items: [
          'Browse pitches in Larnaca and Nicosia with real availability, and book a slot.',
          'Pay by card, Apple Pay or Google Pay — the slot cannot be double-booked.',
          'Confirmation email in your language, with a booking code.',
          "Cancellations follow the venue's own policy, shown before you pay.",
          'The first pitches live, in Larnaca and Nicosia, with owners onboarded in person.',
        ],
      },
      {
        marker: 'Next',
        state: 'planned',
        title: "Play when you don't have a full team",
        items: [
          'Everyone pays their own share; the game only confirms when it is covered.',
          'A waitlist that promotes people automatically when someone drops out.',
          'Skill level and teammate ratings, so the game is a fair one.',
          'Reminders before kick-off, and when a game is one player short.',
        ],
      },
      {
        marker: 'Later',
        state: 'later',
        title: 'Ideas, not plans',
        body: 'Recurring weekly games with the same crew, small tournaments and leagues, referrals, coaching slots. Deliberately undated — and some of it we will decide not to build. No chat, no social feed, and no sports other than football.',
        items: [],
      },
    ],
    ctaTitle: 'Want one of these sooner?',
    ctaBody: "The order isn't fixed. Tell us which one you'd actually use and it moves up.",
    ctaLabel: 'Email us',
  },

  signInLink: {
    metaTitle: 'Sign in — Ludi',
    eyebrow: 'Sign-in link',
    title: 'Open this link in the Ludi app.',
    body: 'This link signs you in to the Ludi app, on the phone you asked for it from. It opened in a browser instead, so nothing has happened yet.',
    steps: [
      'On that phone, open the email in your mail app and tap the link again.',
      'Or press and hold the link and choose “Open in Ludi”.',
      'Still opening here? Go back to Ludi and sign in with your phone number.',
    ],
    openInApp: 'Open in Ludi',
  },
  notFound: {
    code: 'Error 404',
    title: 'That one went wide',
    body: "This page doesn't exist — or it did, and it moved. Here's where most people are heading.",
    homeLabel: 'Home',
    playersLabel: 'For players',
    ownersLabel: 'I own a pitch',
  },

    privacy: {
    metaTitle: 'Privacy Policy — Ludi',
    backLabel: '← Ludi',
    bannerLabel: 'Draft — pending legal review.',
    bannerBody:
      'This page describes our current data-handling practices in good faith but has not yet been reviewed by counsel. It will be finalized before Ludi leaves TestFlight for a public release.',
    title: 'Privacy Policy',
    updated: '15 October 2026',
    sections: [
      {
        title: 'Who we are',
        paragraphs: [
          'Ludi is a football pitch booking marketplace operated in Cyprus by Nikolas Neofytou (sole trader). We are the data controller for the personal data described below.',
        ],
      },
      {
        title: 'What we collect',
        bullets: [
          'Name, and phone number or email address',
          'City, optional handle, skill level, playing positions, preferred foot',
          'Booking history — pitches, timestamps, totals',
          'Payment references (Stripe customer ID and PaymentIntent IDs). We never see or store your full card number — that is handled entirely by Stripe.',
          'IP address, retained by our infrastructure and payment providers for fraud analysis',
          'A push notification token for your phone, only if you allow notifications — so we can tell you about your own games and the asks you opted into',
          'The CFA grassroots teams you choose to follow, and whether you said you play too — so we can show you their matches and tell you when the programme is out, when a court or time changes, and an hour before kick-off. A team is a club in an age group, never a child: we hold no child\'s name, photo or details. Nobody sees which teams you follow — not the venue, not other players',
        ],
      },
      {
        title: 'Why we process it, and on what legal basis',
        bullets: [
          'Contract performance — creating your account, processing bookings and payments, and communicating with you about them. This is necessary to provide the service.',
          'Consent — marketing messages and product-usage analytics. You opt in explicitly and can withdraw consent at any time in the app; analytics stop collecting data on revocation.',
        ],
      },
      {
        title: 'Who else processes your data',
        paragraphs: [
          'We share data only with these processors, each bound by a data processing agreement, and we do not sell your data to anyone, ever:',
        ],
        bullets: [
          'Supabase — database, authentication, file storage (EU region)',
          'Stripe — payment processing and payouts to pitch owners',
          'Sentry — error monitoring (no personal data beyond an opaque user id)',
          'PostHog (EU) — product analytics, consent-gated, no personal data in event properties',
          'Resend — transactional email (booking confirmations)',
          'Expo (650 Industries, Inc.) — push notification delivery (United States)',
          'Vercel — hosting for this website and the venue dashboard (may process data in the United States)',
          'GitHub — storage for our encrypted database backups, kept for up to 90 days (United States)',
        ],
      },
      {
        title: 'Where your data lives',
        paragraphs: [
          'Our primary database and file storage run in the EU (Frankfurt), chosen for GDPR proximity. Some processors above operate their own EU regions independently.',
          'Where a processor handles data outside the European Economic Area — the venue dashboard\'s servers and our encrypted backups can be in the United States — the transfer is covered by the safeguards of Chapter V of the GDPR: an adequacy decision or the European Commission\'s standard data protection clauses.',
        ],
      },
      {
        title: 'If you booked a venue directly',
        paragraphs: [
          'Venues that use Ludi can record the bookings they take by phone or at the counter, and keep a list of their regular customers — a name and a phone number — in their Ludi dashboard. For those records the venue is the data controller and Ludi only stores them on the venue\'s behalf, under a written data processing agreement with the venue.',
          'We do not use that list for our own purposes: we do not contact you, market to you, match you to a Ludi account, or show your details to any other venue. When a venue leaves Ludi we delete its list within 30 days.',
          'If the venue asks, Ludi can show it which of its regulars usually play at an hour that is still free, so the venue can offer it to them itself. Any such message comes from the venue, not from Ludi, and tells you how to say you would rather not get them; tell the venue and it stops.',
          'If you send a venue a booking message — on WhatsApp, or one the venue copies into its dashboard — Ludi may keep it for up to 30 days so the venue can read it beside its calendar and answer you. Where the venue has connected its WhatsApp number to Ludi, those messages pass through Meta\'s WhatsApp Business Platform.',
          `To see, correct or delete what a venue holds about you, ask the venue — or email ${CONTACT_EMAIL} and we will pass your request on and help the venue answer it.`,
        ],
      },
      {
        title: 'How long we keep it',
        bullets: [
          'Profile data — until you request deletion, or after 3 years of inactivity',
          'Bookings, payments, and admin records — 7 years, per Cyprus tax record-keeping law',
          'Product analytics (PostHog) — 1 year',
          'Push notification token — until you sign out, turn notifications off on your phone, or the device stops receiving; deleted with your account',
          'The teams you follow — until you stop following them, which you can do at any time in the app; deleted with your account',
        ],
      },
      {
        title: 'Your rights',
        paragraphs: ['Under GDPR, you can:'],
        bullets: [
          'Access your data — view it in-app, or request a full export',
          'Correct it — edit your profile directly in the app',
          'Delete it — request anonymization; we retain only the financial records the law requires us to keep, with all directly identifying fields removed',
          'Export it in a portable format',
          'Object to or restrict certain processing — contact us below',
        ],
      },
      {
        title: 'Contact',
        paragraphs: [
          `For any privacy question or to exercise your rights, email ${CONTACT_EMAIL}. We aim to acknowledge requests within 72 hours.`,
        ],
      },
    ],
  },

  terms: {
    metaTitle: 'Terms of Service — Ludi',
    backLabel: '← Ludi',
    bannerLabel: 'Draft — pending legal review.',
    bannerBody:
      'This page describes our current terms in good faith but has not yet been reviewed by counsel. It will be finalized before Ludi leaves TestFlight for a public release.',
    title: 'Terms of Service',
    updated: '12 August 2026',
    sections: [
      {
        title: 'What Ludi is',
        paragraphs: [
          'Ludi is a marketplace app that lets you discover and book football pitches in Cyprus. By creating an account or making a booking, you agree to these terms.',
        ],
      },
      {
        title: 'Bookings and payment',
        bullets: [
          'Prices shown at booking time include the pitch fee and any addons you select.',
          'Payments are processed by Stripe. Pitch owners receive payouts via Stripe Connect; Ludi retains a platform commission on each booking.',
          "Each venue sets its own cancellation policy, shown before you pay and locked in at the time of booking — later policy changes at that venue don't apply retroactively to your booking.",
          'Bookings left unpaid for more than 15 minutes are automatically released.',
        ],
      },
      {
        title: 'Your responsibilities',
        bullets: [
          'Provide accurate account information.',
          "Show up for bookings you've paid for, or cancel per the venue's policy.",
          'Treat pitches, facilities, and other players with respect.',
        ],
      },
      {
        title: 'Physical activity',
        paragraphs: [
          'Football carries an inherent risk of injury. You play at your own risk. Ludi is a booking platform — we do not supervise matches, provide coaching, or guarantee the condition of any pitch beyond what the venue represents to us.',
        ],
      },
      {
        title: 'Liability',
        paragraphs: [
          'Ludi is provided "as is." To the extent permitted by Cyprus and EU law, we are not liable for indirect or consequential losses arising from your use of the app or a booking made through it.',
        ],
      },
      {
        title: 'Changes to these terms',
        paragraphs: [
          'We may update these terms as the product evolves. Material changes will be flagged in-app before they take effect.',
        ],
      },
      {
        title: 'Governing law',
        paragraphs: ['These terms are governed by the laws of Cyprus and applicable EU law.'],
      },
      {
        title: 'Contact',
        paragraphs: [`Questions about these terms: ${CONTACT_EMAIL}.`],
      },
    ],
  },
  member: {
    metaTitle: 'Ludi Member — founding members at Campeone',
    metaDescription:
      'A cup night every month, free matches you earn by playing, and first call on a keeper. €4.99 a month, cancel any time.',
    eyebrow: 'Founding members · Campeone',
    heroTitle: 'Ludi Member',
    heroSubtitle:
      'A cup night every month, free matches you earn by playing, and first call on a keeper when your game is short. €4.99 a month, and you can cancel whenever you like.',
    stats: [
      { value: '€4.99', label: 'a month, cancel any time' },
      { value: '1', label: 'member cup a month at Campeone' },
      { value: '4', label: 'free matches to earn every month' },
    ],
    perksTitle: 'What you get',
    perks: [
      {
        title: 'The member cup',
        body: 'One evening a month on two courts at Campeone, up to eight teams of five. Members play free and get first pick of the places. Any places left go to other Ludi players at the normal seat price.',
        when: 'Every month',
      },
      {
        title: 'A free match, earned',
        body: 'Win the cup and your team gets a free hour. The first three members each month to complete four off-peak games at Campeone through Ludi get one too. There is no draw and no luck in it: you earn it on the pitch.',
        when: 'Book it off-peak within 60 days',
      },
      {
        title: 'First call on a keeper',
        body: 'When your game is short a goalkeeper, we ask the whole keeper list for you straight away. We cannot promise a keeper is free, but members are asked for first.',
        when: 'From the day you join',
      },
    ],
    stepsTitle: 'How it works',
    steps: [
      {
        title: 'Join here',
        body: 'Pay €4.99 by card or Apple Pay. Your membership starts at once and renews every month on the same date.',
      },
      {
        title: 'Play the cup',
        body: "We tell you the date of each month's member cup. Enter your team, or ask us to put you in one.",
      },
      {
        title: 'Earn your free match',
        body: 'Win the cup, or be one of the first three to four off-peak games in a month. We tell you, and you book it at an off-peak hour within 60 days.',
      },
      {
        title: 'Leave whenever you like',
        body: 'Cancel from this page and you keep the perks until the end of the month you paid for. Within 14 days of joining you can withdraw and get back the unused part.',
      },
    ],
    notIncludedTitle: 'What it does not include',
    notIncluded: [
      "Your court bookings. You pay for those as always, at the venue's own price.",
      'Perks at venues other than Campeone, for now.',
    ],
    buyLabel: 'Become a founding member · €4.99 a month',
    buyNote: 'Payment by Stripe. You confirm that you want the membership to start straight away.',
    preSaleTitle: 'Founding membership opens at Campeone',
    preSaleBody:
      "Sign-up opens at Campeone's league night. Send us a message now and you are on the founding list. We message you the day it opens.",
    preSaleLabel: 'Put me on the founding list',
    preSaleMessage: 'Hi, please put me on the Ludi Member founding list.',
    manageLabel: 'Cancel or withdraw',
    manageFallback: `To cancel or withdraw, email ${CONTACT_EMAIL} with your name and the email you joined with.`,
    soldBy: (name) =>
      `Ludi Member is sold by ${name ? `${name}, who runs Ludi` : 'the business that runs Ludi'}. Court bookings are still sold by the venue.`,
    termsLink: 'Membership terms',
    cupTermsLink: 'Member cup and free match rules',
  },

  memberTerms: (seller) => ({
    metaTitle: 'Ludi Member terms — Ludi',
    backLabel: '← Ludi Member',
    bannerLabel: 'Draft.',
    bannerBody:
      'These terms describe the founding membership in good faith. They are checked before anyone is charged.',
    title: 'Ludi Member terms',
    updated: '15 October 2026',
    sections: [
      {
        title: 'Who sells it',
        paragraphs: [
          `The seller of Ludi Member is ${seller.name ?? 'the business that runs Ludi, named here before the first sale'}${
            seller.address ? `, ${seller.address}` : ''
          }${seller.number ? ` (number ${seller.number})` : ''}. Contact: ${seller.email}.`,
          'The seller sells the membership directly, in their own name. Court bookings made through Ludi are different: the venue sells them, and Ludi collects the payment on its behalf, as the Terms of Service describe.',
        ],
      },
      {
        title: 'Price and renewal',
        bullets: [
          '€4.99 a month, including any VAT due.',
          'You pay the first month when you join, and each following month on the same date, with the card you joined with. Payments are processed by Stripe.',
          'The membership renews every month until you cancel it.',
          'If the price changes, we tell you at least 30 days before your next payment, and you can cancel before the new price applies.',
        ],
      },
      {
        title: 'What is included',
        bullets: [
          'The member cup: one evening a month at Campeone, free entry for members, limited places, members register first. Its rules are on the Member cup and free match rules page.',
          'Free matches, earned under those rules: by the cup winners, and by the first three members each month to complete four off-peak games at Campeone through Ludi.',
          'First call on a keeper: when your game is short a goalkeeper, Ludi asks its whole keeper list for you straight away. We cannot promise that a keeper will be free.',
          'The perks run at Campeone, on court hours the venue gives Ludi. Court bookings are not included and are paid as usual.',
        ],
      },
      {
        title: 'Your right to withdraw',
        paragraphs: [
          'You can withdraw from the membership within 14 days of joining, without giving a reason.',
          'When you join, you ask us to start the membership straight away. If you then withdraw within the 14 days, we refund what you paid, less a share for the days that have already passed.',
          'To withdraw, use the Cancel or withdraw link on ludi.football/member, or email us with your name and the email you joined with. We refund within 14 days of your notice, to the card you paid with.',
        ],
      },
      {
        title: 'Cancelling',
        bullets: [
          'You can cancel at any time, from the same link.',
          'After the first 14 days, cancelling stops the next payment. You keep the perks until the end of the month you have paid for, and months already paid are not refunded.',
        ],
      },
      {
        title: 'If something changes',
        paragraphs: [
          "If a perk ends, for example because a venue's court hours for Ludi stop, we tell you, and you can cancel at once with a refund of the unused part of the month.",
        ],
      },
      {
        title: 'Your data',
        paragraphs: [
          'We keep your name, contact details and membership status to run the membership. Stripe processes your card. The Privacy Policy has the details.',
        ],
      },
      {
        title: 'Law and complaints',
        paragraphs: [
          `Cyprus law applies. Nothing in these terms limits your rights as a consumer. Questions or complaints: ${seller.email}.`,
        ],
      },
    ],
  }),

  cupTerms: (offpeak, sellerName) => ({
    metaTitle: 'Member cup and free match rules — Ludi',
    backLabel: '← Ludi Member',
    bannerLabel: 'Promotion.',
    bannerBody:
      'The member cup and the free matches are a promotion run by Ludi for its members. These are its full rules.',
    title: 'Member cup and free match rules',
    updated: '15 October 2026',
    sections: [
      {
        title: 'Organiser',
        paragraphs: [
          `${sellerName ? `${sellerName}, trading as Ludi,` : 'Ludi'} organises the member cup and awards the free matches. Campeone gives Ludi the court hours under an agreement between them, and does not run the promotion.`,
        ],
      },
      {
        title: 'When it runs',
        paragraphs: [
          "The promotion runs every month from the first member cup until we announce its end on this page, at least 30 days ahead. Each month's cup date is published on ludi.football/member and sent to members.",
        ],
      },
      {
        title: 'The member cup',
        bullets: [
          'One evening a month, on two courts for two hours, for up to eight teams of five players.',
          "Members enter free and can register first. Places still open after the members' registration period go to other Ludi players at the normal seat price.",
          'The format, with groups, knockout and match length, is published with the date.',
          'Everyone plays at their own risk, as in any game booked through Ludi.',
        ],
      },
      {
        title: 'How the free matches are won',
        bullets: [
          "The team that wins the member cup final wins one free match. It goes to the team's captain, who must be a member.",
          "Each month, the first three members to have four completed bookings at Campeone through Ludi, in the venue's off-peak hours, win one free match each. The booking's organiser counts, not the other players. The order is the time the fourth game finished, from Ludi's records.",
          'Winners are decided only by results on the pitch and by these counts. There is no draw and no element of chance.',
        ],
      },
      {
        title: 'The free match',
        bullets: [
          "One hour on a 5-a-side court at Campeone, in the venue's off-peak hours.",
          'Booked through Ludi within 60 days of winning. After that it lapses.',
          'It has no cash value, cannot be exchanged for money and cannot be given to another person.',
          'Court add-ons, such as bibs or a ball, are paid as usual.',
        ],
      },
      {
        title: 'Off-peak hours at Campeone',
        paragraphs: [offpeak ?? 'The off-peak hours are published here before the first member cup.'],
      },
      {
        title: 'Telling the winners',
        paragraphs: [
          "We tell winners in the app or by message within 7 days. A winning team's name goes on the venue's screen or on our social pages only if the team agrees.",
        ],
      },
      {
        title: 'Your data',
        paragraphs: [
          "We use members' booking records and cup results only to run this promotion. The Privacy Policy has the details.",
        ],
      },
      {
        title: 'Changes',
        paragraphs: [
          'We may change these rules for future months, with 30 days of notice on this page. A free match already won keeps the rules it was won under.',
        ],
      },
      {
        title: 'Contact',
        paragraphs: [`Questions: ${CONTACT_EMAIL}.`],
      },
    ],
  }),
};
