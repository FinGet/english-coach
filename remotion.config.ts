/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";
import { existsSync } from "node:fs";

// 自带的 chrome-headless-shell 在本机 GPU 进程会崩溃，优先用系统 Chrome
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (existsSync(CHROME)) Config.setBrowserExecutable(CHROME);

Config.setRspack(true);
// 字幕和细网格使用无损中间帧，减少最终编码前的画质损失。
Config.setVideoImageFormat("png");
Config.setCrf(16);
Config.setOverwriteOutput(true);
Config.setDefaultPremountInSeconds(2);
