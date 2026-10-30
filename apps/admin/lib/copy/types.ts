// Every string a venue owner or manager can read in this app, as one typed
// interface (plans/owner-greek.md, ADR-0037). `en` and `el` each implement
// it, so a key added to one and not the other fails `tsc` — that is the
// parity check CONVENTIONS § i18n promised, for this app.
//
// Grouped per surface, in the order an owner meets them. Count-bearing
// strings are functions: Greek plurals are not an `s`. Strings that wrap a
// link or a code are split around it (`before` / `after`) rather than
// carrying markup — a dictionary entry is text.
//
// The founder's admin-only pages (enrolment, venues, revenue, invites,
// refunds, verify) are NOT here; they stay English on purpose.

// The column's vocabulary (`users.preferred_locale`), not BCP-47 — see
// htmlLang() in ./index.ts for the `<html lang>` mapping.
export type Locale = 'en' | 'gr';

export type Count = (n: number) => string;

export type BookingStateKey =
  | 'pending'
  | 'collecting'
  | 'paid'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'refunded'
  | 'refunded_by_admin'
  | 'cancelled_no_refund';

export interface AdminCopy {
  meta: { title: string; description: string };

  shell: {
    nav: {
      today: string;
      bookings: string;
      calendar: string;
      earnings: string;
      pitches: string;
      access: string;
      contacts: string;
      requests: string;
      venues: string;
      revenue: string;
    };
    sections: string;
    allVenues: string;
    venuesCount: Count;
    signOut: string;
    signingOut: string;
    language: string;
  };

  common: {
    filter: string;
    reset: string;
    all: string;
    save: string;
    saving: string;
    cancel: string;
    close: string;
    done: string;
    remove: string;
    removing: string;
    open: string;
    edit: string;
    hours: string;
    keep: string;
    prev: string;
    next: string;
    pagination: string;
    pageOf: (page: number, total: number) => string;
    select: string;
    dash: string;
    booked: string;
    walkIn: string;
    // Slice E — who put a walk-in on the book, and who took it off.
    byYou: string;
    byLudi: string;
    byColleague: string;
    takenBy: (who: string) => string;
    cancelledBy: (who: string) => string;
    inReview: string;
    totalCount: Count;
    minutes: Count;
    hoursShort: (h: number) => string;
    hoursLong: Count;
    midnight: string;
    printPdf: string;
    perHour: string;
  };

  states: Record<BookingStateKey, string>;

  // Sunday first, matching pitch_schedules.day_of_week.
  days: { long: readonly string[]; short: readonly string[] };

  pitch: {
    types: Record<'5-a-side' | '7-a-side' | '11-a-side', string>;
    surfaces: Record<'turf' | 'grass' | 'indoor', string>;
    verified: string;
    unverified: string;
    active: string;
    inactive: string;
    madeOf: (list: string) => string;
  };

  addons: { bibs: string; ball: string };

  today: {
    title: string;
    allBookings: string;
    standing: string;
    statBookings: string;
    statHours: string;
    statValue: string;
    statNext: string;
    empty: string;
    thTime: string;
    thVenue: string;
    thPitch: string;
    thPlayer: string;
    thState: string;
    thTotal: string;
    weekAhead: string;
    thDay: string;
    thBookings: string;
    thHours: string;
    thValue: string;
    // Slice F — the shift's view of the day.
    nowNext: string;
    nowNextEmpty: string;
    onNow: string;
    startsIn: (minutes: number) => string;
    endsAt: (time: string) => string;
    collect: (amount: string) => string;
    prepaid: string;
    paidInApp: string;
    collecting: string;
  };

  checklist: {
    setUp: (venue: string) => string;
    fillIn: string;
    liveLeft: Count;
    gateLeft: Count;
    done: string;
    todo: string;
    open: string;
    newCourtBefore: string;
    newCourtAfter: string;
    venueDetails: string;
    venueDetailsHint: string;
    check: string;
    addCourts: string;
    addCourtsHint: string;
    addACourt: string;
    weeklyHours: string;
    weeklyHoursHint: string;
    openCourts: string;
    payment: string;
    ownerDoes: string;
    payActiveHint: string;
    payRestrictedHint: string;
    sendStripeDetails: string;
    payDisabledBefore: string;
    payDisabledAfter: string;
    payPendingHint: string;
    payPendingReviewHint: string;
    review: string;
    reviewHint: string;
  };

  bookings: {
    title: string;
    code: string;
    codePlaceholder: string;
    state: string;
    startsFrom: string;
    startsTo: string;
    venue: string;
    emptyFiltered: string;
    empty: string;
    thCode: string;
    thState: string;
    thStarts: string;
    thPitchVenue: string;
    thPlayer: string;
    thTotal: string;
    thCreated: string;
    thActions: string;
    needHelp: string;
  };

  calendar: {
    title: string;
    standing: string;
    view: string;
    week: string;
    day: string;
    previous: string;
    today: string;
    next: string;
    thisWeek: string;
    venue: string;
    show: string;
    noVenue: string;
    noCourtsAt: (venue: string) => string;
    addThem: string;
    closedOn: (day: string) => string;
    setHours: string;
    court: string;
    printedOn: (date: string) => string;
    hintDay: string;
    hintWeek: string;
    part: string;
    allDay: string;
    afternoonUntil: (time: string) => string;
    eveningFrom: (time: string) => string;
    continued: string;
    weekly: string;
    appBooking: string;
    repeatsWeekly: string;
    comment: string;
    commentPlaceholder: string;
    commentPrivate: string;
    saveComment: string;
    removeComment: string;
    commentSaved: string;
    commentRemoved: string;
    commentFailed: string;
    skipWeek: string;
    skipWeekHint: string;
    stopRepeating: string;
    stopConfirm: (when: string) => string;
    stopYes: string;
    allStanding: string;
    openInBookings: string;
    cfaMatch: string;
    cfaPostponed: string;
    cfaMove: string;
    cfaMoveSave: string;
    cfaCourt: string;
    cfaTime: string;
    cfaPostpone: string;
    cfaPutBack: string;
    cfaCancel: string;
    cfaCancelConfirm: string;
    cfaTold: string;
    cfaTaken: string;
    cfaFailed: string;
    cfa: string;
    screen: string;
  };

  cfa: {
    title: string;
    programme: string;
    intro: string;
    file: string;
    venueInFile: string;
    allVenues: string;
    date: string;
    round: string;
    roundWord: string;
    roundPlaceholder: string;
    defaultRound: string;
    minutes: string;
    price: string;
    alreadyLoaded: (n: number) => string;
    noRowsInFile: string;
    unreadable: string;
    colTime: string;
    colCategory: string;
    colHome: string;
    colAway: string;
    colFormat: string;
    colCourt: string;
    include: string;
    notFutsal: string;
    noCourt: string;
    skipReason: (reason: string) => string;
    addMatch: string;
    propose: string;
    put: (n: number) => string;
    done: (r: { placed: number; moved: number; unchanged: number; cancelled: number; away: number; released: number }) => string;
    awayHint: (n: number) => string;
    skippedCount: (n: number) => string;
    courtsHint: (pairs: string) => string;
    notYours: string;
    failed: string;
    nothingToLoad: string;
    noMatches: string;
    loadRound: string;
  };

  screen: {
    title: string;
    intro: string;
    open: string;
    copy: string;
    copied: string;
    tipTv: string;
    tipPhone: string;
    tipPrivacy: string;
    rotate: string;
    rotateHint: string;
    qrAlt: string;
    qrHint: string;
  };

  earnings: {
    title: string;
    last7: string;
    last30: string;
    last90: string;
    timeRange: string;
    ariaStats: string;
    ariaBreakdown: string;
    paidThroughLudi: string;
    takenAtVenue: string;
    venuesTotal: string;
    totalEarnings: string;
    bookings: string;
    playersPaid: string;
    refunded: string;
    ludiFee: string;
    empty: string;
    keptVenues: string;
    keptYours: string;
    thVenue: string;
    thPaidInApp: string;
    thRefunded: string;
    thFee: string;
    thThrough: string;
    thAtVenue: string;
    thTotal: string;
    thBookings: string;
    payouts: string;
    noPayouts: string;
    thArrives: string;
    thAmount: string;
    thStatus: string;
    statusPaid: string;
    statusFailed: string;
    ownerManages: string;
    openInStripe: (venue: string) => string;
    disabledBefore: string;
    disabledAfter: string;
    finishSetupFor: (venue: string) => string;
    finishSetup: string;
    footnote: (o: { tz: string; admin: boolean }) => string;
    chart: {
      empty: string;
      net: string;
      netHint: string;
      keptSuffix: string;
      ariaEarnings: string;
      ariaRevenue: string;
      dailyFigures: string;
      thDay: string;
      thPaid: string;
      thRefunded: string;
      thFee: string;
    };
  };

  // Slice B of plans/owner-contacts.md — the owner's page onto his regulars.
  contacts: {
    title: string;
    count: Count;
    intro: string;
    searchPlaceholder: string;
    search: string;
    clear: string;
    empty: string;
    noMatch: string;
    capped: (shown: number, total: number) => string;
    venue: string;
    th: { name: string; phone: string; from: string };
    source: { counter: string; manual: string; backfill: string; csv: string; google: string };
    add: {
      title: string;
      name: string;
      phone: string;
      note: string;
      notePlaceholder: string;
      submit: string;
    };
    edit: string;
    save: string;
    cancel: string;
    delete: string;
    deleting: string;
    confirmDelete: (who: string) => string;
    added: string;
    saved: string;
    deleted: string;
    duplicate: string;
    exportCsv: string;
    exportHint: string;
    dangerTitle: string;
    deleteAllHint: string;
    deleteAll: Count;
    deleteAllConfirm: Count;
    deletedAll: Count;
    ownerOnly: string;
  };

  desk: {
    title: string;
    intro: string;
    pasteTitle: string;
    pasteHint: string;
    pasteName: string;
    pastePhone: string;
    pasteBody: string;
    pasteSubmit: string;
    pasted: string;
    connected: (phone: string) => string;
    notConnected: string;
    waiting: Count;
    empty: string;
    recentTitle: string;
    viaWhatsapp: string;
    viaPaste: string;
    readsAs: string;
    noProposal: string;
    partial: string;
    free: string;
    taken: string;
    otherCourt: (court: string) => string;
    noneFree: string;
    alternatives: (times: string) => string;
    minutes: (n: number) => string;
    book: string;
    decline: string;
    dismiss: string;
    undo: string;
    statusBooked: (code: string) => string;
    statusDeclined: string;
    statusDismissed: string;
    replyTitle: string;
    replySend: string;
    replyWa: string;
    replyCopy: string;
    replyCopied: string;
    replySent: string;
    replyWindow: string;
    replyFailed: string;
    replyNoPhone: string;
    confirmTemplate: string;
    declineTemplate: string;
    altPhrase: (times: string) => string;
    todayLine: Count;
    errors: { notYours: string; empty: string; generic: string };
  };

  fill: {
    title: string;
    intro: string;
    offerLink: string;
    slot: (court: string, when: string) => string;
    usualPrice: (price: string) => string;
    priceLabel: string;
    priceHint: string;
    start: string;
    starting: string;
    notOwner: string;
    notEnabled: string;
    gone: string;
    errors: Record<'FILL_SLOT_TAKEN' | 'FILL_COURT_CLOSED' | 'FILL_BAD_WINDOW' | 'FILL_BAD_PRICE' | 'FILL_NOT_ENABLED' | 'generic', string>;
    messageLabel: string;
    messageHint: string;
    template: string;
    priceDeal: (offer: string, usual: string) => string;
    priceUsual: (usual: string) => string;
    whenPhrase: (weekday: string, date: string, time: string) => string;
    listTitle: string;
    listEmpty: string;
    sameEvening: Count;
    plays: Count;
    lastPlayed: (date: string) => string;
    neverPlayed: string;
    send: string;
    sent: string;
    sendAgain: string;
    optOut: string;
    optedOutTitle: string;
    optedOutHint: string;
    allowAgain: string;
    statusOpen: (asked: number) => string;
    statusFilledAsked: (code: string) => string;
    statusFilledOther: (code: string) => string;
    backToCalendar: string;
  };

  access: {
    title: string;
    people: Count;
    intro: string;
    empty: string;
    addSomeone: string;
    who: string;
    contact: string;
    role: string;
    status: string;
    since: string;
    noName: string;
    you: string;
    thisAccount: string;
    roleOwner: string;
    roleManager: string;
    signedIn: string;
    invitePending: string;
    remove: string;
    removing: string;
    confirmRemove: (who: string) => string;
    confirmSelf: string;
    removed: string;
    ownerOnly: string;
    lastOwner: string;
    alreadyGone: string;
    malformed: string;
    invite: {
      title: string;
      lead: string;
      email: string;
      emailHint: string;
      firstName: string;
      lastName: string;
      optional: string;
      language: string;
      languageHint: string;
      submit: string;
      submitting: string;
      sent: (email: string) => string;
      granted: (email: string) => string;
      alreadyGranted: string;
      capReached: string;
      notYours: string;
      duplicateAnyway: string;
      failed: string;
    };
  };

  standing: {
    title: string;
    live: Count;
    calendar: string;
    intro: string;
    newSeries: string;
    empty: string;
    noCourts: string;
    forDuration: string;
    from: (date: string) => string;
    until: (date: string) => string;
    openEnded: string;
    ahead: Count;
    skipped: Count;
    andMore: Count;
    ended: string;
    form: {
      venue: string;
      who: string;
      whoPlaceholder: string;
      whoHint: string;
      phone: string;
      phonePlaceholder: string;
      courts: string;
      noCourtsHere: string;
      days: string;
      kickOff: string;
      duration: string;
      from: string;
      until: string;
      untilHint: string;
      submit: string;
      footer: string;
      end: string;
      lastDayFor: (name: string) => string;
    };
  };

  pitches: {
    title: string;
    newPitch: string;
    courtAdded: string;
    courtAddedBody: (name: string) => string;
    setHoursLink: string;
    name: string;
    namePlaceholder: string;
    status: string;
    statusAll: string;
    statusVerified: string;
    statusUnverified: string;
    statusInactive: string;
    venue: string;
    emptyFiltered: string;
    empty: string;
    thPitch: string;
    thVenue: string;
    thTypeSurface: string;
    thPrice: string;
    thStatus: string;
    thActions: string;
    stripeStatus: (status: string) => string;
    noHoursYet: string;
    /** Court cameras (ADR-0042): the court's camera, as the recorder last reported. */
    camera: (health: 'online' | 'offline' | 'never') => string;
    newTitle: string;
    needVenueFirst: string;
    newIntroBefore: string;
    newIntroEm: string;
    newIntroAfter: string;
    create: string;
    editTitle: string;
    editIntro: string;
    save: string;
    form: {
      venue: string;
      name: string;
      namePlaceholder: string;
      type: string;
      surface: string;
      price: string;
      amenities: string;
      amenitiesPlaceholder: string;
      amenitiesHint: string;
      madeOf: string;
      noLeaves: string;
      madeOfHint: string;
    };
  };

  venue: {
    editTitle: string;
    ownerIntro: string;
    payoutsActive: string;
    payoutsFromChecklistBefore: string;
    payoutsFromChecklistLink: string;
    payoutsFromChecklistAfter: string;
    payoutsByOwner: string;
    save: string;
    form: {
      name: string;
      address: string;
      phone: string;
      phonePlaceholder: string;
      email: string;
      whereItIs: string;
      loadingMap: string;
      commercial: string;
      city: string;
      commission: (pct: string) => string;
      commissionHint: string;
      cancellationPolicy: string;
      active: string;
      activeYes: string;
      activeNo: string;
      activeHint: string;
      slug: string;
      slugHint: string;
    };
    map: {
      useLocation: string;
      locating: string;
      searchPlaceholder: string;
      search: string;
      searching: string;
      noMatch: string;
      unavailable: string;
      noGeolocation: string;
      locationDenied: string;
      unnamed: string;
      movePin: string;
      hint: string;
      latitude: string;
      longitude: string;
    };
  };

  schedule: {
    title: string;
    backToPitches: string;
    intro: string;
    exceptions: string;
    opensAt: string;
    closesAt: string;
    slotLength: string;
    midnightHint: string;
    confirmRemove: (day: string, range: string) => string;
    addAnother: string;
    anotherWindow: string;
    openThisDay: string;
    addWindow: string;
    closed: string;
    regularHours: (day: string, list: string) => string;
    normallyClosed: (day: string) => string;
    alreadyException: (list: string) => string;
    closedAllDay: string;
    addException: string;
    date: string;
    onThisDate: string;
    specialHours: string;
    specialHint: string;
    reason: string;
    reasonPlaceholder: string;
    submitException: string;
    confirmRemoveException: (date: string, what: string) => string;
    upcoming: string;
    none: string;
  };

  walkIn: {
    button: string;
    title: string;
    subtitle: string;
    bookedBefore: string;
    bookedFor: string;
    pitch: string;
    date: string;
    kickOff: string;
    length: string;
    inPast: string;
    customerName: string;
    namePlaceholder: string;
    // Slice C of plans/owner-contacts.md — the name field as a typeahead.
    picker: {
      searchPlaceholder: string;
      regulars: string;
      fromRegulars: string;
      someoneElse: string;
    };
    phone: string;
    phonePlaceholder: string;
    price: string;
    bibs: string;
    balls: string;
    priceRange: string;
    totalBefore: string;
    totalAfter: string;
    listPrice: (amount: string) => string;
    booking: string;
    book: (total: string) => string;
    failed: string;
    cancel: string;
    removeBefore: string;
    removeAfter: string;
    yesRemove: string;
    cancelFailed: string;
    repeat: string;
    repeatWho: string;
    repeatDays: string;
    repeatCourts: string;
    repeatUntil: string;
    repeatHint: string;
    repeatBook: string;
  };

  stripe: {
    opening: string;
    continueSetup: string;
    setUp: string;
    noResponse: string;
    stillStuck: string;
    openDashboard: string;
  };

  login: {
    eyebrow: string;
    plateTitle: string;
    plateLede: string;
    secure: string;
    country: string;
    title: string;
    step1Email: string;
    step2Email: string;
    step1Phone: string;
    step2Phone: string;
    ledeEmailSent: (email: string) => string;
    ledeEmail: string;
    ledePhone: string;
    ledeOtp: (phone: string) => string;
    email: string;
    emailPlaceholder: string;
    phone: string;
    phonePlaceholder: string;
    phoneHint: string;
    otp: string;
    sending: string;
    sendAnother: string;
    working: string;
    emailMe: string;
    sendCode: string;
    verify: string;
    differentAddress: string;
    usePhone: string;
    differentNumber: string;
    emailInstead: string;
    errCode: string;
    errRateLimit: string;
    errEmail: string;
    errPhone: string;
    errGeneric: string;
    errDevice: string;
    errLink: string;
  };

  locked: {
    teamTitle: string;
    teamBody: string;
    backToBookings: string;
    noAccessTitle: string;
    signedInAs: string;
    noAccessBody: string;
    addYou: string;
  };

  callback: { title: string; body: string };

  errorPage: {
    title: string;
    body: string;
    withCode: string;
    tryAgain: string;
    goToday: string;
  };

  notFound: { title: string; body: string; goToday: string };

  // What the server says back. Read with getCopy(viewer.locale) inside the
  // actions, never composed in English and translated after.
  // The venue's own link (plans/reach.md R1).
  link: {
    title: string;
    body: (venue: string) => string;
    copy: string;
    copied: string;
    hint: string;
    qrAlt: (venue: string) => string;
  };
  actions: {
    checkFields: string;
    alreadyExists: string;
    outOfRange: string;
    notYours: string;
    saveFailed: string;
    notSavedVenue: string;
    notSavedPitch: string;
    venueNotYours: string;
    pitchNotYours: string;
    venueSaved: string;
    pitchSaved: string;
    onlyOwnVenue: string;
    pickCourtsFromList: string;
    schedule: {
      overlapWindow: string;
      overlapException: string;
      timesOutside: string;
      wouldStrand: string;
      windowAdded: string;
      windowGone: string;
      windowUpdated: string;
      windowRemoved: string;
      todayOrLater: string;
      exceptionSaved: string;
      exceptionGone: string;
      exceptionRemoved: string;
      hoursRemoving: (from: string, to: string) => string;
      thisWindow: string;
      dateHoursAfterSave: (date: string) => string;
      dateHoursAfterRemove: (date: string) => string;
      collision: (o: { n: number; codes: string; more: string; what: string; wayOut: string }) => string;
      andMore: Count;
      wayOutCancel: Count;
      wayOutApp: Count;
      wayOutMixed: (walkIns: number, fromApp: number) => string;
      viewBooking: string;
      viewBookings: string;
    };
    series: {
      notYoursBook: string;
      notYoursEnd: string;
      pickCourtsHere: string;
      outOfRange: string;
      saveFailed: string;
      created: (name: string, id: string) => string;
      endedNone: string;
      endedReleased: Count;
    };
  };

  // Zod field messages. English is the source of truth and stays inside
  // schemas.ts; this maps those sentences (and zod's own defaults) for the
  // other language. `fallback` covers a message with no entry — better a
  // Greek "check this field" than an English constraint description.
  validation: { fallback: string; messages: Record<string, string> };
}
