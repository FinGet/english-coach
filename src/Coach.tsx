import { Audio, Video } from "@remotion/media";
import creator from "../creator.config.json";
import {
  AbsoluteFill,
  CalculateMetadataFunction,
  Composition,
  Freeze,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  Background,
  CaptionCard,
  FONT,
  Header,
  HitBanner,
  HitFlash,
  KNOCKS,
  pad,
  Progress,
  Summary,
  VideoFrame,
} from "./parts";
import { FREEZE_MS, getClock, getHits, getMainMs } from "./timeline";
import type { Motion } from "./types";

const FPS = 30;

type Props = {
  readonly motionSrc: string;
  readonly motion?: Motion;
};

const calculateMetadata: CalculateMetadataFunction<Props> = async ({
  props,
  abortSignal,
}) => {
  const res = await fetch(staticFile(props.motionSrc), { signal: abortSignal });
  if (!res.ok) throw new Error(`无法加载字幕数据：${res.status}`);
  const motion: Motion = await res.json();
  return {
    durationInFrames: Math.ceil(
      ((getMainMs(motion) + motion.summary.durationMs) / 1000) * FPS,
    ),
    defaultOutName: `ep${pad(motion.meta.episode)}-portrait`,
    props: { ...props, motion },
  };
};

const fill = { width: "100%", height: "100%", objectPosition: "60% 50%" };

export const AiEnglishCoach: React.FC<Props> = ({ motion }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!motion) return null;

  const toFrame = (ms: number) => Math.round((ms / 1000) * fps);
  const hits = getHits(motion);
  const clock = getClock((frame / fps) * 1000, hits);
  const src = motion.video.src.startsWith("http")
    ? motion.video.src
    : staticFile(motion.video.src);
  const cuts = [0, ...hits.map((h) => h.endMs), motion.video.durationMs];
  const hitStarts = hits.map((h, i) => h.endMs + i * FREEZE_MS);
  const bodyEnd = toFrame(motion.video.durationMs + hits.length * FREEZE_MS);
  const mainEnd = toFrame(getMainMs(motion));

  const video = (
    <VideoFrame hitMs={clock.hit ? clock.hitMs : null}>
      {cuts.slice(1).map((end, i) => {
        const from = toFrame(cuts[i] + i * FREEZE_MS);
        return (
          <Video
            key={`play-${i}`}
            src={src}
            from={from}
            trimBefore={toFrame(cuts[i])}
            durationInFrames={toFrame(end + i * FREEZE_MS) - from}
            premountFor={fps}
            objectFit="cover"
            style={fill}
          />
        );
      })}
      {hitStarts.map((start, i) => (
        <Sequence
          key={`freeze-${i}`}
          from={toFrame(start)}
          durationInFrames={toFrame(FREEZE_MS)}
          premountFor={fps}
        >
          <Freeze frame={0}>
            <Video
              src={src}
              trimBefore={toFrame(hits[i].endMs)}
              muted
              objectFit="cover"
              style={fill}
            />
          </Freeze>
        </Sequence>
      ))}
      <Sequence
        from={bodyEnd}
        durationInFrames={mainEnd - bodyEnd}
        premountFor={fps}
      >
        <Freeze frame={0}>
          <Video
            src={src}
            trimBefore={Math.max(0, toFrame(motion.video.durationMs) - 3)}
            muted
            objectFit="cover"
            style={fill}
          />
        </Freeze>
      </Sequence>
    </VideoFrame>
  );
  const header = <Header motion={motion} ms={clock.ms} />;
  const caption = <CaptionCard motion={motion} ms={clock.ms} />;
  const progress = <Progress motion={motion} ms={clock.ms} />;
  const banner = clock.hit && <HitBanner c={clock.hit} t={clock.hitMs} />;

  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <Background />
      <Sequence durationInFrames={mainEnd} premountFor={fps}>
        <div
          style={{
            position: "absolute",
            left: 100,
            top: 184,
            width: 800,
            height: 80,
          }}
        >
          {header}
        </div>
        <div
          style={{
            position: "absolute",
            left: 100,
            top: 324,
            width: 800,
            height: 988,
          }}
        >
          {caption}
          {banner}
        </div>
        <div style={{ position: "absolute", left: 100, top: 1436 }}>{video}</div>
        <div
          style={{
            position: "absolute",
            left: 460,
            top: 1510,
            width: 440,
            color: "#1C332C",
          }}
        >
          <div style={{ fontSize: 38, fontWeight: 700 }}>{creator.name}</div>
          <div style={{ fontSize: 23, color: "#68776E", marginTop: 10 }}>
            {creator.bio}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: 460,
            top: 1630,
            width: 440,
            height: 32,
          }}
        >
          {progress}
        </div>
        {clock.hit && <HitFlash t={clock.hitMs} />}
      </Sequence>
      {hitStarts.flatMap((start) =>
        KNOCKS.map((k) => (
          <Audio
            key={start + k}
            src="https://remotion.media/ding.wav"
            from={toFrame(start + k)}
            volume={0.6}
            premountFor={fps}
          />
        )),
      )}
      <Sequence from={mainEnd} premountFor={fps}>
        <Summary motion={motion} />
        {motion.summary.voice && (
          <Audio
            src={staticFile(motion.summary.voice.src)}
            from={toFrame(motion.summary.voice.startMs)}
            premountFor={fps}
          />
        )}
      </Sequence>
    </AbsoluteFill>
  );
};

export const AiEnglishCoachComposition = () => (
  <Composition
    id="AiEnglishCoachPortrait"
    component={AiEnglishCoach}
    durationInFrames={300}
    fps={FPS}
    width={1080}
    height={1920}
    defaultProps={{ motionSrc: "motion.json" }}
    calculateMetadata={calculateMetadata}
  />
);
