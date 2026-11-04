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
};

export type Caption = {
  text: string;
  startMs: number;
  endMs: number;
};

export type Motion = {
  meta: { creator: string; episode: number; title: string };
  video: { src: string; durationMs: number };
  captions: Caption[];
  corrections: Correction[];
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
  src: string;
  text: string;
  startMs: number;
  lines: { caption: number; startMs: number; endMs: number }[];
};
