// Copy for the home page's five snapped rooms.
//
// Kept out of en.ts / el.ts because it is home-specific and each room is capped
// at one heading, one paragraph and one widget — that cap is the real design
// constraint, not the animation. If a room's content ever outgrows the
// viewport, mandatory snap turns it into a trap.
//
// ΕΛ drafted by Claude alongside the English; still needs the native-speaker
// pass noted in docs/plans/site.md §Language.
import type { Locale, StatCopy } from './types';

/** One step in the app story. `image` keys into the fixed screenshot map in
 * `components/app-story.tsx` — not localised, so it isn't repeated per
 * language here. */
export interface StoryPanel {
  image: 'discover' | 'book' | 'community' | 'bookings' | 'profile';
  label: string;
  title: string;
  body: string;
}

/** Screen-reader names for the app story's step list and its play button. */
export interface StoryControls {
  label: string;
  pause: string;
  play: string;
  replay: string;
}

export interface RoomsCopy {
  scrollHint: string;
  story: {
    eyebrow: string;
    title: string;
    body: string;
    panels: StoryPanel[];
    controls: StoryControls;
    /** The link under the download button, to /players. */
    more: string;
  };
  owners: { eyebrow: string; title: string; body: string; stats: StatCopy[]; cta: string };
  /** `open` labels each venue card's link to its page. */
  proof: { eyebrow: string; title: string; body: string; cta: string; open: string };
  /** `playerNote` + `playerLink`: the close is the owners' ask, so a player
   * who reads to the end gets one quiet line instead of a second button. */
  close: { title: string; body: string; cta: string; note: string; playerNote: string; playerLink: string };
}

/**
 * The venues the home page names, in order. A venue is named here only once
 * its owner has agreed to it — their own page at /v/<slug> is not the same
 * thing as a place on the home page. Add a slug, never infer one.
 */
export const HOME_VENUES = ['campeone', 'kamares'] as const;

export const rooms: Record<Locale, RoomsCopy> = {
  en: {
    scrollHint: 'Scroll',
    story: {
      eyebrow: 'The app',
      title: 'See it before you download it',
      body: "Real screens, not mockups — this is what's on the screen at every step.",
      panels: [
        { image: 'discover', label: '01', title: 'Find', body: 'Pitches in Larnaca and Nicosia — size, price, floodlights.' },
        { image: 'book', label: '02', title: 'Book', body: 'Pick a slot, see the price, pay in the app.' },
        { image: 'community', label: '03', title: 'Join', body: 'Short a player? Open matches list here for anyone to fill.' },
        { image: 'bookings', label: '04', title: 'Track', body: 'Every booking, past and next, in one place.' },
        { image: 'profile', label: '05', title: 'Play', body: 'Your record — matches, teammates, pitches.' },
      ],
      controls: { label: 'App screens', pause: 'Pause', play: 'Play', replay: 'Play again' },
      more: 'For players',
    },
    owners: {
      eyebrow: 'Pitch owners',
      title: 'Fill your pitch, without the admin',
      body: 'Your slots, your prices, your cut. Ludi takes the booking and the payment; 90% stays with the pitch.',
      stats: [
        { value: '90%', label: 'of every booking stays with you' },
        { value: '0', label: 'setup fee, and no monthly' },
        { value: '1', label: 'calendar, replacing the phone' },
      ],
      cta: 'See how it works',
    },
    proof: {
      eyebrow: 'Pitches on Ludi',
      title: 'The pitches on Ludi',
      // Venues are named only through HOME_VENUES above, each with its
      // owner's agreement; this paragraph has to read right with none shown.
      body: 'Signed up in person, one at a time. Each has its own page — courts, prices, today’s hours — and a link straight into the app.',
      cta: 'How owners come on board',
      open: 'See the pitch',
    },
    close: {
      title: 'Own a pitch in Cyprus?',
      body: "We'd rather come and see it than send you a link. Email us and we'll set your pitch up with you, in person — prices, hours, the lot.",
      cta: 'Email us',
      note: 'Across Cyprus — we sign up every pitch in person.',
      playerNote: 'Here to play?',
      playerLink: 'Get the app',
    },
  },

  el: {
    scrollHint: 'Κύλισε',
    story: {
      eyebrow: 'Η εφαρμογή',
      title: 'Δες την πριν την κατεβάσεις',
      body: 'Πραγματικές οθόνες, όχι μακέτες — αυτό βλέπεις σε κάθε βήμα.',
      panels: [
        { image: 'discover', label: '01', title: 'Βρες', body: 'Γήπεδα σε Λάρνακα και Λευκωσία — μέγεθος, τιμή, προβολείς.' },
        { image: 'book', label: '02', title: 'Κλείσε', body: 'Διάλεξε ώρα, δες την τιμή, πλήρωσε μέσα στην εφαρμογή.' },
        { image: 'community', label: '03', title: 'Μπες', body: 'Λείπει παίκτης; Εδώ βρίσκεις ανοιχτά ματς για να μπεις.' },
        { image: 'bookings', label: '04', title: 'Παρακολούθα', body: 'Κάθε κράτηση, παλιά και επόμενη, σε ένα σημείο.' },
        { image: 'profile', label: '05', title: 'Παίξε', body: 'Το ιστορικό σου — ματς, συμπαίκτες, γήπεδα.' },
      ],
      controls: {
        label: 'Οθόνες της εφαρμογής',
        pause: 'Παύση',
        play: 'Αναπαραγωγή',
        replay: 'Ξανά από την αρχή',
      },
      more: 'Για παίκτες',
    },
    owners: {
      eyebrow: 'Ιδιοκτήτες γηπέδων',
      title: 'Γέμισε το γήπεδό σου, χωρίς τη γραφειοκρατία',
      body: 'Οι ώρες σου, οι τιμές σου, το μερίδιό σου. Το Ludi αναλαμβάνει την κράτηση και την πληρωμή· το 90% μένει στο γήπεδο.',
      stats: [
        { value: '90%', label: 'από κάθε κράτηση μένει σε σένα' },
        { value: '0', label: 'κόστος εγκατάστασης, καμία συνδρομή' },
        { value: '1', label: 'ημερολόγιο, στη θέση του τηλεφώνου' },
      ],
      cta: 'Δες πώς λειτουργεί',
    },
    proof: {
      eyebrow: 'Γήπεδα στο Ludi',
      title: 'Τα γήπεδα στο Ludi',
      body: 'Τα γράφουμε από κοντά, ένα-ένα. Το καθένα έχει τη δική του σελίδα — γήπεδα, τιμές, το σημερινό ωράριο — και σύνδεσμο κατευθείαν στην εφαρμογή.',
      cta: 'Πώς μπαίνουν οι ιδιοκτήτες',
      open: 'Δες το γήπεδο',
    },
    close: {
      title: 'Έχεις γήπεδο στην Κύπρο;',
      body: 'Προτιμούμε να έρθουμε να το δούμε από το να σου στείλουμε έναν σύνδεσμο. Στείλε μας email και στήνουμε μαζί το γήπεδό σου, από κοντά — τιμές, ώρες, τα πάντα.',
      cta: 'Στείλε μας email',
      note: 'Σε όλη την Κύπρο — γράφουμε κάθε γήπεδο από κοντά.',
      playerNote: 'Ήρθες για να παίξεις;',
      playerLink: 'Κατέβασε την εφαρμογή',
    },
  },
};
