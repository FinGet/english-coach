import { Config } from "@remotion/cli/config";
import { existsSync } from "node:fs";

try { process.loadEnvFile(); } catch {}
const chrome = process.env.CHROME_EXECUTABLE;
if (chrome) {
  if (!existsSync(chrome)) throw new Error("CHROME_EXECUTABLE does not exist");
  Config.setBrowserExecutable(chrome);
}
Config.setRspack(true);
Config.setVideoImageFormat("png");
Config.setCrf(16);
Config.setDefaultPremountInSeconds(2);
