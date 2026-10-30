// UI copy strings — EN + GR. For full i18n (pluralization, interpolation,
// date formats), wire i18next in apps/mobile; this file stays as the source
// of truth that feeds the translation JSON in @ludi/i18n.

import type { Locale } from './types';

export interface Copy {
  appName: string;
  discover: string;
  map: string;
  matches: string;
  bookings: string;
  profile: string;
  nearYou: string;
  tonight: string;
  popular: string;
  searchPlaceholder: string;
  book: string;
  joinMatch: string;
  openSpots: string;
  players: string;
  level: string;
  amenities: string;
  price: string;
  perHour: string;
  bookNow: string;
  selectTime: string;
  sendRequest: string;
  openMatches: string;
  skillMatched: string;
  allMatches: string;
  pitchesCount: string;
  km: string;
  min: string;
  friends: string;
  team: string;
  upcoming: string;
  history: string;
  payWithCard: string;
  total: string;
  summary: string;
  pitchTypes: string[];
  surfaces: string[];
  filters: string[];
  cities: string[];
  days: string[];
  tabLabels: string[];
  greet: string;
  greetSub: string;
  greetMorning: string;
  greetSubMorning: string;
  // Home — the "next match" strip and list section label (home reorg 2026-08-31).
  homeNextMatch: string;
  homePitchesSection: string;
  // Home mini-map card: section overline + screen-reader label for the map.
  homeMapSection: string;
  homeMapA11y: string;
  // maps (plans/maps.md): activity on the mini-map, directions, your grounds
  mapPinSpots: string;              // "{{time}} · {{count}} spots"
  mapPinSpotsOne: string;
  mapPinKeeper: string;             // "{{time}} · keeper wanted"
  mapPinGames: string;              // "{{time}} · {{count}} games"
  homeTonightEmpty: string;
  directions: string;
  profileGroundsTitle: string;
  profileGroundsGames: string;
  profileGroundsGamesOne: string;
  profileGroundsLast: string;       // "last {{date}}"
  profileGroundsEmpty: string;
  profileGroundsA11y: string;
  // Announces the action ("switch to X"), read in the user's current language.
  langToggleA11y: string;
  // Auth — phone OTP signin (M2 #6) + Apple/Google/magic-link (M4 #20).
  signinTitle: string;
  signinSubtitle: string;
  /** Used when the phone method is gated off, so the subtitle stops
   *  promising an SMS the backend cannot send. See enabledAuthMethods(). */
  signinSubtitleEmail: string;
  signinPhoneLabel: string;
  signinCta: string;
  signinOr: string;
  signinAppleCta: string;
  signinGoogleCta: string;
  signinMagicLinkCta: string;
  signinProviderUnavailable: string;
  signinProviderNotConfigured: string;
  verifyTitle: string;
  verifySubtitle: string;
  verifyCodeLabel: string;
  verifyCta: string;
  verifyResend: string;
  verifyChangeNumber: string;
  signOut: string;
  // M5 #32 — self-service account deletion (GDPR).
  deleteAccountCta: string;
  deleteAccountTitle: string;
  deleteAccountBody: string;
  deleteAccountConfirmCta: string;
  deleteAccountDeleting: string;
  deleteAccountCancel: string;
  deleteAccountError: string;
  deleteAccountAppleNote: string; // Sign in with Apple accounts, iOS only
  deleteAccountAppleMismatch: string;
  errorInvalidPhone: string;
  errorInvalidCode: string;
  errorAuthFailed: string;
  errorNetwork: string;
  // M4 #20 — magic-link entry + sent screens.
  magicLinkTitle: string;
  magicLinkSubtitle: string;
  magicLinkEmailLabel: string;
  magicLinkCta: string;
  magicLinkSending: string;
  magicLinkSentTitle: string;
  magicLinkSentBody: string;
  magicLinkSentCheckSpam: string;
  magicLinkUseDifferent: string;
  errorInvalidEmail: string;
  // errorRateLimited reused from booking flow below.
  // M4 #20 — deep-link callback handler ("opening your session" state).
  callbackTitle: string;
  callbackError: string;
  // A link this phone did not ask for, or asked for too long ago (audit A4).
  callbackNotRequested: string;
  callbackRetry: string;
  // M4 #22 — first-launch GDPR consent modal.
  consentTitle: string;
  consentSubtitle: string;
  consentBulletIdentity: string;
  consentBulletBookings: string;
  consentBulletPayments: string;
  consentBulletCrashes: string;
  // The one consent-based choice (consent v2): product analytics, off by default.
  analyticsChoiceLabel: string; // consent screen + Settings
  consentAnalyticsHint: string;
  settingsAnalyticsHint: string;
  // the notice switches (plans/reach.md R2)
  settingsNotifyTitle: string;
  settingsNotifyGames: string;
  settingsNotifyGamesHint: string;
  settingsScreensTitle: string;
  settingsScreensName: string;
  settingsScreensNameHint: string;
  settingsNotifyAsks: string;
  settingsNotifyAsksHint: string;
  settingsNotifyOsOff: string;
  // the Help row (plans/ops-readiness.md O8)
  settingsHelp: string;
  settingsHelpHint: string;
  helpMailSubject: string;
  signinHelp: string;
  // the minimum-version gate (plans/ops-readiness.md O7)
  updateTitle: string;
  updateBody: string;
  updateCta: string;
  consentResidency: string;
  consentReadPolicy: string;
  consentAcceptCta: string;
  // M4 #21 — profile edit screen.
  profileEditTitle: string;
  profileFirstName: string;
  profileLastName: string;
  profileLanguage: string;
  profileLanguageEn: string;
  profileLanguageEl: string;
  profileHomeCity: string;
  profileSkill: string;
  profilePositions: string;
  profilePositionsHint: string;
  profileFoot: string;
  profileFootLeft: string;
  profileFootRight: string;
  profileFootBoth: string;
  // Player Card profile substrate (ADR-0012) — height, age band, play frequency, skill anchors.
  profileHeight: string;
  profileHeightHint: string;
  profileHeightInvalid: string;
  profileHeightEmpty: string;
  profileHeightClear: string;
  profileHeightChange: string;
  profileHeightDone: string;
  profileAge: string;
  profilePlayFrequency: string;
  profilePlayFrequencyCasual: string;
  profilePlayFrequencyWeekly: string;
  profilePlayFrequencyOften: string;
  profileSkillTier1: string;
  profileSkillTier2: string;
  profileSkillTier3: string;
  profileSkillTier4: string;
  profileSkillTier5: string;
  // Player Card — viewable profile (ADR-0012 empty-state reputation block).
  playerCardViewCta: string;
  playerCardMemberSince: string;
  playerCardVerified: string;
  playerCardReputationTitle: string;
  playerCardReputationEmpty: string;
  playerCardReliability: string;
  playerCardMatchesPlayed: string;
  playerCardRatings: string;
  playerCardNewPlayer: string;
  playerCardNotSet: string;
  playerCardDetails: string;
  playerCardReputationEarnedShort: string;
  playerCardMemberLabel: string;
  playerCardReputationNote: string;
  playerCardFootShort: string;
  playerCardAddToWallet: string;
  // Player Card v2 (plans/player-card-v2.md) — direction A, front + back.
  // Singular forms are their own keys: the interface cannot take _one/_other.
  playerCardLevel: string;
  playerCardLevelA11y: string;        // "Level {{n}} of 5, {{tier}}"
  playerCardPlays: string;
  playerCardAlsoPlays: string;        // "Also plays {{list}}"
  playerCardSince: string;            // "since {{when}}"
  playerCardMatches: string;          // "{{count}} matches"
  playerCardMatchesOne: string;
  playerCardFillsIn: string;          // "The card fills in as {{name}} plays."
  playerCardFillsInAnon: string;      // the same, for a card with no name yet
  playerCardBackHint: string;
  playerCardShowBack: string;
  playerCardShowFront: string;
  playerCardPosition: string;
  playerCardPositionNotSet: string;
  playerCardPitchA11y: string;        // "Plays {{list}}"
  playerCardRecordTitle: string;
  playerCardFirstMatch: string;
  playerCardRecordPrivate: string;
  playerCardLockedTitle: string;
  playerCardScanToJoin: string;       // "Scan to join {{name}} on Ludi"
  playerCardScanToJoinAnon: string;
  playerCardQrA11y: string;
  playerCardFreqCasual: string;
  playerCardFreqWeekly: string;
  playerCardFreqOften: string;
  skillTierName1: string;
  skillTierName2: string;
  skillTierName3: string;
  skillTierName4: string;
  skillTierName5: string;
  skillTierDesc1: string;
  skillTierDesc2: string;
  skillTierDesc3: string;
  skillTierDesc4: string;
  skillTierDesc5: string;
  positionNameGK: string;
  positionNameCB: string;
  positionNameLB: string;
  positionNameRB: string;
  positionNameCDM: string;
  positionNameCM: string;
  positionNameCAM: string;
  positionNameLW: string;
  positionNameRW: string;
  positionNameST: string;
  profileSaveCta: string;
  profileSaving: string;
  profileSaved: string;
  profileLoading: string;
  profileLoadError: string;
  mapEmptyTitle: string;
  mapEmptyBody: string;
  mapEmptyCta: string;
  profilePublicTitle: string;
  profilePublicBody: string;
  profilePublicOn: string;
  profilePublicOff: string;
  profilePublicNote: string;
  profileErrorRequired: string;
  profileErrorSaveFailed: string;
  // Profile hub — view-first profile tab; the edit form lives at account/edit-profile.
  profileHubEditRow: string;
  profileHubEditRowHint: string;
  profileHubCompleteTitle: string;
  profileHubCompleteBody: string;
  // Discover list states (M2 #7).
  discoverLoading: string;
  discoverEmpty: string;
  discoverError: string;
  discoverRetry: string;
  // Pitch detail + availability (M2 #8).
  pitchDetailError: string;
  pitchOpenInMaps: string;
  pitchAvailability: string;
  pitchClosedToday: string;
  // Booking flow + Stripe Payment Sheet (M2 #9).
  bookCta: string;
  bookCtaPickSlot: string;
  addonsTitle: string;
  addonsNote: string;
  addonBibs: string;
  addonBibsUnit: string;
  addonBallRental: string;
  addonBallRentalUnit: string;
  bookingProcessing: string;
  bookingTakingLong: string;
  bookingCheckStatus: string;
  bookingConfirmed: string;
  bookingPaid: string;
  joinedTitle: string;                     // the second celebration: a seat in someone's game is yours
  joinedSquadCta: string;                     // beat one of the confirmation: the payment went through, the booking is not yet confirmed
  bookingSettlingSlowTitle: string;        // the venue hasn't confirmed inside the poll window
  bookingSettlingSlowBody: string;
  bookingCode: string;
  bookingDone: string;
  errorSlotTaken: string;
  errorPitchUnbookable: string;
  errorPaymentDeclined: string;
  errorPaymentService: string;
  errorRateLimited: string;
  errorBookingGeneric: string;
  errorMissingParams: string;
  bookingRetry: string;
  // Bookings tab + booking detail (M2 #10).
  bookingsUpcoming: string;
  bookingsHistory: string;
  bookingsEmptyUpcoming: string;
  bookingsEmptyHistory: string;
  bookingsLoading: string;
  bookingsError: string;
  bookingsRefresh: string;
  bookingDetailTitle: string;
  // The booking-as-shared-fixture version (docs/plans/shared-fixture.md).
  // The booking detail screen becomes a fixture with a roster.
  fixtureEyebrowOrganiser: string;
  fixtureEyebrowIn: string;
  fixtureEyebrowPlayed: string;
  fixtureSquad: string;
  fixtureSquadOf: string;        // "{{filled}} / {{total}}"
  fixtureSquadPlayed: string;    // "{{filled}} played"
  fixtureSquadWereIn: string;    // "{{filled}} were in"
  fixtureKeepers: string;
  // Roster progress on the bookings list row (W7).
  bookingsRowSquad: string;         // "{{filled}}/{{total}}"
  bookingsRowKeeperNeeded: string;
  fixtureOutfield: string;
  fixtureSlotOpen: string;
  fixtureSlotKeeper: string;
  fixtureSlotMoreOpen: string;   // "+{{count}} open"
  fixtureOrganiserTag: string;
  fixtureYou: string;
  fixtureKeeperNoneTitle: string;
  fixtureKeeperNoneBody: string;
  fixtureKeeperShortBody: string;
  fixtureKeeperAsk: string;
  fixtureInviteCta: string;
  fixtureInviteMore: string;     // "Invite {{count}} more"
  fixtureInviteHint: string;
  fixtureCompleteTitle: string;
  fixtureCompleteBody: string;
  fixtureSendDetails: string;
  fixtureCancelledTitle: string;
  fixtureCancelledBody: string;
  fixtureRebook: string;
  fixtureRebookHint: string;
  fixtureSplitsTo: string;
  fixtureAskEachFor: string;
  fixtureYourShare: string;
  fixtureOwedToYou: string;
  fixtureYouOwe: string;         // "You owe {{name}}"
  fixtureEachOnceFull: string;   // "each, once all {{total}} are in"
  fixtureAtNIn: string;          // "at {{filled}} in"
  fixtureIfAllCome: string;      // "{{amount}} if all {{total}} come"
  fixtureSettleHint: string;
  fixtureSettleHintTeammate: string;
  // C2 W6 — split payment made real: the toggle at checkout, the
  // collecting strip, pay-your-share, and the organiser's cover.
  checkoutFailTitleSplitLate: string;
  splitTitle: string;
  splitToggleLabel: string;
  splitTooLateHint: string;
  splitOnHint: string;          // "{{share}} a head across {{slots}} — you pay yours now"
  splitOffHint: string;
  inviteShareLine: string;      // "{{amount}} a head"
  inviteClaimClosed: string;
  inviteClaimPayLater: string;
  fixtureCollectingTitle: string;   // "{{paid}}/{{filled}} paid"
  fixtureCollectingBody: string;    // "{{when}}"
  fixtureCollectingLateTitle: string;
  fixtureCollectingLateOrganiser: string;
  fixtureCollectingLateTeammate: string; // "{{name}}"
  fixturePayShare: string;      // "{{amount}}"
  fixtureCoverCta: string;
  fixtureShareEach: string;
  fixtureSharesPaid: string;    // "{{paid}}/{{filled}} paid"
  fixtureSharesSettled: string;
  fixtureSplitHint: string;
  fixtureSplitTotal: string;
  fixturePaidTag: string;
  fixtureUnpaidTag: string;
  // The teammate sheet — a tapped roster seat (launch prep). Everything on
  // it is optional on the player's own card, so every line has an absent
  // reading too.
  rosterSheetRoleKeeper: string;
  rosterSheetRoleOutfield: string;
  rosterSheetTogether: string;      // "{{count}} matches together"
  rosterSheetTogetherOne: string;
  rosterSheetTogetherNone: string;
  rosterSheetTogetherLabel: string;   // beside the big number: "matches together"
  rosterSheetTogetherLabelOne: string;
  rosterSheetJoined: string;        // "Joined {{when}}"
  rosterSheetLeft: string;          // "Left {{when}}"
  rosterSheetEmpty: string;
  rosterSheetYouEmpty: string;
  rosterSheetClose: string;
  // The seats nobody is in, and the people who gave theirs up.
  rosterOpenSheetTitleKeeper: string;
  rosterOpenSheetTitleOutfield: string;
  rosterOpenSheetBodyKeeper: string;
  rosterOpenSheetBody: string;
  fixtureDroppedTitle: string;      // "DROPPED OUT {{count}}"
  fixtureDroppedBody: string;
  fixtureInviteTeammate: string;
  cancelConfirmBodyCollecting: string;
  fixtureRefund: string;
  fixtureRefundOf: string;       // "of {{total}} · {{policy}} policy"
  fixtureIn: string;             // "in {{count}} days"
  fixtureTonight: string;
  fixtureTomorrow: string;
  fixtureAgo: string;            // "{{count}} days ago"
  // Singular as its own key, not i18next pluralization: the Copy interface's
  // exact-property typing does not accommodate the `_one`/`_other` suffixes
  // (same workaround as leaveSheetHoursLabel).
  fixtureAgoOne: string;
  fixtureShareInvite: string;
  fixtureShareDetails: string;
  fixturePaidByYou: string;
  fixturePaidByThem: string;   // "{{name}} paid"
  fixturePitchLine: string;
  bookingConfirmedRosterCta: string;
  // The `/f/[token]` invite preview (W5).
  inviteLoading: string;
  inviteNotFound: string;
  inviteNotFoundBody: string;
  inviteExitCta: string;
  inviteEnded: string;
  inviteEndedBody: string;
  inviteFull: string;
  inviteFullBody: string;
  inviteHeading: string;      // "You're invited"
  inviteSpotsOpen: string;    // "{{gk}} keeper · {{outfield}} outfield spots open"
  inviteKeeperUrgent: string;
  inviteSignInCta: string;
  inviteJoinAsKeeper: string;
  inviteJoinAsOutfield: string;
  inviteJoinAsOutfieldOnly: string; // when no keeper gap to call out
  inviteAlreadyJoined: string;
  inviteGoToFixture: string;
  inviteJoinErrorTitle: string;
  inviteJoinErrorFull: string;
  inviteJoinErrorEnded: string;
  inviteJoinErrorInvalid: string;
  inviteJoinErrorGeneric: string;
  inviteJoinErrorDismiss: string;
  // Community tab — the open-matches board (ADR-0028). Rows reuse
  // inviteSpotsOpen / inviteShareLine so a board row and the invite it
  // routes to can never describe the same fixture differently.
  communityTitle: string;
  communityIntro: string;         // one quiet line under the title
  // Empty board = status + pathway (community-v4.md unit 5): what is true,
  // what to do, one CTA. Never a count-word ("no matches") — a zero reads
  // as "nobody comes here"; "nothing open right now" reads as a moment.
  communityEmptyTitle: string;
  communityEmptyBody: string;
  communityEmptyCta: string;
  communityError: string;
  // Organiser's listing switch on the fixture screen.
  fixtureOpenToggleTitle: string;
  fixtureOpenToggleBody: string;
  fixtureOpenToggleOnTag: string; // "on the board" tag next to the title
  // Board enhancements (2026-09-01): filters, level tag, per-head estimate.
  communityFilterKeeper: string;  // keeper-needed-only filter chip
  communityFilterWeekend: string; // time chip; Tonight/Tomorrow reuse relTonight/relTomorrow
  communityFilterNone: string;    // active filters match nothing
  // Live header line (round-2 vivid pass): the board states its own score.
  communityOpenSpotsOne: string;  // "1 spot open for you"
  communityOpenSpotsMany: string; // "{{count}} spots open for you" — capacity, never a match count
  communityKeepersOne: string;
  communityKeepersMany: string;   // "{{count}} need a keeper"
  communityShareShort: string;    // footer-compact "{{amount}} a head"
  communitySpotsShort: string;    // footer split "{{gk}} GK · {{outfield}} outfield" — the pill already says how many
  // The shelf — standing content under the board (community-v2.md).
  communityShelfLabel: string;
  communityWeekMatches: string;
  communityWeekPlayers: string;
  communityWaTitle: string;       // "Ludi {{city}} on WhatsApp"
  communityWaBody: string;
  communityWaCta: string;
  communityCreateCta: string;     // header pill — the one create affordance (unit 4)
  communityKeeperTitle: string;
  communityKeeperBody: string;
  communityKeeperCtaFilter: string;
  communityKeeperCtaPool: string;
  communityPerHead: string;       // "≈{{amount}} a head if it fills"
  // The organiser & the thread (community-v3.md). All three surfaces are
  // absent rather than empty when the caller has nothing to show.
  // Yours (community-v4.md unit 1): the short fixtures the caller stands
  // on, hosting or joined — one line each, role as a chip, share trailing.
  communityYoursLabel: string;     // eyebrow
  communityYoursHosting: string;   // role chip
  communityYoursJoined: string;    // role chip
  communityYoursShortOne: string;  // "1 short"
  communityYoursShortMany: string; // "{{count}} short"
  communityYoursKeeper: string;    // "keeper needed"
  communityYoursShare: string;     // a11y label on the share icon
  communityYoursMore: string;      // "{{count}} more in Bookings"
  // The capacity numeral on the board card (unit 3).
  communitySpotsLabel: string;     // "spots" — beside the numeral
  communityLastSpot: string;       // "last spot" — when the numeral is 1
  communityPlayedWithOne: string;
  communityPlayedWithMany: string; // "You've played with {{count}} of them"
  communitySeriesLine: string; // "Every {{day}} since {{month}}"
  communitySeriesLineYear: string; // "Every {{day}} since {{month}} {{year}}"
  communitySeriesLabel: string;   // eyebrow over the repeated slots
  communitySeriesSlot: string;    // "{{weekday}}s, {{time}}"
  communitySeriesPlayed: string;  // bare label under the big count
  communitySeriesNext: string;    // "Next {{when}}"
  levelCasual: string;
  levelCompetitive: string;
  fixtureOpenLevelHint: string;   // above the level chips on the toggle card
  // The record (community v2) - stat labels on the profile hub.
  profileRecordMatches: string;
  profileRecordTeammates: string;
  profileRecordVenues: string;
  // Profile hub, Direction C rework (2026-09-02). The tab leads with the
  // person, then the football, then the history.
  profileNameFallback: string;         // when no name is set yet
  profileHubPlayerSection: string;     // "Player" - the attribute grid
  profileHubFormSection: string;       // "Form" - the recent-match strip
  profileHubFormEmpty: string;
  profileHubSeeAll: string;
  profileHubAddAttribute: string;      // the tappable "Add" in an empty cell
  profileHubCardRow: string;           // the row out to the 9:16 card
  profileHubCardRowHint: string;
  profileHubSettings: string;          // gear a11y label + settings title
  profileAttrPosition: string;
  profileAttrFoot: string;
  profileAttrLevel: string;
  profileAttrHeight: string;
  profileAttrAge: string;
  profileAttrPlays: string;
  // Leaving + rejoining (W6). Three readings of "I can't make it" — see
  // shared-fixture.md's DEVELOPMENT_PLAN.
  fixtureLeaveCta: string;             // "I can't make it"
  leaveSheetHoursLabel: string;        // "{{count}} hours"
  fixtureRejoinCta: string;            // "Actually, I'm back in"
  fixtureOutBannerTitle: string;
  fixtureOutBannerBody: string;
  fixtureOutBannerAsk: string;
  fixtureOutBannerAskKeeper: string;
  fixtureOwedNothing: string;
  leaveSheetOrdinaryTitle: string;
  leaveSheetOrdinaryBody: string;
  leaveSheetKeeperTitle: string;
  leaveSheetKeeperBody: string;
  leaveSheetLateTitle: string;
  leaveSheetLateBody: string;
  leaveSheetKeeperLateTitle: string;
  leaveSheetKeeperLateBody: string;
  leaveSheetGiveUp: string;            // "Give up my slot"
  leaveSheetGiveUpAnyway: string;      // "Give up my slot anyway"
  leaveSheetAskPool: string;           // urgent primary — keeper
  leaveSheetAskReplacement: string;    // urgent primary — outfield
  leaveSheetStayIn: string;
  leaveShareReplacement: string;       // outfield replacement-ask share text
  leaveShareReplacementKeeper: string; // keeper replacement-ask share text
  // the goalkeeper pool (ADR-0047)
  profileInGoal: string;
  profileInGoalHint: string;
  profileInGoalFull: string;
  profileInGoalRotation: string;
  profileInGoalNo: string;
  fixtureKeeperPost: string;
  fixtureKeeperPostRotation: string;
  fixtureKeeperPosted: string;            // {{count}}
  fixtureKeeperPostedOne: string;
  fixtureKeeperPostedNone: string;
  fixtureKeeperPostedRotation: string;    // suffix when twenty minutes were asked
  fixtureKeeperWithdraw: string;
  fixtureKeeperAskWhatsapp: string;
  fixtureKeeperError: string;
  fixtureKeeperFreeTag: string;
  fixtureKeeperFreeShare: string;          // the big line where a share would be
  fixtureKeeperFreeHint: string;
  fixtureKeeperFreeNote: string;           // to the payers: why the split is wider
  communityKeepersLabel: string;
  communityKeeperWhole: string;
  communityKeeperRotation: string;
  communityKeeperRecord: string;          // {{back}} {{played}}
  communityKeeperClaim: string;
  communityKeeperTaken: string;
  communityKeeperError: string;
  keeperFeedbackOrganiserTitle: string;   // {{name}}
  keeperFeedbackBack: string;
  keeperFeedbackKeeperTitle: string;
  keeperFeedbackYes: string;
  keeperFeedbackNo: string;
  keeperFeedbackHint: string;
  keeperFeedbackThanks: string;
  // court cameras (ADR-0042)
  recordTitle: string;
  recordToggle: string;
  recordHintOff: string;
  recordHintOn: string;
  recordMinor: string;
  recordNotice: string;
  recordNoticeAsk: string;
  recordError: string;
  matchTitle: string;
  matchWatch: string;
  matchRecording: string;
  matchUploading: string;
  matchFailed: string;
  matchDeleted: string;
  matchExpires: string;
  matchDelete: string;
  matchDeleteTitle: string;
  matchDeleteBody: string;
  matchDeleteConfirm: string;
  matchCancel: string;
  matchError: string;
  // find my replacement (ADR-0044): the seat waits for whoever takes it
  leaveSheetFindReplacement: string;       // primary on a live fixture
  leaveSheetReplaceTitle: string;          // ordinary case when a replacement is on offer
  leaveSheetFindReplacementNote: string;   // under it, free fixture
  leaveSheetFindReplacementPaidNote: string; // under it, paid split seat: {{amount}}
  leaveSheetLeaveRefund: string;           // collecting split, paid: {{amount}}
  leaveSheetLeaveNoRefund: string;         // confirmed split, paid
  fixtureReplacingTitle: string;           // eyebrow on your own asked-for seat
  fixtureReplacingBody: string;
  fixtureReplacingBodyPaid: string;        // {{amount}}
  fixtureReplacingShare: string;
  fixtureReplacingKeep: string;
  fixtureReplacingTag: string;             // roster tag on a seat up for grabs
  fixtureReplacementError: string;
  fixtureRefreshError: string;             // a quiet re-read failed; the fixture on screen may be stale
  inviteSeatsToTake: string;               // "{{gk}} keeper · {{outfield}} outfield"
  inviteTakeSeat: string;
  inviteTakeSeatKeeper: string;
  inviteTakeSeatPaid: string;              // {{amount}}
  inviteTakeSeatGone: string;
  communityCrewLabel: string;              // eyebrow
  communityCrewSeat: string;               // "a seat to take"
  communityCrewSeatKeeper: string;         // "the keeper's seat"
  bookingDetailVenue: string;
  bookingDetailWhen: string;
  bookingDetailAddons: string;
  bookingDetailTotal: string;
  bookingDetailRefund: string;
  // Cancellation flow + policy UI (M3 #12).
  bookingCancelCta: string;
  bookingCancelling: string;
  cancelConfirmTitle: string;
  cancelConfirmBodyPending: string;
  cancelConfirmBodyWithRefund: string;
  cancelConfirmBodyNoRefund: string;
  cancelConfirmConfirm: string;
  cancelConfirmDismiss: string;
  cancelPolicy: { standard: string; strict: string; flex: string };
  cancelErrorTitle: string;
  cancelErrorStripe: string;
  cancelErrorNetwork: string;
  cancelErrorUnauthorized: string;
  cancelErrorGeneric: string;
  cancelDismiss: string;
  bookingState: {
    pending: string;
    collecting: string;
    paid: string;
    confirmed: string;
    completed: string;
    cancelled: string;
    refunded: string;
    refunded_by_admin: string;
    cancelled_no_refund: string;
  };
  // "Chalk & Aegean" polish pass (design handoff 2026-08-10).
  verifyResendIn: string; // countdown — "Resend code in {{s}}"
  discoverEmptyTitle: string; // "{{city}}" interpolated
  discoverEmptyBody: string;
  courtsOne: string; // venue card court count, singular
  courtsOther: string; // "{{count}}" interpolated
  fromLabel: string; // price prefix when a venue spans several prices
  soldOutBadge: string;
  soldOutTitle: string; // "{{day}}" interpolated
  soldOutTryNext: string; // "{{day}}" interpolated
  priceLinePitch: string;
  checkoutHolding: string;
  checkoutConfirming: string;
  checkoutStillConfirmingTitle: string;
  checkoutStillConfirmingBody: string;
  checkoutFailNoCharge: string;
  checkoutFailTitleSlot: string;
  checkoutFailTitlePitch: string;
  checkoutFailTitleStripe: string;
  checkoutFailTitleNetwork: string;
  checkoutFailTitleRateLimited: string;
  checkoutFailTitleGeneric: string;
  checkoutTryAnotherCard: string;
  checkoutBackToPitch: string;
  // Checkout reached without a Book tap — a link cannot start a payment.
  checkoutFromPitchTitle: string;
  checkoutFromPitchBody: string;
  checkoutOpenPitch: string;
  addToCalendar: string;
  shareBooking: string;
  bookingsEmptyTitle: string;
  bookingsEmptyBody: string;
  bookingsFindPitch: string;
  relTonight: string;
  relTomorrow: string;
  // The CFA Saturday inside Ludi (plans/cfa-in-the-app.md, ADR-0051): the
  // venue's Saturday, a team a parent follows, the parents' game.
  cfaEyebrow: string;               // "CFA grassroots · {{day}}"
  cfaToday: string;
  cfaNow: string;
  cfaPostponed: string;
  cfaCancelled: string;
  cfaTapTeam: string;
  cfaNoScores: string;
  cfaFollowing: string;
  cfaFollow: string;
  cfaFollowWhy: string;
  cfaFollowPrivate: string;
  cfaPlays: string;
  cfaPlaysHint: string;
  cfaUnfollow: string;
  cfaFollowError: string;
  myTeamsSection: string;
  myTeamsAway: string;              // "Away · {{venue}}"
  followedTeams: string;
  followedTeamsNone: string;
  cfaTodayEyebrow: string;
  cfaTodayLine: string;             // "{{count}} matches · next kick-off {{time}}"
  cfaTodayDone: string;             // "{{count}} matches today"
  askParents: string;
  askParentsHint: string;
  askParentsDone: string;
  askParentsError: string;
}

export const COPY: Record<Locale, Copy> = {
  en: {
    appName: 'Ludi',
    discover: 'Discover',
    map: 'Map',
    matches: 'Matches',
    bookings: 'Bookings',
    profile: 'Profile',
    nearYou: 'Near you',
    tonight: 'Tonight in Cyprus',
    popular: 'Popular pitches',
    searchPlaceholder: 'Search pitches, clubs, matches',
    book: 'Book',
    joinMatch: 'Join match',
    openSpots: 'open spots',
    players: 'players',
    level: 'Level',
    amenities: 'Amenities',
    price: 'Price',
    perHour: '/hr',
    bookNow: 'Book now',
    selectTime: 'Select time',
    sendRequest: 'Send booking request',
    openMatches: 'Open matches',
    skillMatched: 'Skill-matched',
    allMatches: 'All matches',
    pitchesCount: 'pitches',
    km: 'km',
    min: 'min',
    friends: 'Friends',
    team: 'My team',
    upcoming: 'Upcoming',
    history: 'History',
    payWithCard: 'Pay with card',
    total: 'Total',
    summary: 'Summary',
    pitchTypes: ['5-a-side', '7-a-side', '11-a-side'],
    surfaces: ['Artificial turf', 'Grass', 'Indoor'],
    filters: ['Tonight', '5-a-side', 'Indoor', 'Under €40'],
    cities: ['Nicosia', 'Limassol', 'Larnaca', 'Paphos', 'Ayia Napa'],
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    tabLabels: ['Discover', 'Map', 'Community', 'Bookings', 'Profile'],
    greet: 'Kalispéra',
    greetSub: 'Ready to play tonight?',
    greetMorning: 'Kaliméra',
    greetSubMorning: 'Ready to play today?',
    homeNextMatch: 'Next match',
    homePitchesSection: 'Pitches',
    homeMapSection: 'On the map',
    homeMapA11y: 'Map of partner venues and open games. Tap a pin to open it.',
    mapPinSpots: '{{time}} · {{count}} spots',
    mapPinSpotsOne: '{{time}} · 1 spot',
    mapPinKeeper: '{{time}} · keeper wanted',
    mapPinGames: '{{time}} · {{count}} games',
    homeTonightEmpty: 'No games tonight yet. Book a pitch and open it to the community.',
    directions: 'Directions',
    profileGroundsTitle: 'Your grounds',
    profileGroundsGames: '{{count}} games',
    profileGroundsGamesOne: '1 game',
    profileGroundsLast: 'last {{date}}',
    profileGroundsEmpty: 'Your grounds appear here once you have played.',
    profileGroundsA11y: 'Map of the venues you have played at. Tap a pin to open the venue.',
    langToggleA11y: 'Switch to Greek',
    signinTitle: 'Sign in',
    signinSubtitle: "We'll text you a 6-digit code.",
    signinSubtitleEmail: "We'll email you a sign-in link.",
    signinPhoneLabel: 'Phone number',
    signinCta: 'Continue',
    signinOr: 'or',
    signinAppleCta: 'Continue with Apple',
    signinGoogleCta: 'Continue with Google',
    signinMagicLinkCta: 'Continue with email',
    signinProviderUnavailable: 'Not available on this device.',
    signinProviderNotConfigured: 'Not configured yet.',
    verifyTitle: 'Enter code',
    verifySubtitle: 'Sent to {{phone}}',
    verifyCodeLabel: 'Verification code',
    verifyCta: 'Verify',
    verifyResend: 'Resend code',
    verifyChangeNumber: 'Change number',
    signOut: 'Sign out',
    deleteAccountCta: 'Delete account',
    deleteAccountTitle: 'Delete your account?',
    deleteAccountBody:
      'This permanently removes your profile and personal details, and signs you out for good — you won’t be able to sign back in. Past bookings are kept in anonymised form for as long as Cyprus tax law requires, with your personal details stripped. This can’t be undone.',
    deleteAccountConfirmCta: 'Delete my account',
    deleteAccountDeleting: 'Deleting…',
    deleteAccountCancel: 'Cancel',
    deleteAccountError: 'Couldn’t delete your account. Please try again.',
    deleteAccountAppleNote:
      'You’ll confirm with Apple once more. That also disconnects Ludi from your Apple ID.',
    deleteAccountAppleMismatch:
      'That’s a different Apple ID from the one you use for Ludi. Try again with that one.',
    errorInvalidPhone: 'Enter 8 digits.',
    errorInvalidCode: 'Enter a 6-digit code.',
    errorAuthFailed: 'That code did not work. Try again.',
    errorNetwork: 'Network error. Try again.',
    magicLinkTitle: 'Sign in with email',
    magicLinkSubtitle: "We'll send you a one-tap link.",
    magicLinkEmailLabel: 'Email address',
    magicLinkCta: 'Send link',
    magicLinkSending: 'Sending…',
    magicLinkSentTitle: 'Check your inbox',
    magicLinkSentBody: 'We sent a link to {{email}}. Tap it on this phone within 15 minutes to sign in.',
    magicLinkSentCheckSpam: "Didn't arrive? Check your spam folder, or use a different email.",
    magicLinkUseDifferent: 'Use a different email',
    errorInvalidEmail: 'Enter a valid email.',
    callbackTitle: 'Signing you in…',
    callbackError: "Couldn't sign you in. The link may have expired.",
    callbackNotRequested:
      "This link wasn't asked for on this phone, or it's more than 15 minutes old. Ask for a new one here.",
    callbackRetry: 'Back to sign in',
    consentTitle: 'Welcome to Ludi',
    consentSubtitle:
      "Before we start — here's the short version of what we collect and why. The full privacy policy is one tap away.",
    consentBulletIdentity:
      'Your name, phone or email, and chosen city — so other players can find you and bookings can be confirmed.',
    consentBulletBookings:
      'Your booking history (which pitch, when, with whom) — so we can show your past games and handle refunds.',
    consentBulletPayments:
      'Payment references via Stripe (never the card number itself) — so charges and payouts can be reconciled.',
    consentBulletCrashes:
      'Crash reports with no personal details — so we can fix what breaks.',
    analyticsChoiceLabel: 'Share anonymous usage stats',
    consentAnalyticsHint:
      'Optional. Which screens and steps get used, never your name, number or messages. Off unless you turn it on; change it any time in Settings.',
    settingsAnalyticsHint:
      'Anonymous stats on which screens and steps get used. Off means nothing is sent.',
    settingsNotifyTitle: 'Notifications',
    settingsNotifyGames: 'Your games',
    settingsNotifyGamesHint: 'Confirmed, two hours before kickoff, cancelled, the morning after a game you organised — and the teams you follow.',
    settingsScreensTitle: 'Venue screens',
    settingsScreensName: 'Show my first name',
    settingsScreensNameHint: 'On the day of a game you booked, the screen in the venue’s lobby shows your first name beside your court. Never your surname or phone.',
    settingsNotifyAsks: 'Asks',
    settingsNotifyAsksHint: 'A keeper wanted where you go in goal, a seat offered in a crew you play with, a parents\' game where you said you play.',
    settingsNotifyOsOff: 'Notifications are off for Ludi on this phone — open Settings to allow them.',
    settingsHelp: 'Help',
    settingsHelpHint: 'Email hello@ludi.football — a person reads every message.',
    helpMailSubject: 'Ludi — help',
    signinHelp: 'Trouble signing in? hello@ludi.football',
    updateTitle: 'Update Ludi',
    updateBody:
      'This version of Ludi has been retired. Update to carry on — your account, your games and your card stay exactly as they are.',
    updateCta: 'Update',
    consentResidency:
      'Data is stored in the EU (Frankfurt) and never sold. You can delete your account at any time in Settings (the gear on your profile).',
    consentReadPolicy: 'Read the full privacy policy →',
    consentAcceptCta: 'Continue',
    profileEditTitle: 'Your profile',
    profileFirstName: 'First name',
    profileLastName: 'Last name',
    profileLanguage: 'Language',
    profileLanguageEn: 'English',
    profileLanguageEl: 'Ελληνικά',
    profileHomeCity: 'Home city',
    profileSkill: 'Skill level',
    profilePositions: 'Positions',
    profilePositionsHint: 'Tap all the spots you can play.',
    profileFoot: 'Preferred foot',
    profileFootLeft: 'Left',
    profileFootRight: 'Right',
    profileFootBoth: 'Both',
    profileHeight: 'Height',
    profileHeightHint: 'In centimetres (optional)',
    profileHeightInvalid: 'Height must be between 120 and 230 cm.',
    profileHeightEmpty: 'Add height',
    profileHeightClear: 'Clear',
    profileHeightChange: 'Change',
    profileHeightDone: 'Done',
    profileAge: 'Age',
    profilePlayFrequency: 'How often you play',
    profilePlayFrequencyCasual: 'Casually',
    profilePlayFrequencyWeekly: 'Weekly',
    profilePlayFrequencyOften: 'Several times a week',
    profileSkillTier1: 'New to organised football',
    profileSkillTier2: 'Casual — the occasional kickabout',
    profileSkillTier3: 'Regular — plays local pickup often',
    profileSkillTier4: 'Experienced — league or competitive background',
    profileSkillTier5: 'Advanced — high-level competitive play',
    playerCardViewCta: 'View my card',
    playerCardMemberSince: 'Member since {{when}}',
    playerCardVerified: 'Verified',
    playerCardReputationTitle: 'Reputation',
    playerCardReputationEmpty:
      'Earned as you play. Your reliability, ratings and match history appear here once you start playing.',
    playerCardReliability: 'Reliability',
    playerCardMatchesPlayed: 'Matches played',
    playerCardRatings: 'Player ratings',
    playerCardNewPlayer: 'New player',
    playerCardNotSet: 'Not set yet',
    playerCardDetails: 'Details',
    playerCardReputationEarnedShort: 'Earned as you play',
    playerCardMemberLabel: 'Member',
    playerCardReputationNote: 'Earned as you play — the card grows with real matches.',
    playerCardFootShort: 'Foot',
    playerCardAddToWallet: 'Add to Apple Wallet',
    playerCardLevel: 'Level',
    playerCardLevelA11y: 'Level {{n}} of 5, {{tier}}',
    playerCardPlays: 'Plays',
    playerCardAlsoPlays: 'Also plays {{list}}',
    playerCardSince: 'since {{when}}',
    playerCardMatches: '{{count}} matches',
    playerCardMatchesOne: '1 match',
    playerCardFillsIn: 'The card fills in as {{name}} plays.',
    playerCardFillsInAnon: 'The card fills in with every match.',
    playerCardBackHint: 'Record and QR on the back',
    playerCardShowBack: 'Show back',
    playerCardShowFront: 'Show front',
    playerCardPosition: 'Position',
    playerCardPositionNotSet: 'Position not set',
    playerCardPitchA11y: 'Plays {{list}}',
    playerCardRecordTitle: 'The record',
    playerCardFirstMatch: 'First match ahead',
    playerCardRecordPrivate: 'Match record is private for now.',
    playerCardLockedTitle: 'Reliability · Ratings',
    playerCardScanToJoin: 'Scan to join {{name}} on Ludi',
    playerCardScanToJoinAnon: 'Scan to join Ludi',
    playerCardQrA11y: 'QR code that opens ludi.football',
    playerCardFreqCasual: 'Casually',
    playerCardFreqWeekly: 'Weekly',
    playerCardFreqOften: '2+ a week',
    skillTierName1: 'New',
    skillTierName2: 'Casual',
    skillTierName3: 'Regular',
    skillTierName4: 'Experienced',
    skillTierName5: 'Advanced',
    skillTierDesc1: 'New to organised football',
    skillTierDesc2: 'The occasional kickabout',
    skillTierDesc3: 'Plays local pickup often',
    skillTierDesc4: 'League or competitive background',
    skillTierDesc5: 'High-level competitive play',
    positionNameGK: 'Goalkeeper',
    positionNameCB: 'Centre-back',
    positionNameLB: 'Left-back',
    positionNameRB: 'Right-back',
    positionNameCDM: 'Defensive mid',
    positionNameCM: 'Central mid',
    positionNameCAM: 'Attacking mid',
    positionNameLW: 'Left wing',
    positionNameRW: 'Right wing',
    positionNameST: 'Striker',
    profileSaveCta: 'Save',
    profileSaving: 'Saving…',
    profileSaved: 'Saved.',
    profileLoading: 'Loading your profile…',
    profileLoadError: 'Could not load your profile.',
    mapEmptyTitle: 'Pitches on a map',
    mapEmptyBody:
      'Soon you will be able to see every Larnaca pitch here and pick the closest one. Until then, they are all in Discover.',
    mapEmptyCta: 'Browse pitches',
    profilePublicTitle: 'Public player card',
    profilePublicBody:
      'Publishes a page at ludi.football/p/ with your first name, position, foot, city and skill level. Anyone can see it, including search engines.',
    profilePublicOn: 'Public',
    profilePublicOff: 'Private',
    profilePublicNote:
      'Off unless you turn it on. You can turn it off again any time — we stop serving the page, but we cannot recall copies other people already shared.',
    profileErrorRequired: 'First and last name are required.',
    profileErrorSaveFailed: 'Could not save. Try again.',
    profileHubEditRow: 'Edit profile',
    profileHubEditRowHint: 'Name, positions, height, visibility',
    profileHubCompleteTitle: 'Complete your player card',
    profileHubCompleteBody:
      '{{done}} of {{total}} details filled in — a complete card reads better when other players see it.',
    discoverLoading: 'Loading pitches…',
    discoverEmpty: 'No pitches in this city yet.',
    discoverError: 'Could not load pitches.',
    discoverRetry: 'Try again',
    pitchDetailError: 'Could not load pitch.',
    pitchOpenInMaps: 'Open in Maps',
    pitchAvailability: 'Availability',
    pitchClosedToday: 'Closed this day.',
    bookCta: 'Book €{{total}}',
    bookCtaPickSlot: 'Pick a time',
    addonsTitle: 'Extras',
    addonsNote: 'Optional. Need bibs or a ball? The venue has them — add what you need.',
    addonBibs: 'Bibs',
    addonBibsUnit: '€5 / set',
    addonBallRental: 'Match ball',
    addonBallRentalUnit: '€3 each',
    bookingProcessing: 'Confirming your booking…',
    bookingTakingLong: 'Payment is taking longer than expected.',
    bookingCheckStatus: 'Check status',
    bookingConfirmed: 'Booked.',
    bookingPaid: 'Paid.',
    joinedTitle: "You're in.",
    joinedSquadCta: 'See the squad',
    bookingSettlingSlowTitle: "The venue hasn't confirmed yet",
    bookingSettlingSlowBody: "Your payment went through and you haven't been charged twice. This turns into your booking the moment the venue confirms.",
    bookingCode: 'Booking code',
    bookingDone: 'Done',
    errorSlotTaken: 'Just got taken — pick another time.',
    errorPitchUnbookable: "This pitch can't be booked right now.",
    errorPaymentDeclined: 'Card declined. Try a different card.',
    errorPaymentService: 'Payment service is unavailable. Try again.',
    errorRateLimited: 'Too many attempts. Wait a minute.',
    errorBookingGeneric: "Couldn't complete your booking.",
    errorMissingParams: 'Missing booking details. Pick a slot and try again.',
    bookingRetry: 'Try again',
    bookingsUpcoming: 'Upcoming',
    bookingsHistory: 'History',
    bookingsEmptyUpcoming: 'No upcoming bookings.',
    bookingsEmptyHistory: 'No past bookings yet.',
    bookingsLoading: 'Loading bookings…',
    bookingsError: 'Could not load bookings.',
    bookingsRefresh: 'Refresh',
    bookingDetailTitle: 'Booking',
    fixtureEyebrowOrganiser: 'YOUR FIXTURE',
    fixtureEyebrowIn: "YOU'RE IN",
    fixtureEyebrowPlayed: 'PLAYED',
    fixtureSquad: 'Squad',
    fixtureSquadOf: '{{filled}} / {{total}}',
    fixtureSquadPlayed: '{{filled}} played',
    fixtureSquadWereIn: '{{filled}} were in',
    fixtureKeepers: 'Goalkeepers',
    bookingsRowSquad: '{{filled}}/{{total}}',
    bookingsRowKeeperNeeded: 'keeper needed',
    fixtureOutfield: 'Outfield',
    fixtureSlotOpen: 'Open',
    fixtureSlotKeeper: 'Keeper',
    fixtureSlotMoreOpen: '+{{count}} open',
    fixtureOrganiserTag: 'ORGANISER',
    fixtureYou: 'You',
    fixtureKeeperNoneTitle: 'NO KEEPER YET',
    fixtureKeeperNoneBody: 'Nobody in goal yet. Outfield fills itself — this does not.',
    fixtureKeeperShortBody: 'One short, in the slot that does not fill itself.',
    fixtureKeeperAsk: 'Ask the keeper pool',
    fixtureInviteCta: 'Invite your team',
    fixtureInviteMore: 'Invite {{count}} more',
    fixtureInviteHint: 'One link into the group chat. Whoever opens it takes a slot.',
    fixtureCompleteTitle: 'SQUAD COMPLETE',
    fixtureCompleteBody: 'Everyone is in, both keepers covered. Nothing left to chase.',
    fixtureSendDetails: 'Send the details',
    fixtureCancelledTitle: 'CANCELLED',
    fixtureCancelledBody:
      'Nobody is told automatically yet — this screen is how they find out. Message the group.',
    fixtureRebook: 'Book it again',
    fixtureRebookHint: 'Same pitch, same time next week — the squad carries over as invites.',
    fixtureSplitsTo: 'SPLITS TO',
    fixtureAskEachFor: 'ASK EACH OF THEM FOR',
    fixtureYourShare: 'YOUR SHARE',
    fixtureOwedToYou: 'EACH OF THEM OWES YOU',
    fixtureYouOwe: 'YOU OWE {{name}}',
    fixtureEachOnceFull: 'each, once all {{total}} are in',
    fixtureAtNIn: 'at {{filled}} in',
    fixtureIfAllCome: '{{amount}} if all {{total}} come',
    fixtureSettleHint: 'You paid up front · settle it between you for now',
    fixtureSettleHintTeammate: '{{name}} paid up front · settle it between you for now',
    checkoutFailTitleSplitLate: 'Too close to kickoff to split',
    splitTitle: 'Split the cost',
    splitToggleLabel: 'Everyone pays their own share',
    splitTooLateHint: 'Too close to kickoff to collect shares — book it whole and settle in cash.',
    splitOnHint:
      '{{share}} a head across {{slots}} slots. You pay yours now; the invite link collects the rest. Everyone pays by 24h before kickoff or you cover the gap.',
    splitOffHint: 'You pay the whole booking now and settle with your squad yourselves.',
    inviteShareLine: '{{amount}} a head — pay when you take your slot',
    inviteClaimClosed: 'The payment window for this match has closed.',
    inviteClaimPayLater: 'Your slot is held for a few minutes — tap again to finish paying.',
    fixtureCollectingTitle: 'Collecting · {{paid}}/{{filled}} paid',
    fixtureCollectingBody: 'Everyone pays their share by {{when}}, or the match is off.',
    fixtureCollectingLateTitle: 'Time is up',
    fixtureCollectingLateOrganiser:
      'The deadline passed with shares missing. Cover the rest now, or the match cancels and everyone is refunded.',
    fixtureCollectingLateTeammate:
      'The deadline passed with shares missing. {{name}} can still cover the rest — otherwise it cancels and everyone is refunded.',
    fixturePayShare: 'Pay your share · {{amount}}',
    fixtureCoverCta: 'Cover the rest',
    fixtureShareEach: 'Each slot pays',
    fixtureSharesPaid: '{{paid}}/{{filled}} paid',
    fixtureSharesSettled: 'all settled',
    fixtureSplitHint: 'Paid in the app — nobody chases anybody.',
    fixtureSplitTotal: 'Pitch total',
    fixturePaidTag: 'PAID',
    fixtureUnpaidTag: 'UNPAID',
    rosterSheetRoleKeeper: 'In goal',
    rosterSheetRoleOutfield: 'Outfield',
    rosterSheetTogether: '{{count}} matches together',
    rosterSheetTogetherOne: 'One match together',
    rosterSheetTogetherNone: 'First match together',
    rosterSheetTogetherLabel: 'matches together',
    rosterSheetTogetherLabelOne: 'match together',
    rosterSheetJoined: 'Joined {{when}}',
    rosterSheetLeft: 'Left {{when}}',
    rosterSheetEmpty: 'They have not filled in their card yet.',
    rosterSheetYouEmpty: 'Your card is empty — fill it in and your squad knows what you play.',
    rosterSheetClose: 'Close',
    rosterOpenSheetTitleKeeper: 'Keeper wanted',
    rosterOpenSheetTitleOutfield: 'Open slot',
    rosterOpenSheetBodyKeeper:
      'The one spot that stays empty. Send the link to someone who goes in goal.',
    rosterOpenSheetBody: 'Send the link and whoever taps it first takes this slot.',
    fixtureDroppedTitle: 'DROPPED OUT {{count}}',
    fixtureDroppedBody: 'They were in and gave the slot up. It is open again.',
    fixtureInviteTeammate: 'Bring someone',
    cancelConfirmBodyCollecting:
      'This match is still collecting shares. Cancelling calls it off and everyone who has paid gets a full refund.',
    fixtureRefund: 'REFUND',
    fixtureRefundOf: 'of {{total}} · {{policy}} policy',
    fixtureIn: 'in {{count}} days',
    fixtureTonight: 'tonight',
    fixtureTomorrow: 'tomorrow',
    fixtureAgo: '{{count}} days ago',
    fixtureAgoOne: 'yesterday',
    fixtureShareInvite: "⚽ {{when}}\n{{venue}}\nWe're {{short}} short. Take a slot: {{link}}",
    fixtureShareDetails: "⚽ {{when}}\n{{venue}}\nSquad's full — {{keepers}} in goal.\n{{each}} each to {{organiser}}.",
    fixturePaidByYou: 'You paid',
    fixturePaidByThem: '{{name}} paid',
    fixturePitchLine: 'Pitch',
    bookingConfirmedRosterCta: 'Add your team',
    inviteLoading: 'Loading invite…',
    inviteNotFound: "This link isn't right",
    inviteNotFoundBody: 'Ask whoever sent it for a fresh one.',
    inviteExitCta: 'Find a game on Ludi',
    inviteEnded: 'This one already happened',
    inviteEndedBody: 'Kick-off has passed, so there is nothing left to join.',
    inviteFull: 'This fixture is full',
    inviteFullBody: 'Every slot is taken. Ask the organiser if plans change.',
    inviteHeading: "You're invited",
    inviteSpotsOpen: '{{gk}} keeper · {{outfield}} outfield spots open',
    inviteKeeperUrgent: "They're short a keeper",
    inviteSignInCta: 'Sign in to take a slot',
    inviteJoinAsKeeper: 'Take the keeper spot',
    inviteJoinAsOutfield: 'Join as outfield',
    inviteJoinAsOutfieldOnly: 'Take a slot',
    inviteAlreadyJoined: "You're already in",
    inviteGoToFixture: 'Go to the fixture',
    inviteJoinErrorTitle: "Couldn't join",
    inviteJoinErrorFull: 'That slot filled a moment ago.',
    inviteJoinErrorEnded: 'This fixture is no longer joinable.',
    inviteJoinErrorInvalid: 'This link is no longer valid.',
    inviteJoinErrorGeneric: 'Something went wrong. Try again.',
    inviteJoinErrorDismiss: 'OK',
    communityTitle: 'Community',
    communityIntro: 'Matches around Cyprus with a spot open for you',
    communityEmptyTitle: 'Nothing open right now.',
    communityEmptyBody: 'Book a pitch, open it to the community, and it lists here for everyone.',
    communityEmptyCta: 'Find a pitch',
    communityError: 'Could not load the board.',
    fixtureOpenToggleTitle: 'Open to the community',
    fixtureOpenToggleBody:
      "Lists this fixture on the Community tab, on the venue's screen and on its page at ludi.football, so any player can take an open spot. Names stay hidden — people see when, where and what you need.",
    fixtureOpenToggleOnTag: 'on the board',
    communityFilterKeeper: 'Needs keeper',
    communityFilterWeekend: 'This weekend',
    communityFilterNone: 'Nothing matches these filters',
    communityOpenSpotsOne: '1 spot open for you',
    communityOpenSpotsMany: '{{count}} spots open for you',
    communityKeepersOne: '1 needs a keeper',
    communityKeepersMany: '{{count}} need a keeper',
    communityShareShort: '{{amount}} a head',
    communitySpotsShort: '{{gk}} GK · {{outfield}} outfield',
    communityShelfLabel: 'Explore',
    communityWeekMatches: 'Matches this week',
    communityWeekPlayers: 'Players seated',
    communityWaTitle: 'Ludi {{city}} on WhatsApp',
    communityWaBody: 'Open matches land here first — links only, no chat noise.',
    communityWaCta: 'Join the group',
    communityCreateCta: 'Open a match',
    communityKeeperTitle: 'Keepers are gold',
    communityKeeperBody: 'The one position every match is short of.',
    communityKeeperCtaFilter: 'See who needs one',
    communityKeeperCtaPool: 'Join the keeper pool',
    communityPerHead: '≈{{amount}} a head if it fills',
    communityYoursLabel: 'Yours',
    communityYoursHosting: 'Hosting',
    communityYoursJoined: 'Joined',
    communityYoursShortOne: '1 short',
    communityYoursShortMany: '{{count}} short',
    communityYoursKeeper: 'keeper needed',
    communityYoursShare: 'Share the invite link',
    communityYoursMore: '{{count}} more in Bookings',
    communitySpotsLabel: 'spots',
    communityLastSpot: 'last spot',
    communityPlayedWithOne: 'You’ve played with 1 of them',
    communityPlayedWithMany: 'You’ve played with {{count}} of them',
    communitySeriesLine: 'Every {{day}} since {{month}}',
    communitySeriesLineYear: 'Every {{day}} since {{month}} {{year}}',
    communitySeriesLabel: 'Your regulars',
    communitySeriesSlot: '{{weekday}}s, {{time}}',
    communitySeriesPlayed: 'played',
    communitySeriesNext: 'Next {{when}}',
    levelCasual: 'Casual',
    levelCompetitive: 'Competitive',
    fixtureOpenLevelHint: 'What kind of game is it?',
    profileRecordMatches: 'Matches played',
    profileRecordTeammates: 'Teammates',
    profileRecordVenues: 'Pitches',
    profileNameFallback: 'Your name',
    profileHubPlayerSection: 'Player',
    profileHubFormSection: 'Form',
    profileHubFormEmpty: 'Your first match will show up here.',
    profileHubSeeAll: 'See all',
    profileHubAddAttribute: 'Add',
    profileHubCardRow: 'Your player card',
    profileHubCardRowHint: 'Show it, share it, add it to Wallet',
    profileHubSettings: 'Settings',
    profileAttrPosition: 'Position',
    profileAttrFoot: 'Foot',
    profileAttrLevel: 'Level',
    profileAttrHeight: 'Height',
    profileAttrAge: 'Age',
    profileAttrPlays: 'Plays',
    fixtureLeaveCta: "I can't make it",
    leaveSheetHoursLabel: 'under 2 hours',
    fixtureRejoinCta: "Actually, I'm back in",
    fixtureOutBannerTitle: "YOU'RE OUT",
    fixtureOutBannerBody:
      "Your slot is open again. Nobody was told — if you want it covered, ask now rather than on the night.",
    fixtureOutBannerAsk: 'Find someone to take it',
    fixtureOutBannerAskKeeper: 'Ask the keeper pool',
    fixtureOwedNothing: 'You owe nothing for this one — you gave up your slot.',
    leaveSheetOrdinaryTitle: 'Give up your slot?',
    leaveSheetOrdinaryBody:
      "It opens for someone else straight away. {{organiser}} is not told automatically — the group finds out when they next look, so it's worth a message.",
    leaveSheetKeeperTitle: "You're one of the two keepers.",
    leaveSheetKeeperBody:
      'Outfield slots refill themselves. Keepers do not — it is the one position that stays empty. Line up a replacement and the match survives.',
    leaveSheetLateTitle: 'Kick-off is in {{hours}}.',
    leaveSheetLateBody:
      'The pitch is paid for whether you come or not. If nobody takes your slot this late, they play a man short.',
    leaveSheetKeeperLateTitle: 'You keep goal, and kick-off is in {{hours}}.',
    leaveSheetKeeperLateBody:
      'They are one keeper short the moment you go, with no time to find another. The pitch is paid for either way. Ask the pool before you drop.',
    leaveSheetGiveUp: 'Give up my slot',
    leaveSheetGiveUpAnyway: 'Give up my slot anyway',
    leaveSheetAskPool: 'Ask the keeper pool',
    leaveSheetAskReplacement: 'Ask for a replacement',
    leaveSheetStayIn: 'Stay in',
    leaveShareReplacement:
      "Can't make {{when}} at {{venue}} — my slot's open, someone take it: {{link}}",
    leaveShareReplacementKeeper: "⚽ Keeper needed — {{when}} · {{venue}}. Slot's open: {{link}}",
    profileInGoal: 'In goal',
    profileInGoalHint: 'Say yes and games near you that are short a keeper show up on Community. You play free when you take one.',
    profileInGoalFull: 'Whole game',
    profileInGoalRotation: '20–30 minutes',
    profileInGoalNo: 'Not for me',
    fixtureKeeperPost: 'Post to the keeper pool',
    fixtureKeeperPostRotation: 'Ask for 20 minutes instead',
    fixtureKeeperPosted: 'Posted · {{count}} players near you who go in goal can see it. The first to take it plays free.',
    fixtureKeeperPostedNone: 'Posted · nobody near you has said they go in goal yet. Ask on WhatsApp too.',
    fixtureKeeperPostedOne: 'Posted · 1 player near you who goes in goal can see it. The first to take it plays free.',
    fixtureKeeperPostedRotation: ' Twenty minutes asked.',
    fixtureKeeperWithdraw: 'Withdraw',
    fixtureKeeperAskWhatsapp: 'Ask on WhatsApp',
    fixtureKeeperError: "That didn't go through. Try again.",
    fixtureKeeperFreeTag: 'KEEPER · FREE',
    fixtureKeeperFreeShare: 'Free',
    fixtureKeeperFreeHint: 'You took the gloves from the keeper pool. The others split the pitch.',
    fixtureKeeperFreeNote: 'The keeper from the pool plays free.',
    communityKeepersLabel: 'Keepers wanted',
    communityKeeperWhole: 'whole game',
    communityKeeperRotation: '20 minutes',
    communityKeeperRecord: '{{back}} of {{played}} keepers would play for them again',
    communityKeeperClaim: "I'll go in goal",
    communityKeeperTaken: 'Someone got there first.',
    communityKeeperError: "That didn't go through. Try again.",
    keeperFeedbackOrganiserTitle: 'Did {{name}} turn up in goal?',
    keeperFeedbackBack: 'Would you have them back?',
    keeperFeedbackKeeperTitle: 'Would you keep goal for this team again?',
    keeperFeedbackYes: 'Yes',
    keeperFeedbackNo: 'No',
    keeperFeedbackHint: 'Just yes or no. It helps keepers find good teams, and teams find keepers who turn up.',
    keeperFeedbackThanks: "Thanks — it's on the record.",
    recordTitle: 'Recording',
    recordToggle: 'Record the game',
    recordHintOff: 'This court has a camera. Switch it on and the players on this booking can watch the whole match afterwards.',
    recordHintOn: 'Everyone who joins is told first. Only the players on this booking can watch it, for 30 days. Nothing is recorded while this is off.',
    recordMinor: 'A player under 18 is on this booking, so it is not recorded.',
    recordNotice: 'This game is recorded. Only the players on it can watch, for 30 days.',
    recordNoticeAsk: 'Rather not be filmed? Ask the organiser to switch it off before kickoff.',
    recordError: "That didn't go through. Try again.",
    matchTitle: 'The match',
    matchWatch: 'Watch the match',
    matchRecording: 'Recording now.',
    matchUploading: 'The camera is uploading the match. It will be here shortly.',
    matchFailed: "The camera didn't get this one.",
    matchDeleted: 'The organiser deleted the recording.',
    matchExpires: 'Kept until {{date}}.',
    matchDelete: 'Delete the recording',
    matchDeleteTitle: 'Delete the recording?',
    matchDeleteBody: 'It goes for everyone on the booking and cannot be brought back.',
    matchDeleteConfirm: 'Delete',
    matchCancel: 'Cancel',
    matchError: "That didn't go through. Try again.",
    leaveSheetFindReplacement: 'Find my replacement',
    leaveSheetReplaceTitle: "Can't make it?",
    leaveSheetFindReplacementNote:
      'You keep your seat until someone takes it. Your crew and the board see it straight away.',
    leaveSheetFindReplacementPaidNote:
      'You keep your seat until someone takes it. When they pay for it, your {{amount}} comes back to you.',
    leaveSheetLeaveRefund: 'Leave — {{amount}} comes back to you',
    leaveSheetLeaveNoRefund: 'Leave without a refund',
    fixtureReplacingTitle: 'LOOKING FOR YOUR REPLACEMENT',
    fixtureReplacingBody:
      'Your seat is yours until someone takes it. Your crew and the board can see it — share it with anyone who might play.',
    fixtureReplacingBodyPaid:
      'Your seat is yours until someone takes it. When they pay for it, your {{amount}} comes back to you.',
    fixtureReplacingShare: 'Share my seat',
    fixtureReplacingKeep: 'I can play after all',
    fixtureReplacingTag: "CAN'T MAKE IT",
    fixtureReplacementError: "That didn't go through. Try again in a moment.",
    fixtureRefreshError: "Couldn't refresh this game. Pull down to try again.",
    inviteSeatsToTake: 'Up for grabs: {{gk}} keeper · {{outfield}} outfield',
    inviteTakeSeat: 'Take the seat',
    inviteTakeSeatKeeper: "Take the keeper's seat",
    inviteTakeSeatPaid: 'Take the seat · {{amount}}',
    inviteTakeSeatGone: 'Someone just took that seat.',
    communityCrewLabel: 'From your crew',
    communityCrewSeat: 'a seat to take',
    communityCrewSeatKeeper: "the keeper's seat",



    bookingDetailVenue: 'Venue',
    bookingDetailWhen: 'When',
    bookingDetailAddons: 'Addons',
    bookingDetailTotal: 'Total paid',
    bookingDetailRefund: 'Refunded',
    bookingCancelCta: 'Cancel booking',
    bookingCancelling: 'Cancelling…',
    cancelConfirmTitle: 'Cancel this booking?',
    cancelConfirmBodyPending:
      "This booking hasn't been charged yet. Cancelling will release the slot for others.",
    cancelConfirmBodyWithRefund:
      "You'll be refunded €{{refund}} ({{percent}}% of €{{total}}). Refunds typically take 5–10 business days to appear on your card.",
    cancelConfirmBodyNoRefund:
      "Your booking is within the no-refund window for the venue's {{policy}} policy. Cancelling releases the slot but no money will be refunded.",
    cancelConfirmConfirm: 'Cancel booking',
    cancelConfirmDismiss: 'Keep booking',
    cancelPolicy: { standard: 'standard', strict: 'strict', flex: 'flex' },
    cancelErrorTitle: "Couldn't cancel",
    cancelErrorStripe: "Couldn't process your refund. Try again or contact support.",
    cancelErrorNetwork: 'No connection. Try again.',
    cancelErrorUnauthorized: 'Your session expired. Sign in again.',
    cancelErrorGeneric: 'Something went wrong. Try again.',
    cancelDismiss: 'OK',
    bookingState: {
      pending: 'Pending',
      collecting: 'Collecting',
      paid: 'Paid',
      confirmed: 'Confirmed',
      completed: 'Played',
      cancelled: 'Cancelled',
      refunded: 'Refunded',
      refunded_by_admin: 'Refunded by Ludi',
      cancelled_no_refund: 'Cancelled (no refund)',
    },
    verifyResendIn: 'Resend code in {{s}}',
    discoverEmptyTitle: 'No pitches in {{city}} yet',
    discoverEmptyBody: 'More cities are on the way — we start where the pitches are.',
    courtsOne: '1 court',
    courtsOther: '{{count}} courts',
    fromLabel: 'from',
    soldOutBadge: 'Fully booked',
    soldOutTitle: 'Nothing free on {{day}}',
    soldOutTryNext: 'Try {{day}} →',
    priceLinePitch: 'Pitch',
    checkoutHolding: 'Holding your slot…',
    checkoutConfirming: 'Confirming with the venue…',
    checkoutStillConfirmingTitle: 'Still confirming with your bank',
    checkoutStillConfirmingBody: 'Your card has not been charged twice.',
    checkoutFailNoCharge: 'No charge was made.',
    checkoutFailTitleSlot: 'That slot just went',
    checkoutFailTitlePitch: "This pitch can't be booked right now",
    checkoutFailTitleStripe: 'Your card was declined',
    checkoutFailTitleNetwork: 'No connection',
    checkoutFailTitleRateLimited: 'Too many attempts',
    checkoutFailTitleGeneric: 'Booking failed',
    checkoutTryAnotherCard: 'Try again',
    checkoutBackToPitch: 'Back to pitch',
    checkoutFromPitchTitle: 'Choose your slot first',
    checkoutFromPitchBody: 'Bookings start on the pitch page, where you see the time and the price.',
    checkoutOpenPitch: 'Open the pitch',
    addToCalendar: 'Add to calendar',
    shareBooking: 'Share',
    bookingsEmptyTitle: 'Nothing booked yet',
    bookingsEmptyBody: 'Find a pitch in Larnaca and book your first game.',
    bookingsFindPitch: 'Find a pitch',
    relTonight: 'Tonight',
    relTomorrow: 'Tomorrow',
    // CFA inside Ludi
    cfaEyebrow: 'CFA grassroots · {{day}}',
    cfaToday: 'Today',
    cfaNow: 'Now',
    cfaPostponed: 'Postponed',
    cfaCancelled: 'Cancelled',
    cfaTapTeam: "Tap your child's team to follow it.",
    cfaNoScores: 'No scores — CFA grassroots keeps none at these ages.',
    cfaFollowing: 'Following',
    cfaFollow: 'Follow the team',
    cfaFollowWhy: "You'll see its matches in Bookings, and we'll tell you when the programme is out, when a court or time changes, and an hour before kick-off.",
    cfaFollowPrivate: 'Nobody sees which teams you follow — not the venue, not other players.',
    cfaPlays: 'I play too',
    cfaPlaysHint: 'Ask me when parents set up a game here.',
    cfaUnfollow: 'Stop following',
    cfaFollowError: "Couldn't save that. Try again.",
    myTeamsSection: 'My teams',
    myTeamsAway: 'Away · {{venue}}',
    followedTeams: 'Teams you follow',
    followedTeamsNone: "None yet — follow a team from a venue's CFA Saturday.",
    cfaTodayEyebrow: 'Today · CFA grassroots',
    cfaTodayLine: '{{count}} matches · next kick-off {{time}}',
    cfaTodayDone: '{{count}} matches today',
    askParents: 'Ask the parents who play here',
    askParentsHint: 'Parents who follow a team here and said "I play too".',
    askParentsDone: 'Done — parents who said they play here will hear about it.',
    askParentsError: "Couldn't ask. Try again.",
  },
  gr: {
    appName: 'Ludi',
    discover: 'Ανακάλυψε',
    map: 'Χάρτης',
    matches: 'Αγώνες',
    bookings: 'Κρατήσεις',
    profile: 'Προφίλ',
    nearYou: 'Κοντά σου',
    tonight: 'Απόψε στην Κύπρο',
    popular: 'Δημοφιλή γήπεδα',
    searchPlaceholder: 'Αναζήτηση γηπέδων, συλλόγων, αγώνων',
    book: 'Κράτηση',
    joinMatch: 'Συμμετοχή',
    openSpots: 'ελεύθερες θέσεις',
    players: 'παίκτες',
    level: 'Επίπεδο',
    amenities: 'Παροχές',
    price: 'Τιμή',
    perHour: '/ώρα',
    bookNow: 'Κράτηση τώρα',
    selectTime: 'Επίλεξε ώρα',
    sendRequest: 'Αποστολή αιτήματος',
    openMatches: 'Ανοιχτοί αγώνες',
    skillMatched: 'Κατάλληλου επιπέδου',
    allMatches: 'Όλοι οι αγώνες',
    pitchesCount: 'γήπεδα',
    km: 'χλμ',
    min: 'λεπ',
    friends: 'Φίλοι',
    team: 'Η ομάδα μου',
    upcoming: 'Επερχόμενα',
    history: 'Ιστορικό',
    payWithCard: 'Πληρωμή με κάρτα',
    total: 'Σύνολο',
    summary: 'Περίληψη',
    pitchTypes: ['5x5', '7x7', '11x11'],
    surfaces: ['Συνθετικός', 'Γρασίδι', 'Εσωτερικός'],
    filters: ['Απόψε', '5x5', 'Εσωτερικός', 'Κάτω από €40'],
    cities: ['Λευκωσία', 'Λεμεσός', 'Λάρνακα', 'Πάφος', 'Αγία Νάπα'],
    days: ['Δευ', 'Τρί', 'Τετ', 'Πέμ', 'Παρ', 'Σάβ', 'Κυρ'],
    tabLabels: ['Ανακάλυψε', 'Χάρτης', 'Κοινότητα', 'Κρατήσεις', 'Προφίλ'],
    greet: 'Καλησπέρα',
    greetSub: 'Έτοιμος για απόψε;',
    greetMorning: 'Καλημέρα',
    greetSubMorning: 'Έτοιμος για σήμερα;',
    homeNextMatch: 'Επόμενο παιχνίδι',
    homePitchesSection: 'Γήπεδα',
    homeMapSection: 'Στον χάρτη',
    homeMapA11y: 'Χάρτης συνεργαζόμενων γηπέδων και ανοιχτών παιχνιδιών. Πάτησε μια πινέζα για να το ανοίξεις.',
    mapPinSpots: '{{time}} · {{count}} θέσεις',
    mapPinSpotsOne: '{{time}} · 1 θέση',
    mapPinKeeper: '{{time}} · ζητείται τερματοφύλακας',
    mapPinGames: '{{time}} · {{count}} παιχνίδια',
    homeTonightEmpty: 'Κανένα παιχνίδι απόψε ακόμα. Κλείσε γήπεδο και άνοιξέ το στην κοινότητα.',
    directions: 'Οδηγίες',
    profileGroundsTitle: 'Τα γήπεδά σου',
    profileGroundsGames: '{{count}} παιχνίδια',
    profileGroundsGamesOne: '1 παιχνίδι',
    profileGroundsLast: 'τελευταίο {{date}}',
    profileGroundsEmpty: 'Τα γήπεδά σου εμφανίζονται εδώ μόλις παίξεις.',
    profileGroundsA11y: 'Χάρτης με τα γήπεδα όπου έχεις παίξει. Πάτησε μια πινέζα για να ανοίξεις το γήπεδο.',
    langToggleA11y: 'Αλλαγή στα Αγγλικά',
    signinTitle: 'Σύνδεση',
    signinSubtitle: 'Θα σου στείλουμε 6ψήφιο κωδικό με SMS.',
    signinSubtitleEmail: 'Θα σου στείλουμε σύνδεσμο σύνδεσης με email.',
    signinPhoneLabel: 'Αριθμός τηλεφώνου',
    signinCta: 'Συνέχεια',
    signinOr: 'ή',
    signinAppleCta: 'Συνέχεια με Apple',
    signinGoogleCta: 'Συνέχεια με Google',
    signinMagicLinkCta: 'Συνέχεια με email',
    signinProviderUnavailable: 'Μη διαθέσιμο σε αυτήν τη συσκευή.',
    signinProviderNotConfigured: 'Δεν έχει ρυθμιστεί ακόμα.',
    verifyTitle: 'Εισαγωγή κωδικού',
    verifySubtitle: 'Στάλθηκε στο {{phone}}',
    verifyCodeLabel: 'Κωδικός επαλήθευσης',
    verifyCta: 'Επαλήθευση',
    verifyResend: 'Νέα αποστολή',
    verifyChangeNumber: 'Αλλαγή αριθμού',
    signOut: 'Αποσύνδεση',
    deleteAccountCta: 'Διαγραφή λογαριασμού',
    deleteAccountTitle: 'Διαγραφή του λογαριασμού σου;',
    deleteAccountBody:
      'Αυτό αφαιρεί οριστικά το προφίλ και τα προσωπικά σου στοιχεία και σε αποσυνδέει μόνιμα — δεν θα μπορείς να ξανασυνδεθείς. Οι προηγούμενες κρατήσεις διατηρούνται ανωνυμοποιημένες για όσο απαιτεί η κυπριακή φορολογική νομοθεσία, χωρίς τα προσωπικά σου στοιχεία. Αυτή η ενέργεια δεν αναιρείται.',
    deleteAccountConfirmCta: 'Διαγραφή του λογαριασμού μου',
    deleteAccountDeleting: 'Διαγραφή…',
    deleteAccountCancel: 'Άκυρο',
    deleteAccountError: 'Δεν ήταν δυνατή η διαγραφή του λογαριασμού. Δοκίμασε ξανά.',
    deleteAccountAppleNote:
      'Θα επιβεβαιώσεις ξανά με την Apple. Έτσι το Ludi αποσυνδέεται και από το Apple ID σου.',
    deleteAccountAppleMismatch:
      'Αυτό είναι άλλο Apple ID από αυτό που χρησιμοποιείς στο Ludi. Δοκίμασε ξανά με εκείνο.',
    errorInvalidPhone: 'Βάλε 8 ψηφία.',
    errorInvalidCode: 'Βάλε 6ψήφιο κωδικό.',
    errorAuthFailed: 'Ο κωδικός δεν δούλεψε. Δοκίμασε ξανά.',
    errorNetwork: 'Σφάλμα δικτύου. Δοκίμασε ξανά.',
    magicLinkTitle: 'Σύνδεση με email',
    magicLinkSubtitle: 'Θα σου στείλουμε σύνδεσμο ενός tap.',
    magicLinkEmailLabel: 'Διεύθυνση email',
    magicLinkCta: 'Αποστολή συνδέσμου',
    magicLinkSending: 'Αποστολή…',
    magicLinkSentTitle: 'Δες τα εισερχόμενά σου',
    magicLinkSentBody:
      'Στείλαμε σύνδεσμο στο {{email}}. Πάτα τον σε αυτό το τηλέφωνο μέσα σε 15 λεπτά για να συνδεθείς.',
    magicLinkSentCheckSpam: 'Δεν ήρθε; Δες τα ανεπιθύμητα ή δοκίμασε άλλο email.',
    magicLinkUseDifferent: 'Άλλο email',
    errorInvalidEmail: 'Βάλε έγκυρο email.',
    callbackTitle: 'Σε συνδέουμε…',
    callbackError: 'Δεν έγινε σύνδεση. Ο σύνδεσμος ίσως έληξε.',
    callbackNotRequested:
      'Ο σύνδεσμος δεν ζητήθηκε από αυτό το τηλέφωνο ή είναι πάνω από 15 λεπτά παλιός. Ζήτα νέο από εδώ.',
    callbackRetry: 'Πίσω στη σύνδεση',
    consentTitle: 'Καλώς ήρθες στο Ludi',
    consentSubtitle:
      'Πριν ξεκινήσουμε — η σύντομη εκδοχή του τι κρατάμε και γιατί. Η πλήρης πολιτική απορρήτου είναι ένα tap μακριά.',
    consentBulletIdentity:
      'Όνομα, τηλέφωνο ή email, πόλη — για να σε βρίσκουν συμπαίκτες και να επιβεβαιώνονται οι κρατήσεις σου.',
    consentBulletBookings:
      'Ιστορικό κρατήσεων (ποιο γήπεδο, πότε, με ποιους) — για να βλέπεις παλιά παιχνίδια και να γίνονται επιστροφές χρημάτων.',
    consentBulletPayments:
      'Αναφορές πληρωμών μέσω Stripe (ποτέ ο αριθμός κάρτας) — για συμφωνία χρεώσεων και πληρωμών.',
    consentBulletCrashes:
      'Αναφορές σφαλμάτων χωρίς προσωπικά στοιχεία — για να διορθώνουμε ό,τι χαλάει.',
    analyticsChoiceLabel: 'Κοινοποίηση ανώνυμων στατιστικών χρήσης',
    consentAnalyticsHint:
      'Προαιρετικό. Ποιες οθόνες και ποια βήματα χρησιμοποιούνται, ποτέ το όνομα, ο αριθμός ή τα μηνύματά σου. Κλειστό εκτός αν το ανοίξεις· το αλλάζεις όποτε θέλεις στις Ρυθμίσεις.',
    settingsAnalyticsHint:
      'Ανώνυμα στατιστικά για το ποιες οθόνες και ποια βήματα χρησιμοποιούνται. Κλειστό σημαίνει ότι δεν στέλνεται τίποτα.',
    settingsNotifyTitle: 'Ειδοποιήσεις',
    settingsNotifyGames: 'Τα παιχνίδια σου',
    settingsNotifyGamesHint: 'Επιβεβαίωση, δύο ώρες πριν τη σέντρα, ακύρωση, το πρωί μετά από παιχνίδι που οργάνωσες — και οι ομάδες που ακολουθείς.',
    settingsScreensTitle: 'Οθόνες γηπέδων',
    settingsScreensName: 'Να φαίνεται το μικρό μου όνομα',
    settingsScreensNameHint: 'Τη μέρα του παιχνιδιού που έκλεισες, η οθόνη στην είσοδο του γηπέδου δείχνει το μικρό σου όνομα δίπλα στο γήπεδό σου. Ποτέ το επώνυμο ή το τηλέφωνό σου.',
    settingsNotifyAsks: 'Αιτήματα',
    settingsNotifyAsksHint: 'Ζητείται τερματοφύλακας εκεί που μπαίνεις στο τέρμα, μια θέση σε παρέα που παίζεις, παιχνίδι γονιών εκεί που είπες ότι παίζεις.',
    settingsNotifyOsOff: 'Οι ειδοποιήσεις του Ludi είναι κλειστές σε αυτό το τηλέφωνο — άνοιξε τις Ρυθμίσεις για να τις επιτρέψεις.',
    settingsHelp: 'Βοήθεια',
    settingsHelpHint: 'Γράψε στο hello@ludi.football — κάθε μήνυμα το διαβάζει άνθρωπος.',
    helpMailSubject: 'Ludi — βοήθεια',
    signinHelp: 'Δεν μπορείς να συνδεθείς; hello@ludi.football',
    updateTitle: 'Ενημέρωσε το Ludi',
    updateBody:
      'Αυτή η έκδοση του Ludi αποσύρθηκε. Κάνε ενημέρωση για να συνεχίσεις — ο λογαριασμός, τα παιχνίδια και η κάρτα σου μένουν ακριβώς όπως είναι.',
    updateCta: 'Ενημέρωση',
    consentResidency:
      'Τα δεδομένα φιλοξενούνται στην ΕΕ (Φραγκφούρτη) και δεν πωλούνται ποτέ. Μπορείς να διαγράψεις τον λογαριασμό σου ανά πάσα στιγμή από τις Ρυθμίσεις (το γρανάζι στο προφίλ σου).',
    consentReadPolicy: 'Διάβασε την πλήρη πολιτική απορρήτου →',
    consentAcceptCta: 'Συνέχεια',
    profileEditTitle: 'Το προφίλ σου',
    profileFirstName: 'Όνομα',
    profileLastName: 'Επώνυμο',
    profileLanguage: 'Γλώσσα',
    profileLanguageEn: 'English',
    profileLanguageEl: 'Ελληνικά',
    profileHomeCity: 'Πόλη',
    profileSkill: 'Επίπεδο',
    profilePositions: 'Θέσεις',
    profilePositionsHint: 'Πάτα όλες τις θέσεις που παίζεις.',
    profileFoot: 'Πόδι',
    profileFootLeft: 'Αριστερό',
    profileFootRight: 'Δεξί',
    profileFootBoth: 'Και τα δύο',
    profileHeight: 'Ύψος',
    profileHeightHint: 'Σε εκατοστά (προαιρετικό)',
    profileHeightInvalid: 'Το ύψος πρέπει να είναι 120–230 εκ.',
    profileHeightEmpty: 'Πρόσθεσε ύψος',
    profileHeightClear: 'Καθαρισμός',
    profileHeightChange: 'Αλλαγή',
    profileHeightDone: 'Έτοιμο',
    profileAge: 'Ηλικία',
    profilePlayFrequency: 'Πόσο συχνά παίζεις',
    profilePlayFrequencyCasual: 'Περιστασιακά',
    profilePlayFrequencyWeekly: 'Κάθε εβδομάδα',
    profilePlayFrequencyOften: 'Πολλές φορές την εβδομάδα',
    profileSkillTier1: 'Ξεκινάς τώρα στο οργανωμένο ποδόσφαιρο',
    profileSkillTier2: 'Χαλαρά — πού και πού μια μπάλα',
    profileSkillTier3: 'Τακτικά — παίζεις συχνά τοπικά',
    profileSkillTier4: 'Έμπειρος — πρωτάθλημα ή ανταγωνιστικό υπόβαθρο',
    profileSkillTier5: 'Προχωρημένος — υψηλό ανταγωνιστικό επίπεδο',
    playerCardViewCta: 'Δες την κάρτα μου',
    playerCardMemberSince: 'Μέλος από {{when}}',
    playerCardVerified: 'Επαληθευμένος',
    playerCardReputationTitle: 'Φήμη',
    playerCardReputationEmpty:
      'Χτίζεται καθώς παίζεις. Η αξιοπιστία, οι βαθμολογίες και το ιστορικό αγώνων εμφανίζονται εδώ μόλις αρχίσεις να παίζεις.',
    playerCardReliability: 'Αξιοπιστία',
    playerCardMatchesPlayed: 'Αγώνες',
    playerCardRatings: 'Βαθμολογίες',
    playerCardNewPlayer: 'Νέος παίκτης',
    playerCardNotSet: 'Δεν έχει οριστεί',
    playerCardDetails: 'Στοιχεία',
    playerCardReputationEarnedShort: 'Χτίζεται καθώς παίζεις',
    playerCardMemberLabel: 'Μέλος',
    playerCardReputationNote: 'Χτίζεται καθώς παίζεις — με αληθινά παιχνίδια.',
    playerCardFootShort: 'Πόδι',
    playerCardAddToWallet: 'Προσθήκη στο Apple Wallet',
    playerCardLevel: 'Επίπεδο',
    playerCardLevelA11y: 'Επίπεδο {{n}} από 5, {{tier}}',
    playerCardPlays: 'Παίζει',
    playerCardAlsoPlays: 'Παίζει και {{list}}',
    playerCardSince: 'από {{when}}',
    playerCardMatches: '{{count}} παιχνίδια',
    playerCardMatchesOne: '1 παιχνίδι',
    playerCardFillsIn: 'Η κάρτα γεμίζει όσο παίζει.',
    playerCardFillsInAnon: 'Η κάρτα γεμίζει με κάθε παιχνίδι.',
    playerCardBackHint: 'Ιστορικό και QR στην πίσω όψη',
    playerCardShowBack: 'Πίσω όψη',
    playerCardShowFront: 'Μπροστινή όψη',
    playerCardPosition: 'Θέση',
    playerCardPositionNotSet: 'Χωρίς θέση',
    playerCardPitchA11y: 'Παίζει {{list}}',
    playerCardRecordTitle: 'Το ιστορικό',
    playerCardFirstMatch: 'Το πρώτο ματς έρχεται',
    playerCardRecordPrivate: 'Το ιστορικό αγώνων είναι ιδιωτικό προς το παρόν.',
    playerCardLockedTitle: 'Αξιοπιστία · Βαθμολογίες',
    playerCardScanToJoin: 'Σκάναρε και έλα στο Ludi',
    playerCardScanToJoinAnon: 'Σκάναρε και έλα στο Ludi',
    playerCardQrA11y: 'Κωδικός QR προς το ludi.football',
    playerCardFreqCasual: 'Περιστασιακά',
    playerCardFreqWeekly: 'Κάθε εβδομάδα',
    playerCardFreqOften: '2+ τη βδομάδα',
    skillTierName1: 'Αρχάριο',
    skillTierName2: 'Χαλαρό',
    skillTierName3: 'Τακτικό',
    skillTierName4: 'Έμπειρο',
    skillTierName5: 'Προχωρημένο',
    skillTierDesc1: 'Ξεκινά τώρα στο οργανωμένο ποδόσφαιρο',
    skillTierDesc2: 'Πού και πού μια μπάλα',
    skillTierDesc3: 'Παίζει συχνά τοπικά',
    skillTierDesc4: 'Πρωτάθλημα ή ανταγωνιστικό υπόβαθρο',
    skillTierDesc5: 'Υψηλό ανταγωνιστικό επίπεδο',
    positionNameGK: 'Τερματοφύλακας',
    positionNameCB: 'Κεντρικός αμυντικός',
    positionNameLB: 'Αριστερός μπακ',
    positionNameRB: 'Δεξιός μπακ',
    positionNameCDM: 'Αμυντικός μέσος',
    positionNameCM: 'Κεντρικός μέσος',
    positionNameCAM: 'Επιθετικός μέσος',
    positionNameLW: 'Αριστερό εξτρέμ',
    positionNameRW: 'Δεξί εξτρέμ',
    positionNameST: 'Επιθετικός',
    profileSaveCta: 'Αποθήκευση',
    profileSaving: 'Αποθήκευση…',
    profileSaved: 'Αποθηκεύτηκε.',
    profileLoading: 'Φόρτωση προφίλ…',
    profileLoadError: 'Δεν φόρτωσε το προφίλ.',
    mapEmptyTitle: 'Γήπεδα στον χάρτη',
    mapEmptyBody:
      'Σύντομα θα βλέπεις εδώ κάθε γήπεδο της Λάρνακας και θα διαλέγεις το πιο κοντινό. Μέχρι τότε, είναι όλα στην Ανακάλυψη.',
    mapEmptyCta: 'Δες τα γήπεδα',
    profilePublicTitle: 'Δημόσια κάρτα παίκτη',
    profilePublicBody:
      'Δημοσιεύει μια σελίδα στο ludi.football/p/ με το μικρό σου όνομα, τη θέση, το πόδι, την πόλη και το επίπεδό σου. Μπορεί να τη δει οποιοσδήποτε, και οι μηχανές αναζήτησης.',
    profilePublicOn: 'Δημόσιο',
    profilePublicOff: 'Ιδιωτικό',
    profilePublicNote:
      'Είναι κλειστό αν δεν το ανοίξεις εσύ. Μπορείς να το κλείσεις ανά πάσα στιγμή — σταματάμε να εμφανίζουμε τη σελίδα, αλλά δεν μπορούμε να ανακαλέσουμε αντίγραφα που έχουν ήδη κοινοποιήσει άλλοι.',
    profileErrorRequired: 'Όνομα και επώνυμο είναι υποχρεωτικά.',
    profileErrorSaveFailed: 'Δεν αποθηκεύτηκε. Δοκίμασε ξανά.',
    profileHubEditRow: 'Επεξεργασία προφίλ',
    profileHubEditRowHint: 'Όνομα, θέσεις, ύψος, ορατότητα',
    profileHubCompleteTitle: 'Συμπλήρωσε την κάρτα σου',
    profileHubCompleteBody:
      '{{done}} από {{total}} στοιχεία συμπληρωμένα — μια πλήρης κάρτα δείχνει καλύτερα στους άλλους παίκτες.',
    discoverLoading: 'Φόρτωση γηπέδων…',
    discoverEmpty: 'Δεν υπάρχουν γήπεδα ακόμη.',
    discoverError: 'Δεν φόρτωσαν τα γήπεδα.',
    discoverRetry: 'Δοκίμασε ξανά',
    pitchDetailError: 'Δεν φόρτωσε το γήπεδο.',
    pitchOpenInMaps: 'Άνοιγμα σε Χάρτες',
    pitchAvailability: 'Διαθεσιμότητα',
    pitchClosedToday: 'Κλειστό αυτή τη μέρα.',
    bookCta: 'Κράτηση €{{total}}',
    bookCtaPickSlot: 'Διάλεξε ώρα',
    addonsTitle: 'Extras',
    addonsNote: 'Προαιρετικά. Χρειάζεσαι διακριτικά ή μπάλα; Το γήπεδο τα έχει — πρόσθεσε ό,τι θέλεις.',
    addonBibs: 'Διακριτικά',
    addonBibsUnit: '€5 / σετ',
    addonBallRental: 'Μπάλα',
    addonBallRentalUnit: '€3 / τεμ',
    bookingProcessing: 'Επιβεβαιώνεται η κράτηση…',
    bookingTakingLong: 'Η πληρωμή καθυστερεί λίγο.',
    bookingCheckStatus: 'Έλεγχος κατάστασης',
    bookingConfirmed: 'Έγινε.',
    bookingPaid: 'Πληρώθηκε.',
    joinedTitle: 'Είσαι μέσα.',
    joinedSquadCta: 'Δες την ομάδα',
    bookingSettlingSlowTitle: 'Το γήπεδο δεν έχει επιβεβαιώσει ακόμη',
    bookingSettlingSlowBody: 'Η πληρωμή σου πέρασε και δεν χρεώθηκες δύο φορές. Γίνεται κράτησή σου μόλις επιβεβαιώσει το γήπεδο.',
    bookingCode: 'Κωδικός κράτησης',
    bookingDone: 'Τέλος',
    errorSlotTaken: 'Μόλις πιάστηκε — διάλεξε άλλη ώρα.',
    errorPitchUnbookable: 'Το γήπεδο δεν δέχεται κρατήσεις τώρα.',
    errorPaymentDeclined: 'Η κάρτα απορρίφθηκε. Δοκίμασε άλλη.',
    errorPaymentService: 'Η υπηρεσία πληρωμών δεν είναι διαθέσιμη. Δοκίμασε ξανά.',
    errorRateLimited: 'Πολλές προσπάθειες. Περίμενε ένα λεπτό.',
    errorBookingGeneric: 'Η κράτηση δεν ολοκληρώθηκε.',
    errorMissingParams: 'Λείπουν στοιχεία κράτησης. Διάλεξε ώρα και δοκίμασε ξανά.',
    bookingRetry: 'Δοκίμασε ξανά',
    bookingsUpcoming: 'Επόμενες',
    bookingsHistory: 'Ιστορικό',
    bookingsEmptyUpcoming: 'Δεν έχεις επόμενες κρατήσεις.',
    bookingsEmptyHistory: 'Δεν υπάρχουν παλιότερες κρατήσεις.',
    bookingsLoading: 'Φόρτωση κρατήσεων…',
    bookingsError: 'Δεν φόρτωσαν οι κρατήσεις.',
    bookingsRefresh: 'Ανανέωση',
    bookingDetailTitle: 'Κράτηση',
    fixtureEyebrowOrganiser: 'Ο ΑΓΩΝΑΣ ΣΟΥ',
    fixtureEyebrowIn: 'ΕΙΣΑΙ ΜΕΣΑ',
    fixtureEyebrowPlayed: 'ΠΑΙΧΤΗΚΕ',
    fixtureSquad: 'Ομάδα',
    fixtureSquadOf: '{{filled}} / {{total}}',
    fixtureSquadPlayed: 'έπαιξαν {{filled}}',
    fixtureSquadWereIn: 'ήταν {{filled}}',
    fixtureKeepers: 'Τερματοφύλακες',
    bookingsRowSquad: '{{filled}}/{{total}}',
    bookingsRowKeeperNeeded: 'χρειάζεται τερματοφύλακας',
    fixtureOutfield: 'Παίκτες',
    fixtureSlotOpen: 'Ελεύθερο',
    fixtureSlotKeeper: 'Τερματοφύλακας',
    fixtureSlotMoreOpen: '+{{count}} ελεύθερα',
    fixtureOrganiserTag: 'ΔΙΟΡΓΑΝΩΤΗΣ',
    fixtureYou: 'Εσύ',
    fixtureKeeperNoneTitle: 'ΧΩΡΙΣ ΤΕΡΜΑΤΟΦΥΛΑΚΑ',
    fixtureKeeperNoneBody:
      'Κανείς στο τέρμα ακόμη. Οι θέσεις παικτών γεμίζουν μόνες τους — αυτή όχι.',
    fixtureKeeperShortBody: 'Λείπει ένας, στη θέση που δεν γεμίζει μόνη της.',
    fixtureKeeperAsk: 'Ζήτα τερματοφύλακα',
    fixtureInviteCta: 'Κάλεσε την ομάδα σου',
    fixtureInviteMore: 'Κάλεσε {{count}} ακόμη',
    fixtureInviteHint: 'Ένας σύνδεσμος στο group. Όποιος τον ανοίξει πιάνει θέση.',
    fixtureCompleteTitle: 'Η ΟΜΑΔΑ ΣΥΜΠΛΗΡΩΘΗΚΕ',
    fixtureCompleteBody: 'Όλοι μέσα, και οι δύο τερματοφύλακες. Δεν μένει τίποτα.',
    fixtureSendDetails: 'Στείλε τις λεπτομέρειες',
    fixtureCancelledTitle: 'ΑΚΥΡΩΘΗΚΕ',
    fixtureCancelledBody:
      'Δεν ειδοποιείται κανείς αυτόματα ακόμη — από εδώ θα το μάθουν. Στείλε μήνυμα στο group.',
    fixtureRebook: "Κλείσ'το ξανά",
    fixtureRebookHint: 'Ίδιο γήπεδο, ίδια ώρα την επόμενη βδομάδα — η ομάδα μεταφέρεται ως προσκλήσεις.',
    fixtureSplitsTo: 'ΑΝΑΛΟΓΕΙ',
    fixtureAskEachFor: 'ΖΗΤΑ ΑΠΟ ΤΟΝ ΚΑΘΕΝΑ',
    fixtureYourShare: 'ΤΟ ΜΕΡΙΔΙΟ ΣΟΥ',
    fixtureOwedToYou: 'ΣΟΥ ΧΡΩΣΤΑΕΙ Ο ΚΑΘΕΝΑΣ',
    fixtureYouOwe: 'ΧΡΩΣΤΑΣ ΣΤΟΝ/ΣΤΗΝ {{name}}',
    fixtureEachOnceFull: 'ο καθένας, όταν μπουν και οι {{total}}',
    fixtureAtNIn: 'με {{filled}} μέσα',
    fixtureIfAllCome: '{{amount}} αν έρθουν και οι {{total}}',
    fixtureSettleHint: 'Πλήρωσες εσύ · τακτοποιήστε το μεταξύ σας προς το παρόν',
    fixtureSettleHintTeammate:
      'Πλήρωσε ο/η {{name}} · τακτοποιήστε το μεταξύ σας προς το παρόν',
    checkoutFailTitleSplitLate: 'Πολύ κοντά στη σέντρα για μοίρασμα',
    splitTitle: 'Μοιράσου το κόστος',
    splitToggleLabel: 'Ο καθένας πληρώνει το μερίδιό του',
    splitTooLateHint: 'Πολύ κοντά στη σέντρα για να μαζευτούν μερίδια — κλείσε το ολόκληρο και τα βρίσκετε μεταξύ σας.',
    splitOnHint:
      '{{share}} το άτομο σε {{slots}} θέσεις. Πληρώνεις το δικό σου τώρα· ο σύνδεσμος μαζεύει τα υπόλοιπα. Όλοι πληρώνουν έως 24 ώρες πριν τη σέντρα, αλλιώς καλύπτεις τη διαφορά.',
    splitOffHint: 'Πληρώνεις όλη την κράτηση τώρα και τα βρίσκετε μεταξύ σας.',
    inviteShareLine: '{{amount}} το άτομο — πληρώνεις όταν πιάσεις θέση',
    inviteClaimClosed: 'Το παράθυρο πληρωμής για αυτό το ματς έκλεισε.',
    inviteClaimPayLater: 'Η θέση σου κρατιέται για λίγα λεπτά — πάτησε ξανά για να ολοκληρώσεις την πληρωμή.',
    fixtureCollectingTitle: 'Μαζεύονται · {{paid}}/{{filled}} πλήρωσαν',
    fixtureCollectingBody: 'Όλοι πληρώνουν το μερίδιό τους έως {{when}}, αλλιώς το ματς ακυρώνεται.',
    fixtureCollectingLateTitle: 'Τέλος χρόνου',
    fixtureCollectingLateOrganiser:
      'Η προθεσμία πέρασε με μερίδια να λείπουν. Κάλυψε τα υπόλοιπα τώρα, αλλιώς το ματς ακυρώνεται και όλοι παίρνουν τα λεφτά τους πίσω.',
    fixtureCollectingLateTeammate:
      'Η προθεσμία πέρασε με μερίδια να λείπουν. Ο/η {{name}} μπορεί ακόμα να καλύψει τα υπόλοιπα — αλλιώς ακυρώνεται και όλοι παίρνουν τα λεφτά τους πίσω.',
    fixturePayShare: 'Πλήρωσε το μερίδιό σου · {{amount}}',
    fixtureCoverCta: 'Κάλυψε τα υπόλοιπα',
    fixtureShareEach: 'Κάθε θέση πληρώνει',
    fixtureSharesPaid: '{{paid}}/{{filled}} πλήρωσαν',
    fixtureSharesSettled: 'όλα τακτοποιημένα',
    fixtureSplitHint: 'Πληρωμή μέσα στην εφαρμογή — κανείς δεν κυνηγά κανέναν.',
    fixtureSplitTotal: 'Σύνολο γηπέδου',
    fixturePaidTag: 'ΠΛΗΡΩΣΕ',
    fixtureUnpaidTag: 'ΕΚΚΡΕΜΕΙ',
    rosterSheetRoleKeeper: 'Στο τέρμα',
    rosterSheetRoleOutfield: 'Στο γήπεδο',
    rosterSheetTogether: '{{count}} ματς μαζί',
    rosterSheetTogetherOne: 'Ένα ματς μαζί',
    rosterSheetTogetherNone: 'Πρώτο ματς μαζί',
    rosterSheetTogetherLabel: 'ματς μαζί',
    rosterSheetTogetherLabelOne: 'ματς μαζί',
    rosterSheetJoined: 'Μπήκε {{when}}',
    rosterSheetLeft: 'Έφυγε {{when}}',
    rosterSheetEmpty: 'Δεν έχει συμπληρώσει ακόμα την κάρτα του.',
    rosterSheetYouEmpty: 'Η κάρτα σου είναι άδεια — συμπλήρωσέ την και η ομάδα ξέρει τι παίζεις.',
    rosterSheetClose: 'Κλείσιμο',
    rosterOpenSheetTitleKeeper: 'Ζητείται τερματοφύλακας',
    rosterOpenSheetTitleOutfield: 'Ελεύθερη θέση',
    rosterOpenSheetBodyKeeper:
      'Η μόνη θέση που μένει άδεια. Στείλε το λινκ σε κάποιον που μπαίνει τέρμα.',
    rosterOpenSheetBody: 'Στείλε το λινκ και όποιος το πατήσει πρώτος παίρνει τη θέση.',
    fixtureDroppedTitle: 'ΑΠΟΧΩΡΗΣΑΝ {{count}}',
    fixtureDroppedBody: 'Ήταν μέσα και άφησαν τη θέση. Είναι ξανά ελεύθερη.',
    fixtureInviteTeammate: 'Φέρε κάποιον',
    cancelConfirmBodyCollecting:
      'Το ματς ακόμα μαζεύει μερίδια. Η ακύρωση το ματαιώνει και όσοι πλήρωσαν παίρνουν πλήρη επιστροφή.',
    fixtureRefund: 'ΕΠΙΣΤΡΟΦΗ',
    fixtureRefundOf: 'από {{total}} · πολιτική {{policy}}',
    fixtureIn: 'σε {{count}} μέρες',
    fixtureTonight: 'απόψε',
    fixtureTomorrow: 'αύριο',
    fixtureAgo: 'πριν {{count}} μέρες',
    fixtureAgoOne: 'χθες',
    fixtureShareInvite: '⚽ {{when}}\n{{venue}}\nΜας λείπουν {{short}}. Πιάσε θέση: {{link}}',
    fixtureShareDetails:
      '⚽ {{when}}\n{{venue}}\nΗ ομάδα συμπληρώθηκε — {{keepers}} στο τέρμα.\n{{each}} ο καθένας στον/στην {{organiser}}.',
    fixturePaidByYou: 'Πλήρωσες',
    fixturePaidByThem: 'Πλήρωσε ο/η {{name}}',
    fixturePitchLine: 'Γήπεδο',
    bookingConfirmedRosterCta: 'Πρόσθεσε την ομάδα σου',
    inviteLoading: 'Φόρτωση πρόσκλησης…',
    inviteNotFound: 'Αυτός ο σύνδεσμος δεν είναι σωστός',
    inviteNotFoundBody: 'Ζήτα καινούριο από όποιον σου τον έστειλε.',
    inviteExitCta: 'Βρες παιχνίδι στο Ludi',
    inviteEnded: 'Αυτό έχει ήδη παιχτεί',
    inviteEndedBody: 'Η ώρα έναρξης πέρασε, δεν μένει τίποτα να μπεις.',
    inviteFull: 'Η ομάδα είναι πλήρης',
    inviteFullBody: 'Δεν έμεινε θέση. Ρώτα τον διοργανωτή αν αλλάξουν τα σχέδια.',
    inviteHeading: 'Είσαι καλεσμένος/η',
    inviteSpotsOpen: '{{gk}} τερματοφύλακας · {{outfield}} θέσεις παικτών',
    inviteKeeperUrgent: 'Λείπει τερματοφύλακας',
    inviteSignInCta: 'Σύνδεση για να πιάσεις θέση',
    inviteJoinAsKeeper: 'Πιάσε τη θέση τερματοφύλακα',
    inviteJoinAsOutfield: 'Μπες ως παίκτης',
    inviteJoinAsOutfieldOnly: 'Πιάσε θέση',
    inviteAlreadyJoined: 'Είσαι ήδη μέσα',
    inviteGoToFixture: 'Πήγαινε στον αγώνα',
    inviteJoinErrorTitle: 'Δεν έγινε',
    inviteJoinErrorFull: 'Η θέση μόλις γέμισε.',
    inviteJoinErrorEnded: 'Δεν μπορείς πλέον να μπεις σε αυτόν τον αγώνα.',
    inviteJoinErrorInvalid: 'Αυτός ο σύνδεσμος δεν ισχύει πια.',
    inviteJoinErrorGeneric: 'Κάτι πήγε στραβά. Δοκίμασε ξανά.',
    inviteJoinErrorDismiss: 'Εντάξει',
    communityTitle: 'Κοινότητα',
    communityIntro: 'Παιχνίδια σε όλη την Κύπρο με θέση ανοιχτή για σένα',
    communityEmptyTitle: 'Τίποτα ανοιχτό αυτή τη στιγμή.',
    communityEmptyBody: 'Κλείσε γήπεδο, άνοιξέ το στην κοινότητα, και εμφανίζεται εδώ για όλους.',
    communityEmptyCta: 'Βρες γήπεδο',
    communityError: 'Ο πίνακας δεν φορτώθηκε.',
    fixtureOpenToggleTitle: 'Άνοιξέ το στην κοινότητα',
    fixtureOpenToggleBody:
      'Εμφανίζει το παιχνίδι στην καρτέλα Κοινότητα, στην οθόνη του χώρου και στη σελίδα του στο ludi.football, ώστε κάθε παίκτης να πιάσει μια ανοιχτή θέση. Τα ονόματα μένουν κρυφά — φαίνεται μόνο πότε, πού και τι χρειάζεσαι.',
    fixtureOpenToggleOnTag: 'στον πίνακα',
    communityFilterKeeper: 'Λείπει τερματοφύλακας',
    communityFilterWeekend: 'Το Σαββατοκύριακο',
    communityFilterNone: 'Τίποτα δεν ταιριάζει με αυτά τα φίλτρα',
    communityOpenSpotsOne: '1 θέση ανοιχτή για σένα',
    communityOpenSpotsMany: '{{count}} θέσεις ανοιχτές για σένα',
    communityKeepersOne: '1 χρειάζεται τερματοφύλακα',
    communityKeepersMany: '{{count}} χρειάζονται τερματοφύλακα',
    communityShareShort: '{{amount}} το άτομο',
    communitySpotsShort: '{{gk}} GK · {{outfield}} παίκτες',
    communityShelfLabel: 'Εξερεύνησε',
    communityWeekMatches: 'Παιχνίδια αυτή την εβδομάδα',
    communityWeekPlayers: 'Παίκτες σε ρόστερ',
    communityWaTitle: 'Ludi {{city}} στο WhatsApp',
    communityWaBody: 'Τα ανοιχτά παιχνίδια πέφτουν πρώτα εδώ — μόνο links, χωρίς φλυαρία.',
    communityWaCta: 'Μπες στην ομάδα',
    communityCreateCta: 'Άνοιξε παιχνίδι',
    communityKeeperTitle: 'Οι τερματοφύλακες είναι χρυσάφι',
    communityKeeperBody: 'Η μία θέση που λείπει από κάθε παιχνίδι.',
    communityKeeperCtaFilter: 'Δες ποιοι ψάχνουν',
    communityKeeperCtaPool: 'Μπες στο keeper pool',
    communityPerHead: '≈{{amount}} το άτομο αν γεμίσει',
    communityYoursLabel: 'Δικά σου',
    communityYoursHosting: 'Οργανώνεις',
    communityYoursJoined: 'Μέσα',
    communityYoursShortOne: 'λείπει 1',
    communityYoursShortMany: 'λείπουν {{count}}',
    communityYoursKeeper: 'θέλει τερματοφύλακα',
    communityYoursShare: 'Μοιράσου το link πρόσκλησης',
    communityYoursMore: 'Άλλα {{count}} στις Κρατήσεις',
    communitySpotsLabel: 'θέσεις',
    communityLastSpot: 'τελευταία θέση',
    communityPlayedWithOne: 'Έχεις παίξει με 1 από αυτούς',
    communityPlayedWithMany: 'Έχεις παίξει με {{count}} από αυτούς',
    communitySeriesLine: 'Κάθε {{day}} από τον {{month}}',
    communitySeriesLineYear: 'Κάθε {{day}} από τον {{month}} του {{year}}',
    communitySeriesLabel: 'Τα σταθερά σου',
    communitySeriesSlot: '{{weekday}}, {{time}}',
    communitySeriesPlayed: 'παιχνίδια',
    communitySeriesNext: 'Επόμενο {{when}}',
    levelCasual: 'Χαλαρό',
    levelCompetitive: 'Ανταγωνιστικό',
    fixtureOpenLevelHint: 'Τι παιχνίδι είναι;',
    profileRecordMatches: 'Παιχνίδια',
    profileRecordTeammates: 'Συμπαίκτες',
    profileRecordVenues: 'Γήπεδα',
    profileNameFallback: 'Το όνομά σου',
    profileHubPlayerSection: 'Παίκτης',
    profileHubFormSection: 'Φόρμα',
    profileHubFormEmpty: 'Το πρώτο σου παιχνίδι θα φανεί εδώ.',
    profileHubSeeAll: 'Όλα',
    profileHubAddAttribute: 'Πρόσθεσε',
    profileHubCardRow: 'Η κάρτα παίκτη σου',
    profileHubCardRowHint: 'Δείξ’ την, μοιράσου την, βάλ’ την στο Wallet',
    profileHubSettings: 'Ρυθμίσεις',
    profileAttrPosition: 'Θέση',
    profileAttrFoot: 'Πόδι',
    profileAttrLevel: 'Επίπεδο',
    profileAttrHeight: 'Ύψος',
    profileAttrAge: 'Ηλικία',
    profileAttrPlays: 'Παίζει',
    fixtureLeaveCta: 'Δεν μπορώ να έρθω',
    leaveSheetHoursLabel: 'λιγότερο από 2 ώρες',
    fixtureRejoinCta: 'Τελικά είμαι μέσα',
    fixtureOutBannerTitle: 'ΕΙΣΑΙ ΕΞΩ',
    fixtureOutBannerBody:
      'Η θέση σου άνοιξε ξανά. Δεν ειδοποιήθηκε κανείς — αν θες να καλυφθεί, ζήτα τώρα κι όχι το βράδυ.',
    fixtureOutBannerAsk: 'Βρες αντικαταστάτη',
    fixtureOutBannerAskKeeper: 'Ζήτα τερματοφύλακα',
    fixtureOwedNothing: 'Δεν χρωστάς τίποτα γι\' αυτό — παράτησες τη θέση σου.',
    leaveSheetOrdinaryTitle: 'Να παρατήσεις τη θέση σου;',
    leaveSheetOrdinaryBody:
      'Ανοίγει αμέσως για κάποιον άλλο. Ο/Η {{organiser}} δεν ειδοποιείται αυτόματα — η ομάδα το μαθαίνει όταν κοιτάξει ξανά, αξίζει ένα μήνυμα.',
    leaveSheetKeeperTitle: 'Είσαι ένας από τους δύο τερματοφύλακες.',
    leaveSheetKeeperBody:
      'Οι θέσεις παικτών γεμίζουν μόνες τους. Οι τερματοφύλακες όχι — είναι η μόνη θέση που μένει άδεια. Βρες αντικαταστάτη και ο αγώνας σώζεται.',
    leaveSheetLateTitle: 'Η έναρξη είναι σε {{hours}}.',
    leaveSheetLateBody:
      'Το γήπεδο είναι πληρωμένο είτε έρθεις είτε όχι. Αν δεν καλυφθεί η θέση τόσο αργά, θα παίξουν λειψοί.',
    leaveSheetKeeperLateTitle: 'Κρατάς τέρμα, και η έναρξη είναι σε {{hours}}.',
    leaveSheetKeeperLateBody:
      'Μένουν χωρίς τερματοφύλακα τη στιγμή που φεύγεις, χωρίς χρόνο να βρουν άλλον. Το γήπεδο είναι πληρωμένο όπως και να \'χει. Ρώτα πρώτα τον πούλ τερματοφυλάκων.',
    leaveSheetGiveUp: 'Παράτησε τη θέση σου',
    leaveSheetGiveUpAnyway: 'Παράτησέ την ούτως ή άλλως',
    leaveSheetAskPool: 'Ζήτα τερματοφύλακα',
    leaveSheetAskReplacement: 'Ζήτα αντικαταστάτη',
    leaveSheetStayIn: 'Μείνε μέσα',
    leaveShareReplacement:
      'Δεν μπορώ να έρθω {{when}} στο {{venue}} — η θέση μου άνοιξε, ας την πιάσει κάποιος: {{link}}',
    leaveShareReplacementKeeper:
      '⚽ Χρειάζεται τερματοφύλακας — {{when}} · {{venue}}. Ελεύθερη θέση: {{link}}',
    profileInGoal: 'Στο τέρμα',
    profileInGoalHint: 'Πες ναι και τα παιχνίδια κοντά σου που ψάχνουν τερματοφύλακα θα εμφανίζονται στην Κοινότητα. Όταν πιάνεις ένα, παίζεις δωρεάν.',
    profileInGoalFull: 'Όλο το παιχνίδι',
    profileInGoalRotation: '20–30 λεπτά',
    profileInGoalNo: 'Όχι για μένα',
    fixtureKeeperPost: 'Ανάρτησε στους τερματοφύλακες',
    fixtureKeeperPostRotation: 'Ζήτα 20 λεπτά αντί γι’ αυτό',
    fixtureKeeperPosted: 'Αναρτήθηκε · το βλέπουν {{count}} παίκτες κοντά σου που μπαίνουν τέρμα. Ο πρώτος που το πιάνει παίζει δωρεάν.',
    fixtureKeeperPostedNone: 'Αναρτήθηκε · κανείς κοντά σου δεν έχει πει ακόμα ότι μπαίνει τέρμα. Ρώτα και στο WhatsApp.',
    fixtureKeeperPostedOne: 'Αναρτήθηκε · το βλέπει 1 παίκτης κοντά σου που μπαίνει τέρμα. Ο πρώτος που το πιάνει παίζει δωρεάν.',
    fixtureKeeperPostedRotation: ' Ζητήθηκαν 20 λεπτά.',
    fixtureKeeperWithdraw: 'Απόσυρε',
    fixtureKeeperAskWhatsapp: 'Ρώτα στο WhatsApp',
    fixtureKeeperError: 'Δεν πέρασε. Δοκίμασε ξανά.',
    fixtureKeeperFreeTag: 'ΤΕΡΜΑ · ΔΩΡΕΑΝ',
    fixtureKeeperFreeShare: 'Δωρεάν',
    fixtureKeeperFreeHint: 'Πήρες τα γάντια από το keeper pool. Οι άλλοι μοιράζονται το γήπεδο.',
    fixtureKeeperFreeNote: 'Ο τερματοφύλακας από το pool παίζει δωρεάν.',
    communityKeepersLabel: 'Ζητούνται τερματοφύλακες',
    communityKeeperWhole: 'όλο το παιχνίδι',
    communityKeeperRotation: '20 λεπτά',
    communityKeeperRecord: '{{back}} από {{played}} τερματοφύλακες θα ξανάπαιζαν μαζί τους',
    communityKeeperClaim: 'Μπαίνω τέρμα',
    communityKeeperTaken: 'Κάποιος σε πρόλαβε.',
    communityKeeperError: 'Δεν πέρασε. Δοκίμασε ξανά.',
    keeperFeedbackOrganiserTitle: 'Ήρθε ο/η {{name}} στο τέρμα;',
    keeperFeedbackBack: 'Θα τον/την ξαναέπαιρνες;',
    keeperFeedbackKeeperTitle: 'Θα ξαναέπαιζες τέρμα για αυτή την ομάδα;',
    keeperFeedbackYes: 'Ναι',
    keeperFeedbackNo: 'Όχι',
    keeperFeedbackHint: 'Μόνο ναι ή όχι. Βοηθά τους τερματοφύλακες να βρίσκουν καλές ομάδες και τις ομάδες τερματοφύλακες που έρχονται.',
    keeperFeedbackThanks: 'Ευχαριστούμε — καταγράφηκε.',
    recordTitle: 'Βιντεοσκόπηση',
    recordToggle: 'Βιντεοσκόπησε το παιχνίδι',
    recordHintOff: 'Το γήπεδο έχει κάμερα. Άνοιξέ το και οι παίκτες της κράτησης βλέπουν όλο το παιχνίδι μετά.',
    recordHintOn: 'Όποιος μπαίνει το μαθαίνει πριν μπει. Μόνο οι παίκτες της κράτησης το βλέπουν, για 30 μέρες. Όσο είναι κλειστό, δεν γράφεται τίποτα.',
    recordMinor: 'Στην κράτηση είναι παίκτης κάτω των 18, οπότε δεν βιντεοσκοπείται.',
    recordNotice: 'Αυτό το παιχνίδι βιντεοσκοπείται. Μόνο οι παίκτες του το βλέπουν, για 30 μέρες.',
    recordNoticeAsk: 'Δεν θέλεις να σε τραβήξουν; Πες στον διοργανωτή να το κλείσει πριν την έναρξη.',
    recordError: 'Δεν πέρασε. Δοκίμασε ξανά.',
    matchTitle: 'Το παιχνίδι',
    matchWatch: 'Δες το παιχνίδι',
    matchRecording: 'Γράφει τώρα.',
    matchUploading: 'Η κάμερα ανεβάζει το παιχνίδι. Θα είναι εδώ σύντομα.',
    matchFailed: 'Η κάμερα δεν το έγραψε αυτή τη φορά.',
    matchDeleted: 'Ο διοργανωτής έσβησε τη βιντεοσκόπηση.',
    matchExpires: 'Μένει ως τις {{date}}.',
    matchDelete: 'Σβήσε τη βιντεοσκόπηση',
    matchDeleteTitle: 'Να σβηστεί η βιντεοσκόπηση;',
    matchDeleteBody: 'Φεύγει για όλους στην κράτηση και δεν επιστρέφει.',
    matchDeleteConfirm: 'Σβήσε',
    matchCancel: 'Άκυρο',
    matchError: 'Δεν πέρασε. Δοκίμασε ξανά.',
    leaveSheetFindReplacement: 'Βρες μου αντικαταστάτη',
    leaveSheetReplaceTitle: 'Δεν μπορείς να έρθεις;',
    leaveSheetFindReplacementNote:
      'Κρατάς τη θέση σου μέχρι να την πάρει κάποιος. Η παρέα σου και ο πίνακας τη βλέπουν αμέσως.',
    leaveSheetFindReplacementPaidNote:
      'Κρατάς τη θέση σου μέχρι να την πάρει κάποιος. Όταν πληρώσει, τα {{amount}} σου επιστρέφονται.',
    leaveSheetLeaveRefund: 'Φύγε — σου επιστρέφονται {{amount}}',
    leaveSheetLeaveNoRefund: 'Φύγε χωρίς επιστροφή χρημάτων',
    fixtureReplacingTitle: 'ΨΑΧΝΟΥΜΕ ΑΝΤΙΚΑΤΑΣΤΑΤΗ',
    fixtureReplacingBody:
      'Η θέση είναι δική σου μέχρι να την πάρει κάποιος. Τη βλέπουν η παρέα σου και ο πίνακας — στείλ\' τη σε όποιον μπορεί να παίξει.',
    fixtureReplacingBodyPaid:
      'Η θέση είναι δική σου μέχρι να την πάρει κάποιος. Όταν πληρώσει, τα {{amount}} σου επιστρέφονται.',
    fixtureReplacingShare: 'Στείλε τη θέση μου',
    fixtureReplacingKeep: 'Τελικά μπορώ να παίξω',
    fixtureReplacingTag: 'ΔΕΝ ΜΠΟΡΕΙ',
    fixtureReplacementError: 'Δεν πέρασε. Δοκίμασε ξανά σε λίγο.',
    fixtureRefreshError: 'Δεν ανανεώθηκε το παιχνίδι. Τράβηξε προς τα κάτω για να ξαναδοκιμάσεις.',
    inviteSeatsToTake: 'Θέσεις που αφήνονται: {{gk}} τερματοφύλακας · {{outfield}} παίκτες',
    inviteTakeSeat: 'Πάρε τη θέση',
    inviteTakeSeatKeeper: 'Πάρε τη θέση του τερματοφύλακα',
    inviteTakeSeatPaid: 'Πάρε τη θέση · {{amount}}',
    inviteTakeSeatGone: 'Κάποιος μόλις πήρε αυτή τη θέση.',
    communityCrewLabel: 'Από την παρέα σου',
    communityCrewSeat: 'μια θέση για σένα',
    communityCrewSeatKeeper: 'η θέση του τερματοφύλακα',



    bookingDetailVenue: 'Χώρος',
    bookingDetailWhen: 'Πότε',
    bookingDetailAddons: 'Extras',
    bookingDetailTotal: 'Σύνολο',
    bookingDetailRefund: 'Επιστροφή',
    bookingCancelCta: 'Ακύρωση κράτησης',
    bookingCancelling: 'Ακυρώνεται…',
    cancelConfirmTitle: 'Ακύρωση αυτής της κράτησης;',
    cancelConfirmBodyPending:
      'Δεν έχει χρεωθεί ακόμη. Με την ακύρωση η ώρα ελευθερώνεται για άλλους.',
    cancelConfirmBodyWithRefund:
      'Θα σου επιστραφούν €{{refund}} ({{percent}}% του €{{total}}). Η επιστροφή φαίνεται στην κάρτα σου σε 5–10 εργάσιμες.',
    cancelConfirmBodyNoRefund:
      'Η κράτηση είναι εντός της περιόδου χωρίς επιστροφή ({{policy}}). Με την ακύρωση ελευθερώνεται η ώρα αλλά δεν επιστρέφονται χρήματα.',
    cancelConfirmConfirm: 'Ακύρωση κράτησης',
    cancelConfirmDismiss: 'Διατήρηση',
    cancelPolicy: { standard: 'σταθερή', strict: 'αυστηρή', flex: 'ευέλικτη' },
    cancelErrorTitle: 'Η ακύρωση απέτυχε',
    cancelErrorStripe: 'Δεν ολοκληρώθηκε η επιστροφή. Δοκίμασε ξανά ή επικοινώνησε μαζί μας.',
    cancelErrorNetwork: 'Χωρίς σύνδεση. Δοκίμασε ξανά.',
    cancelErrorUnauthorized: 'Έληξε η σύνδεσή σου. Συνδέσου ξανά.',
    cancelErrorGeneric: 'Κάτι πήγε στραβά. Δοκίμασε ξανά.',
    cancelDismiss: 'Εντάξει',
    bookingState: {
      pending: 'Σε αναμονή',
      collecting: 'Μαζεύονται',
      paid: 'Πληρωμένη',
      confirmed: 'Επιβεβαιωμένη',
      completed: 'Παίχτηκε',
      cancelled: 'Ακυρωμένη',
      refunded: 'Επιστροφή χρημάτων',
      refunded_by_admin: 'Επιστροφή από Ludi',
      cancelled_no_refund: 'Ακυρωμένη (χωρίς επιστροφή)',
    },
    verifyResendIn: 'Νέος κωδικός σε {{s}}',
    discoverEmptyTitle: 'Κανένα γήπεδο στην πόλη {{city}} ακόμη',
    discoverEmptyBody: 'Έρχονται κι άλλες πόλεις — ξεκινάμε εκεί που είναι τα γήπεδα.',
    courtsOne: '1 γήπεδο',
    courtsOther: '{{count}} γήπεδα',
    fromLabel: 'από',
    soldOutBadge: 'Πλήρες',
    soldOutTitle: 'Όλα κλεισμένα για {{day}}',
    soldOutTryNext: 'Δοκίμασε {{day}} →',
    priceLinePitch: 'Γήπεδο',
    checkoutHolding: 'Κρατάμε τη θέση σου…',
    checkoutConfirming: 'Επιβεβαίωση με το γήπεδο…',
    checkoutStillConfirmingTitle: 'Ακόμη επιβεβαιώνουμε με την τράπεζα',
    checkoutStillConfirmingBody: 'Η κάρτα σου δεν έχει χρεωθεί δύο φορές.',
    checkoutFailNoCharge: 'Δεν έγινε καμία χρέωση.',
    checkoutFailTitleSlot: 'Η ώρα μόλις κλείστηκε',
    checkoutFailTitlePitch: 'Το γήπεδο δεν είναι διαθέσιμο τώρα',
    checkoutFailTitleStripe: 'Η κάρτα απορρίφθηκε',
    checkoutFailTitleNetwork: 'Χωρίς σύνδεση',
    checkoutFailTitleRateLimited: 'Πολλές προσπάθειες',
    checkoutFailTitleGeneric: 'Η κράτηση απέτυχε',
    checkoutTryAnotherCard: 'Δοκίμασε ξανά',
    checkoutBackToPitch: 'Πίσω στο γήπεδο',
    checkoutFromPitchTitle: 'Διάλεξε πρώτα ώρα',
    checkoutFromPitchBody: 'Οι κρατήσεις ξεκινούν από τη σελίδα του γηπέδου, όπου βλέπεις την ώρα και την τιμή.',
    checkoutOpenPitch: 'Άνοιγμα γηπέδου',
    addToCalendar: 'Στο ημερολόγιο',
    shareBooking: 'Κοινοποίηση',
    bookingsEmptyTitle: 'Καμία κράτηση ακόμη',
    bookingsEmptyBody: 'Βρες γήπεδο στη Λάρνακα και κλείσε το πρώτο σου παιχνίδι.',
    bookingsFindPitch: 'Βρες γήπεδο',
    relTonight: 'Απόψε',
    relTomorrow: 'Αύριο',
    // Η ΚΟΠ μέσα στο Ludi
    cfaEyebrow: 'ΚΟΠ Grassroots · {{day}}',
    cfaToday: 'Σήμερα',
    cfaNow: 'Τώρα',
    cfaPostponed: 'Αναβολή',
    cfaCancelled: 'Ακυρώθηκε',
    cfaTapTeam: 'Πάτησε την ομάδα του παιδιού σου για να την ακολουθείς.',
    cfaNoScores: 'Χωρίς σκορ — η ΚΟΠ δεν κρατά αποτελέσματα σε αυτές τις ηλικίες.',
    cfaFollowing: 'Την ακολουθείς',
    cfaFollow: 'Ακολούθησε την ομάδα',
    cfaFollowWhy: 'Θα βλέπεις τους αγώνες της στις Κρατήσεις, και θα σου λέμε όταν βγαίνει το πρόγραμμα, όταν αλλάζει γήπεδο ή ώρα, και μία ώρα πριν τη σέντρα.',
    cfaFollowPrivate: 'Κανείς δεν βλέπει ποιες ομάδες ακολουθείς — ούτε το γήπεδο, ούτε άλλοι παίκτες.',
    cfaPlays: 'Παίζω κι εγώ',
    cfaPlaysHint: 'Πες μου όταν οι γονείς στήνουν παιχνίδι εδώ.',
    cfaUnfollow: 'Σταμάτα να την ακολουθείς',
    cfaFollowError: 'Δεν αποθηκεύτηκε. Δοκίμασε ξανά.',
    myTeamsSection: 'Οι ομάδες μου',
    myTeamsAway: 'Εκτός έδρας · {{venue}}',
    followedTeams: 'Ομάδες που ακολουθείς',
    followedTeamsNone: 'Καμία ακόμη — ακολούθησε μια ομάδα από το Σάββατο της ΚΟΠ σε ένα γήπεδο.',
    cfaTodayEyebrow: 'Σήμερα · ΚΟΠ Grassroots',
    cfaTodayLine: '{{count}} αγώνες · επόμενη σέντρα {{time}}',
    cfaTodayDone: '{{count}} αγώνες σήμερα',
    askParents: 'Ρώτα τους γονείς που παίζουν εδώ',
    askParentsHint: 'Γονείς που ακολουθούν ομάδα εδώ και είπαν «Παίζω κι εγώ».',
    askParentsDone: 'Έγινε — οι γονείς που είπαν ότι παίζουν εδώ θα το μάθουν.',
    askParentsError: 'Δεν έγινε. Δοκίμασε ξανά.',
  },
};
