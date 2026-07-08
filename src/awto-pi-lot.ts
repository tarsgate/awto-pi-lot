import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
    fetchPpqModels,
    providerName as ppqProviderName,
    registerPpqProvider,
} from "./ppq.js";
import {
    fetchNanoGptModels,
    providerName as nanoGptProviderName,
    registerNanoGptProvider,
} from "./nano-gpt.js";

enum LogType {
    Log,
    Error,
}

export class Logger {
    private logs: Array<{ type: LogType; args: Array<string> }> = [];

    log(...args: string[]) {
        this.logs.push({ type: LogType.Log, args });
    }

    error(...args: string[]) {
        this.logs.push({ type: LogType.Error, args });
    }

    flush() {
        for (const entry of this.logs) {
            if (entry.type === LogType.Log) {
                console.log(...entry.args);
            } else {
                console.error(...entry.args);
            }
        }
        this.logs = [];
    }
}

async function setupPpqProvider(pi: ExtensionAPI) {
    const logger = new Logger();
    const models = await fetchPpqModels(logger);
    registerPpqProvider(pi, models, logger);
    logger.flush();
}

async function setupNanoGptProvider(pi: ExtensionAPI) {
    const logger = new Logger();
    const models = await fetchNanoGptModels(logger);
    registerNanoGptProvider(pi, models, logger);
    logger.flush();
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
