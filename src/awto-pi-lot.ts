import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPpqProvider } from "./ppq.js";
import { registerNanoGptProvider } from "./nano-gpt.js";

export default async function (pi: ExtensionAPI) {
    console.log(`${packageJson.name} v${packageJson.version} initializing...`);

    await registerPpqProvider(pi);
    await registerNanoGptProvider(pi);

    return;
}
