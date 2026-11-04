import { cancelRender, continueRender, delayRender, staticFile } from "remotion";

export const outfit = { fontFamily: "Coach Outfit" };
export const mono = { fontFamily: "Coach Mono" };

if (typeof document !== "undefined") {
  const handle = delayRender("Load bundled English Coach fonts");
  Promise.all([
    new FontFace(outfit.fontFamily, `url("${staticFile("fonts/outfit-latin.woff2")}")`, { weight: "100 900" }).load(),
    new FontFace(mono.fontFamily, `url("${staticFile("fonts/jetbrains-mono-latin.woff2")}")`, { weight: "100 800" }).load(),
  ]).then((faces) => {
    for (const face of faces) document.fonts.add(face);
    continueRender(handle);
  }).catch(cancelRender);
}
