// Domain types shared across app + UI.

export type Locale = 'en' | 'gr';

export type PitchType = '5-a-side' | '7-a-side' | '11-a-side';
export type PitchSurface = 'Artificial turf' | 'Grass' | 'Indoor';

export interface Pitch {
  id: string;
  name: string;
  nameGr: string;
  city: string;
  cityGr: string;
  dist: number;
  rating: number;
  reviews: number;
  type: PitchType;
  surface: PitchSurface;
  indoor: boolean;
  lights: boolean;
  price: number;
  nextSlot: string;
  amenities: string[];
  hero: string; // CSS gradient string for now; swap with photo URL later
}

export interface Match {
  id: string;
  pitch: string;
  city: string;
  cityGr: string;
  date: string;
  dateGr: string;
  time: string;
  level: string;
  levelGr: string;
  levelNum: number;
  players: number;
  max: number;
  spots: number;
  price: number;
  host: string;
  hostAvatar: string;
  participants: string[];
}

export interface MatchResult {
  id: string;
  pitch: string;
  city: string;
  cityGr: string;
  date: string;
  dateGr: string;
  playedAt: string;
  duration: number;
  type: PitchType;
  levelNum: number;
  teamA: TeamSummary;
  teamB: TeamSummary;
  won: 'A' | 'B' | 'draw';
  mvp: { name: string; color: string; rating: number };
  scorers: Scorer[];
  userStats: { goals: number; assists: number; rating: number; votes: number };
  teamARoster: string[];
  teamBRoster: string[];
  rated: boolean;
}

export interface TeamSummary {
  name: string;
  nameGr: string;
  color: string;
  score: number;
}

export interface Scorer {
  name: string;
  team: 'A' | 'B';
  color: string;
  goals: number;
  assists: number;
  min: number[];
}

export interface AppUser {
  name: string;
  lastName: string;
  handle: string;
  level: number;
  levelLabel: string;
  levelLabelGr: string;
  city: string;
  cityGr: string;
  rating: number;
  matchesPlayed: number;
  winRate: number;
  goals: number;
  positions: string[];
  preferred: string;
  teams: { name: string; color: string }[];
  friends: { name: string; color: string }[];
  upcoming: { pitch: string; date: string; time: string }[];
}
