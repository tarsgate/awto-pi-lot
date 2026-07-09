import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
    fetchPpqModelsForPi,
    providerName as ppqProviderName,
    registerPpqProviderInPi,
} from "./ppq.js";
import {
    getNanoGptApiKey,
    fetchNanoGptModelsForPi,
    providerName as nanoGptProviderName,
    registerNanoGptProviderInPi,
} from "./nano-gpt.js";
import { Logger } from "./logging.js";

async function setupPpqProvider(pi: ExtensionAPI) {
    const logger = new Logger();
    const models = await fetchPpqModelsForPi(logger);
    registerPpqProviderInPi(pi, models, logger);
    await logger.flush();
}

async function setupNanoGptProvider(pi: ExtensionAPI) {
    const logger = new Logger();
    const apiKey = getNanoGptApiKey();
    const models = await fetchNanoGptModelsForPi(apiKey, logger);
    registerNanoGptProviderInPi(pi, models, logger);
    await logger.flush();
}

export default async function (pi: ExtensionAPI) {
    console.log(
        `${packageJson.name} v${packageJson.version} initializing...\r\n`
    );

    await Promise.all([setupPpqProvider(pi), setupNanoGptProvider(pi)]);

    console.log(
        `Successfully loaded models for both providers ${nanoGptProviderName} & ${ppqProviderName} in parallel`
    );

    return;
}
