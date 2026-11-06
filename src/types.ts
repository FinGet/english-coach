export type Level = 1 | 2 | 3;

export type Correction = {
  level: Level;
  startMs: number;
  endMs: number;
  original: string;
  corrected: string;
  fingerprint: string;
  label: string;
  repeatCount?: number;
  narrationContext?: "previous" | "next" | "both";
};

export type Caption = {
  text: string;
  startMs: number;
  endMs: number;
};

export type PronunciationNote = {
  word: string;
  ipa: string;
  tip: string;
  startMs: number;
  endMs: number;
  source: "self-report" | "user-confirmed" | "assessment";
  narrationContext?: "previous" | "next" | "both";
};

export type Motion = {
  meta: { creator: string; episode: number; title: string };
  video: { src: string; durationMs: number; volume?: number };
  captions: Caption[];
  corrections: Correction[];
  pronunciationNotes?: PronunciationNote[];
  summary: {
    durationMs: number;
    fontSize?: number;
    coachNote: string;
    voice?: Voice;
    assessment?: Assessment;
  };
};

export type Assessment = {
  grammar: number;
  vocabulary: number;
  naturalness: number;
  note: string;
};

// 片尾美音跟读，时间相对片尾开始
export type Voice = {
  src?: string;
  clips?: { src: string; startMs: number }[];
  text: string;
  startMs: number;
  lines: { caption: number; startMs: number; endMs: number }[];
};
