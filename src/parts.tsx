import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { loadFont } from "@remotion/google-fonts/Outfit";
import creator from "../creator.config.json";
import { useEffect, useRef, useState } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useDelayRender,
  useVideoConfig,
} from "remotion";
import {
  correctionsForCaption,
  FIX_MS,
  FREEZE_MS,
  getCaptionRows,
  getRecapScroll,
  getPronunciationPages,
  PRONUNCIATION_GAP,
  pronunciationForCaption,
  splitCaption,
  splitPronunciation,
} from "./timeline";
import type { PronunciationPage, RecapLayout } from "./timeline";
import type { Correction, Level, Motion, PronunciationNote } from "./types";

const outfit = loadFont("normal", {
  weights: ["400", "600", "700", "800"],
  subsets: ["latin"],
});
const mono = loadMono("normal", {
  weights: ["500", "700"],
  subsets: ["latin"],
});
export const FONT = `${outfit.fontFamily}, "PingFang SC", sans-serif`;
export const IMPACT_MS = 320;
export const KNOCKS = [IMPACT_MS, IMPACT_MS + 220, IMPACT_MS + 440];
const MONO = `${mono.fontFamily}, monospace`;
const C = {
  canvas: "#F4F3ED",
  card: "#FFFFFF",
  border: "#D9DED5",
  shadow: "0 12px 38px rgba(26,49,40,.045)",
  brand: "#187660",
  text: "#1C332C",
  sub: "#68776E",
  meta: "#8E9A90",
  strike: "#8E9790",
  correctedBg: "#E0EFE0",
  correctedText: "#226B40",
  pronunciation: "#1759A8",
} as const;
const LEVEL_CHIP: Record<Level, { fg: string; bg: string }> = {
  1: { fg: "#287751", bg: "#E0EFE0" },
  2: { fg: "#9A650F", bg: "#FCEDC8" },
  3: { fg: "#C74552", bg: "#FBE5E5" },
};
const LEVEL_COLOR: Record<Level, string> = {
  1: LEVEL_CHIP[1].fg,
  2: LEVEL_CHIP[2].fg,
  3: LEVEL_CHIP[3].fg,
};
const LEVEL_NAME: Record<Level, string> = {
  1: "Polish",
  2: "Correction",
  3: "Repeat mistake",
};
const ease = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
  easing: Easing.bezier(0.16, 1, 0.3, 1),
} as const;
const card: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 28,
  boxShadow: C.shadow,
};
const labelStyle: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 20,
  letterSpacing: 2,
  color: C.sub,
};
export const pad = (n: number) => String(n).padStart(2, "0");

export const Background: React.FC = () => (
  <AbsoluteFill style={{ background: C.canvas }}>
    <div
      style={{
        position: "absolute",
        width: 850,
        height: 850,
        right: -360,
        top: -480,
        borderRadius: "50%",
        background: "#E6ECDF",
      }}
    />
    <AbsoluteFill
      style={{
        backgroundImage:
          "linear-gradient(rgba(24,118,96,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(24,118,96,0.07) 1px, transparent 1px)",
        backgroundSize: "48px 48px",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 936,
        top: 184,
        width: 96,
        height: 1600,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: C.brand,
        opacity: 0.45,
      }}
    >
      <span
        style={{
          writingMode: "vertical-rl",
          fontFamily: FONT,
          fontSize: 48,
          fontWeight: 600,
          letterSpacing: 6,
        }}
      >
        {creator.slogan}
      </span>
    </div>
    <div
      style={{
        position: "absolute",
        inset: 28,
        border: "1px solid #DDE1D7",
        borderRadius: 36,
      }}
    />
  </AbsoluteFill>
);

export const Header: React.FC<{ motion: Motion; ms: number }> = ({
  motion,
  ms,
}) => {
  const done = motion.corrections.filter((c) => c.startMs <= ms);
  const pronunciationCount = (motion.pronunciationNotes ?? []).filter((note) => note.endMs <= ms).length;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        color: C.text,
        height: "100%",
      }}
    >
      <div
        style={{
          width: 60,
          height: 60,
          borderRadius: 19,
          background: C.brand,
          color: "white",
          display: "grid",
          placeItems: "center",
          fontSize: 27,
          fontWeight: 700,
        }}
      >
        ai.
      </div>
      <div>
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>
          English, in progress.
        </div>
        <div style={{ ...labelStyle, fontSize: 17, marginTop: 4 }}>
          {creator.name.toUpperCase()} / SPEAKING JOURNAL
        </div>
      </div>
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 18,
        }}
      >
        <span style={{ fontSize: 22, color: C.sub }}>{done.length + pronunciationCount} notes</span>
        <span
          style={{
            padding: "12px 18px",
            border: `1px solid ${C.border}`,
            borderRadius: 999,
            fontFamily: MONO,
            fontSize: 22,
          }}
        >
          EP. {pad(motion.meta.episode)}
        </span>
      </div>
    </div>
  );
};

export const VideoFrame: React.FC<{
  children: React.ReactNode;
  hitMs: number | null;
}> = ({ children, hitMs }) => {
  const t = hitMs ?? 0;
  const impact = hitMs === null ? -1 : t - IMPACT_MS;
  const squash =
    hitMs === null
      ? 0
      : KNOCKS.reduce(
          (sum, k) => sum + interpolate(t - k, [0, 50, 200], [0, 1, 0], ease),
          0,
        );
  const swing =
    impact < 0
      ? 0
      : 4 * Math.sin((impact / 520) * 2 * Math.PI) * Math.exp(-impact / 700);
  const emphasis =
    hitMs === null
      ? 1
      : interpolate(
          t,
          [0, IMPACT_MS, FREEZE_MS - 300, FREEZE_MS],
          [1, 1.18, 1.18, 1],
          ease,
        );
  return (
    <div
      style={{
        position: "relative",
        width: 304,
        height: 304,
        transform: `rotate(${swing}deg) scale(${emphasis + squash * 0.025}, ${emphasis - squash * 0.06})`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: -7,
          borderRadius: "50%",
          border: `2px solid ${hitMs === null ? C.border : LEVEL_COLOR[3]}`,
          background: C.card,
          boxShadow: C.shadow,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          overflow: "hidden",
          background: C.text,
          filter: impact < 0 ? undefined : "grayscale(1)",
        }}
      >
        {children}
        {hitMs !== null && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "200%",
              height: "200%",
              transform: "scale(0.5)",
              transformOrigin: "0 0",
            }}
          >
            <Hammer t={hitMs} />
          </div>
        )}
      </div>
    </div>
  );
};

const PronunciationText: React.FC<{
  text: string;
  notes: PronunciationNote[];
  active?: boolean;
}> = ({ text, notes, active }) => (
  <>
    {splitPronunciation(text, notes).map((part, i) => (
      <span key={i} data-pronunciation={part.note?.word} style={part.note ? {
        textDecorationLine: "underline",
        textDecorationStyle: "solid",
        textDecorationColor: C.pronunciation,
        textDecorationThickness: 4,
        textUnderlineOffset: "0.12em",
        color: C.pronunciation,
        background: active ? "#BED8FF" : "#D8E8FF",
        boxShadow: `0 0 0 3px ${active ? "#BED8FF" : "#D8E8FF"}`,
        borderRadius: 5,
        boxDecorationBreak: "clone",
        WebkitBoxDecorationBreak: "clone",
      } : undefined}>{part.text}</span>
    ))}
  </>
);

const Fix: React.FC<{ c: Correction; ms: number; notes: PronunciationNote[]; active?: boolean }> = ({ c, ms, notes, active }) => {
  const t = ms - c.startMs;
  const original = <PronunciationText text={c.original} notes={notes} active={active} />;
  if (t < 0) return original;
  const chip = LEVEL_CHIP[c.level];
  return (
    <span>
      <span
        style={{
          color: C.sub,
          textDecoration: "line-through",
          textDecorationColor: chip.fg,
        }}
      >
        {original}
      </span>{" "}
      <span
        style={{
          padding: "1px 7px",
          borderRadius: 8,
          background: chip.bg,
          color: chip.fg,
          fontWeight: 700,
          opacity: interpolate(t, [120, FIX_MS], [0, 1], ease),
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
        }}
      >
        {c.corrected}
      </span>
    </span>
  );
};

const CaptionText: React.FC<{
  motion: Motion;
  index: number;
  ms: number;
  active?: boolean;
}> = ({ motion, index, ms, active }) => {
  const notes = pronunciationForCaption(motion, index).filter((note) => ms >= note.endMs);
  return <>{splitCaption(motion, index).map((part, i) =>
    typeof part === "string"
      ? <PronunciationText key={i} text={part} notes={notes} active={active} />
      : <Fix key={i} c={part} ms={ms} notes={notes} active={active} />,
  )}</>;
};

export const CaptionCard: React.FC<{
  motion: Motion;
  ms: number;
}> = ({ motion, ms }) => {
  const rows = getCaptionRows(motion, ms);
  const rowHeight = 456;
  const gap = 18;
  return (
    <AbsoluteFill>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 42,
        }}
      >
        <span style={labelStyle}>THE CONVERSATION</span>
        {(motion.pronunciationNotes?.length ?? 0) > 0
          ? <span style={{ fontSize: 18, color: C.pronunciation, background: "#D8E8FF", padding: "4px 8px", borderRadius: 5, textDecoration: "underline solid", textUnderlineOffset: 4 }}>PRONUNCIATION</span>
          : <span style={{ fontSize: 20, color: C.sub }}>LIVE CORRECTIONS</span>}
      </div>
      <div
        style={{
          position: "absolute",
          top: 58,
          left: 0,
          right: 0,
          height: rowHeight * 2 + gap,
          overflow: "hidden",
        }}
      >
        {rows.map((row) => {
          const fixes = correctionsForCaption(motion, row.index).filter(
            (c) => ms >= c.startMs,
          );
          const latest = fixes[fixes.length - 1];
          return (
            <div
              key={row.index}
              style={{
                ...card,
                position: "absolute",
                left: 0,
                right: 0,
                height: rowHeight,
                padding: "26px 28px",
                top: row.position * (rowHeight + gap),
                opacity: row.opacity,
                background: row.current ? C.card : "#EDEFE7",
                borderColor: row.current ? "#C7D5C5" : "#DFE3D9",
                boxShadow: row.current ? C.shadow : "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  height: 26,
                  marginBottom: 16,
                }}
              >
                <span
                  style={{
                    ...labelStyle,
                    fontSize: 17,
                    color: row.current ? C.brand : C.sub,
                  }}
                >
                  {pad(row.index + 1)} /{" "}
                  {row.current ? "NOW SPEAKING" : "JUST SAID"}
                </span>
                {latest && (
                  <span
                    style={{
                      fontSize: 20,
                      fontWeight: 600,
                      color: LEVEL_COLOR[latest.level],
                    }}
                  >
                    {LEVEL_NAME[latest.level]}
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 52,
                  lineHeight: 1.4,
                  fontWeight: 600,
                  color: row.current ? C.text : "#64746A",
                  letterSpacing: -0.7,
                }}
              >
                <CaptionText motion={motion} index={row.index} ms={ms} />
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const Progress: React.FC<{ motion: Motion; ms: number }> = ({
  motion,
  ms,
}) => (
  <AbsoluteFill style={{ justifyContent: "center" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
      <span style={{ ...labelStyle, fontSize: 18, whiteSpace: "nowrap" }}>
        VOICE NOTE
      </span>
      <div
        style={{ height: 3, flex: 1, background: C.border, borderRadius: 3 }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, Math.max(0, (ms / motion.video.durationMs) * 100))}%`,
            background: C.brand,
            borderRadius: 3,
          }}
        />
      </div>
      <span style={{ ...labelStyle, fontSize: 18 }}>
        {pad(Math.floor(Math.min(ms, motion.video.durationMs) / 60000))}:
        {pad(Math.floor(Math.min(ms, motion.video.durationMs) / 1000) % 60)}
      </span>
    </div>
  </AbsoluteFill>
);

const Transcript: React.FC<{
  motion: Motion;
  active: number | null;
}> = ({ motion, active }) => (
  <>
    {motion.captions.map((caption, index) => (
      <span
        key={index}
        data-caption={index}
        style={{
          opacity: active === null || active === index ? 1 : 0.6,
          fontWeight: 600,
          background: active === index ? "#E2EDC9" : undefined,
          boxShadow: active === index ? "0 0 0 3px #E2EDC9" : undefined,
          borderRadius: 5,
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
        }}
      >
        <CaptionText motion={motion} index={index} ms={motion.video.durationMs + FIX_MS} active={active === index} />{" "}
      </span>
    ))}
  </>
);

export const Summary: React.FC<{ motion: Motion }> = ({ motion }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<RecapLayout>({
    viewportHeight: 0,
    contentHeight: 0,
    captions: [],
  });
  const fontSize = motion.summary.fontSize ?? 44;
  useEffect(() => {
    const handle = delayRender("Measure recap scroll layout");
    let disposed = false;
    const measure = () => {
      if (disposed || !viewport.current || !content.current) return;
      const next = {
        viewportHeight: viewport.current.clientHeight,
        contentHeight: content.current.scrollHeight,
        captions: Array.from(content.current.querySelectorAll<HTMLElement>("[data-caption]")).map((node) => ({
          top: node.offsetTop,
          bottom: node.offsetTop + node.offsetHeight,
        })),
      };
      setLayout((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      continueRender(handle);
    };
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    document.fonts.ready.then(measure).catch(cancelRender);
    return () => {
      disposed = true;
      observer.disconnect();
      continueRender(handle);
    };
  }, [motion, fontSize, delayRender, continueRender, cancelRender]);
  const ms = (frame / fps) * 1000;
  const scroll = getRecapScroll(motion, ms, layout);
  const lines = motion.summary.voice?.lines ?? [];
  const active =
    lines.find((line) => ms >= line.startMs && ms < line.endMs)?.caption ??
    null;
  const count = motion.corrections.filter((c) => c.level > 1).length;
  const pronunciation = motion.pronunciationNotes ?? [];
  const assessment = motion.summary.assessment;
  const score = assessment
    ? assessment.grammar + assessment.vocabulary + assessment.naturalness
    : null;
  return (
    <AbsoluteFill
      style={{
        padding: "184px 180px 120px 100px",
        color: C.text,
        gap: 22,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          height: 48,
          flexShrink: 0,
        }}
      >
        <span style={labelStyle}>EP. {pad(motion.meta.episode)} / REVIEW</span>
        <span
          style={{
            padding: "10px 18px",
            background: "#E1EBDD",
            borderRadius: 999,
            fontSize: 22,
            color: C.brand,
          }}
        >
          {motion.summary.voice ? "READ ALONG" : "YOUR PROGRESS"}
        </span>
      </div>
      <div
        style={{
          ...card,
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          padding: "30px 32px",
          borderColor: "#B8CEB8",
        }}
      >
        <div
          style={{
            ...labelStyle,
            color: C.brand,
            marginBottom: 24,
            fontSize: 18,
            flexShrink: 0,
          }}
        >
          FULL TRANSCRIPT · CORRECTIONS INCLUDED
          {pronunciation.length > 0 && <span style={{ display: "block", color: C.pronunciation, fontSize: 16, letterSpacing: 1, marginTop: 10 }}>BLUE HIGHLIGHT · PRONUNCIATION</span>}
        </div>
        <div ref={viewport} style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <div
            ref={content}
            style={{
              position: "relative",
              fontSize,
              lineHeight: 1.55,
              fontWeight: 400,
              color: C.text,
              padding: "4px",
              transform: `translateY(-${scroll}px)`,
            }}
          >
            <Transcript motion={motion} active={active} />
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          height: assessment ? 128 : 52,
          flexShrink: 0,
          borderTop: `1px solid ${C.border}`,
        }}
      >
        {assessment ? (
          <>
            <div style={{ flexShrink: 0, width: 190 }}>
              <div style={{ ...labelStyle, fontSize: 16 }}>ORIGINAL TEXT</div>
              <div
                style={{
                  fontSize: 58,
                  fontWeight: 700,
                  color: C.brand,
                  lineHeight: 1.1,
                  marginTop: 8,
                }}
              >
                {score}
                <span style={{ fontSize: 26, color: C.sub, fontWeight: 400 }}>
                  {" "}
                  / 100
                </span>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0, paddingLeft: 16 }}>
              <div
                style={{
                  display: "flex",
                  gap: 18,
                  color: C.brand,
                  fontSize: 18,
                  fontWeight: 600,
                }}
              >
                <span>Grammar {assessment.grammar}/40</span>
                <span>Words {assessment.vocabulary}/30</span>
                <span>Natural {assessment.naturalness}/30</span>
              </div>
              <div
                style={{
                  fontSize: 20,
                  lineHeight: 1.4,
                  color: C.sub,
                  marginTop: 10,
                }}
              >
                {assessment.note}
              </div>
            </div>
          </>
        ) : (
          <>
            <span style={{ fontSize: 24, color: C.sub }}>
              {motion.corrections.length + pronunciation.length} notes · {count} text corrections
            </span>
            <span style={{ fontFamily: MONO, fontSize: 20, color: C.brand }}>
              KEEP GOING.
            </span>
          </>
        )}
      </div>
    </AbsoluteFill>
  );
};

const PracticeNote: React.FC<{ note: PronunciationNote; number: number }> = ({ note, number }) => (
  <div data-practice-word={note.word} style={{ ...card, padding: "24px 26px", borderColor: "#C9D7E8" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ ...labelStyle, fontSize: 16, color: C.pronunciation }}>WORD {pad(number)}</span>
      <span style={{ fontFamily: MONO, fontSize: 13, color: C.sub }}>{{ "self-report": "SELF-CHECK", "user-confirmed": "USER CONFIRMED", assessment: "ASSESSED" }[note.source]}</span>
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "8px 18px", marginTop: 16 }}>
      <strong style={{ fontSize: 48, fontWeight: 600, lineHeight: 1.2, letterSpacing: -1, overflowWrap: "anywhere", minWidth: 0 }}>{note.word}</strong>
      <span style={{ fontFamily: "Arial, sans-serif", fontSize: 30, lineHeight: 1.3, color: C.pronunciation, overflowWrap: "anywhere", minWidth: 0 }}>{note.ipa}</span>
    </div>
    <div style={{ fontSize: 26, lineHeight: 1.45, borderTop: "1px solid #E0E7ED", paddingTop: 16, marginTop: 18, overflowWrap: "anywhere" }}>{note.tip}</div>
  </div>
);

export const PronunciationPractice: React.FC<{ motion: Motion }> = ({ motion }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const viewport = useRef<HTMLDivElement>(null);
  const singleColumn = useRef<HTMLDivElement>(null);
  const doubleColumn = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ pages: PronunciationPage[]; height: number }>({ pages: [], height: 0 });
  useEffect(() => {
    const handle = delayRender("Measure pronunciation practice cards");
    let disposed = false;
    const measure = () => {
      if (disposed || !viewport.current || !singleColumn.current || !doubleColumn.current) return;
      const heights = (node: HTMLDivElement) => Array.from(node.children, (child) => (child as HTMLElement).offsetHeight);
      const height = viewport.current.clientHeight;
      const next = {
        height,
        pages: getPronunciationPages(motion, [
          { columns: 1, heights: heights(singleColumn.current) },
          { columns: 2, heights: heights(doubleColumn.current) },
        ], height),
      };
      setLayout((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      continueRender(handle);
    };
    const observer = new ResizeObserver(measure);
    for (const node of [viewport.current, singleColumn.current, doubleColumn.current]) {
      if (node) observer.observe(node);
    }
    document.fonts.ready.then(measure).catch(cancelRender);
    return () => {
      disposed = true;
      observer.disconnect();
      continueRender(handle);
    };
  }, [motion, delayRender, continueRender, cancelRender]);
  const { pages } = layout;
  const ms = (frame / fps) * 1000;
  const found = pages.findIndex((page) => ms < page.startMs + page.durationMs);
  const pageIndex = found < 0 ? Math.max(0, pages.length - 1) : found;
  const page = pages[pageIndex];
  const pageMs = ms - (page?.startMs ?? 0);
  const offset = pages.slice(0, pageIndex).reduce((sum, page) => sum + page.notes.length, 0);
  const enter = interpolate(pageMs, [0, 400], [0, 1], ease);
  const scroll = page ? interpolate(pageMs, [1000, page.durationMs - 1000], [0, Math.max(0, page.height - layout.height)], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  return (
    <AbsoluteFill style={{ padding: "184px 180px 120px 100px", color: C.text }}>
      <div style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={labelStyle}>EP. {pad(motion.meta.episode)} / PRONUNCIATION</span>
        <span style={{ ...labelStyle, color: C.pronunciation }}>{pad(pageIndex + 1)} / {pad(pages.length)}</span>
      </div>
      <div style={{ marginTop: 44, marginBottom: 40 }}>
        <div style={{ fontSize: 66, lineHeight: 1.1, fontWeight: 600, letterSpacing: -2 }}>A little clearer.</div>
        <div style={{ fontSize: 26, color: C.sub, marginTop: 18 }}>Practice the blue-marked words.</div>
      </div>
      <div ref={viewport} style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
        <div ref={singleColumn} aria-hidden style={{ position: "absolute", top: 0, left: 0, width: "100%", visibility: "hidden", pointerEvents: "none" }}>
          {(motion.pronunciationNotes ?? []).map((note, index) => <PracticeNote key={index} note={note} number={index + 1} />)}
        </div>
        <div ref={doubleColumn} aria-hidden style={{ position: "absolute", top: 0, left: 0, width: `calc((100% - ${PRONUNCIATION_GAP}px) / 2)`, visibility: "hidden", pointerEvents: "none" }}>
          {(motion.pronunciationNotes ?? []).map((note, index) => <PracticeNote key={index} note={note} number={index + 1} />)}
        </div>
        <div data-practice-page style={{ opacity: enter, transform: `translateY(${(1 - enter) * 18 - scroll}px)`, display: "grid", gridTemplateColumns: `repeat(${page?.columns ?? 1}, minmax(0, 1fr))`, gap: PRONUNCIATION_GAP, alignItems: "start" }}>
          {page?.notes.map((note, index) => <PracticeNote key={`${note.word}-${note.startMs}`} note={note} number={offset + index + 1} />)}
        </div>
      </div>
      <div style={{ paddingTop: 32, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 10 }}>
          {pages.map((_, index) => <div key={index} style={{ flex: 1, height: 3, borderRadius: 3, background: index <= pageIndex ? C.pronunciation : C.border }} />)}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, ...labelStyle, fontSize: 17 }}>
          <span>{motion.pronunciationNotes?.length} WORDS TO REVISIT</span>
          <span style={{ color: C.brand }}>KEEP GOING.</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Hammer: React.FC<{ t: number }> = ({ t }) => (
  <>
    <div
      style={{
        position: "absolute",
        left: "calc(50% - 300px)",
        top: 0,
        width: 600,
        height: 600,
        opacity: interpolate(
          t,
          [IMPACT_MS, IMPACT_MS + 80, FREEZE_MS - 300, FREEZE_MS],
          [0, 1, 1, 0],
          ease,
        ),
        scale: interpolate(t, [IMPACT_MS, IMPACT_MS + 300], [0.3, 1], ease),
        rotate: `${t / 20}deg`,
      }}
    >
      <svg width={600} height={600} viewBox="-300 -300 600 600">
        {Array.from({ length: 16 }, (_, i) => (
          <polygon
            key={i}
            points="0,0 -30,-290 30,-290"
            fill="rgba(255,214,77,0.28)"
            transform={`rotate(${i * 22.5})`}
          />
        ))}
      </svg>
    </div>
    <div
      style={{
        position: "absolute",
        left: "calc(50% - 120px)",
        top: -240,
        width: 240,
        height: 420,
        transformOrigin: "120px 0px",
        rotate:
          interpolate(
            t,
            [
              0,
              KNOCKS[0],
              KNOCKS[0] + 110,
              KNOCKS[1],
              KNOCKS[1] + 110,
              KNOCKS[2],
              FREEZE_MS - 400,
              FREEZE_MS,
            ],
            [-85, 0, -25, 0, -25, 0, 0, -85],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.in(Easing.cubic),
            },
          ) + "deg",
      }}
    >
      <svg width={240} height={420} viewBox="0 0 240 420">
        <defs>
          <linearGradient id="hammer-handle" x1="0" x2="1">
            <stop offset="0" stopColor="#7a4a1d" />
            <stop offset="0.5" stopColor="#c08040" />
            <stop offset="1" stopColor="#7a4a1d" />
          </linearGradient>
          <linearGradient id="hammer-head" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#9aa3b2" />
            <stop offset="1" stopColor="#4a505c" />
          </linearGradient>
        </defs>
        <rect
          x={105}
          y={0}
          width={30}
          height={330}
          rx={12}
          fill="url(#hammer-handle)"
        />
        <rect
          x={10}
          y={300}
          width={220}
          height={110}
          rx={22}
          fill="url(#hammer-head)"
          stroke="#1f2329"
          strokeWidth={8}
        />
        <rect
          x={24}
          y={314}
          width={192}
          height={18}
          rx={9}
          fill="rgba(255,255,255,0.45)"
        />
        <rect x={10} y={370} width={220} height={12} fill="rgba(0,0,0,0.2)" />
      </svg>
    </div>
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 220,
        textAlign: "center",
        fontSize: 130,
        fontWeight: 800,
        color: "#ffd84d",
        WebkitTextStroke: "6px #1f2329",
        textShadow: "0 10px 0 #1f2329",
        opacity: interpolate(
          t,
          [IMPACT_MS, IMPACT_MS + 60, FREEZE_MS - 300, FREEZE_MS],
          [0, 1, 1, 0],
          ease,
        ),
        scale: interpolate(t, [IMPACT_MS, IMPACT_MS + 240], [0.4, 1], {
          ...ease,
          easing: Easing.spring({ damping: 10 }),
        }),
        rotate: "-8deg",
      }}
    >
      BONK!
    </div>
  </>
);

export const HitFlash: React.FC<{ t: number }> = ({ t }) => (
  <AbsoluteFill
    style={{
      boxShadow: `inset 0 0 260px ${LEVEL_COLOR[3]}`,
      opacity: interpolate(
        t,
        [IMPACT_MS, IMPACT_MS + 80, IMPACT_MS + 600, FREEZE_MS],
        [0, 0.9, 0.4, 0],
        ease,
      ),
    }}
  />
);

const STRIPES = `repeating-linear-gradient(45deg, ${LEVEL_COLOR[3]} 0 22px, #1a0508 22px 44px)`;

export const HitBanner: React.FC<{ c: Correction; t: number }> = ({ c, t }) => (
  <AbsoluteFill
    style={{
      overflow: "hidden",
      borderRadius: 24,
      background: C.card,
      border: `2px solid ${LEVEL_COLOR[3]}`,
      boxShadow: C.shadow,
      color: C.text,
      opacity: interpolate(
        t,
        [IMPACT_MS, IMPACT_MS + 120, FREEZE_MS - 200, FREEZE_MS],
        [0, 1, 1, 0],
        ease,
      ),
      scale: interpolate(t, [IMPACT_MS, IMPACT_MS + 300], [0.85, 1], ease),
    }}
  >
    <div style={{ height: 26, background: STRIPES }} />
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        gap: 20,
        padding: "0 60px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          padding: "10px 20px",
          borderRadius: 999,
          background: LEVEL_CHIP[3].bg,
          color: LEVEL_COLOR[3],
          fontSize: 24,
          fontWeight: 700,
          marginBottom: 12,
        }}
      >
        REPEAT OFFENDER · {c.repeatCount ?? 3} TIMES
      </div>
      <div
        style={{
          fontSize: 44,
          fontWeight: 700,
          textDecoration: "line-through",
          color: C.strike,
        }}
      >
        {c.original}
      </div>
      <div style={{ fontSize: 48, color: C.meta }}>↓</div>
      <div
        style={{
          fontSize: 72,
          fontWeight: 800,
          lineHeight: 1.1,
          color: C.correctedText,
          background: C.correctedBg,
          padding: "8px 24px",
          borderRadius: 16,
        }}
      >
        {c.corrected}
      </div>
      <div style={{ fontSize: 38, color: C.sub, marginTop: 12 }}>
        {LEVEL_NAME[c.level]}
      </div>
    </AbsoluteFill>
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 26,
        background: STRIPES,
      }}
    />
  </AbsoluteFill>
);
