import { existsSync, readFileSync } from "node:fs";

export const episodeId = (episode) => {
  if (!/^[1-9]\d{0,3}$/.test(String(episode))) throw new Error("期数必须是 1–9999 的整数");
  return `ep${String(episode).padStart(2, "0")}`;
};

export const getEpisodePaths = (episode) => {
  const selected = episode ?? (existsSync("episode.config.json")
    ? JSON.parse(readFileSync("episode.config.json", "utf8")).episode
    : 1);
  const id = episodeId(selected);
  return {
    episode: Number(selected), id,
    assets: `public/${id}`,
    motion: `public/${id}/motion.json`,
    motionSrc: `${id}/motion.json`,
    captions: `public/${id}/captions.json`,
    video: `public/${id}/video.mp4`,
    videoSrc: `${id}/video.mp4`,
    output: `output/${id}`,
    work: `output/_work/${id}`,
    cache: "public/_cache/tts",
    cacheSrc: "_cache/tts",
  };
};
