import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Empty } from "fp-sdk";
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
import {
    fetchNumesModels,
    providerName as numesProviderName,
    registerNumesProvider,
} from "./numes.js";

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
    return true;
}

async function setupNanoGptProvider(pi: ExtensionAPI) {
    const logger = new Logger();
    const models = await fetchNanoGptModels(logger);
    registerNanoGptProvider(pi, models, logger);
    logger.flush();
    return true;
}

async function setupNumesProvider(pi: ExtensionAPI) {
    const logger = new Logger();
    const models = await fetchNumesModels(logger);
    registerNumesProvider(pi, models, logger);
    logger.flush();
    return true;
}

export default async function (pi: ExtensionAPI) {
    console.log(
        `${packageJson.name} v${packageJson.version} initializing...\r\n`
    );

    const allProviders = [
        { name: ppqProviderName, setupFunc: setupPpqProvider },
        { name: nanoGptProviderName, setupFunc: setupNanoGptProvider },
        { name: numesProviderName, setupFunc: setupNumesProvider },
    ];

    const loadedProviderNames = await Promise.all(
        allProviders.map(async (each) => {
            const { name, setupFunc } = each;
            const success = await setupFunc(pi);
            if (success === true) {
                return name;
            } else {
                return Empty.string();
            }
        })
    );

    const loadedProvidersString = loadedProviderNames
        .filter((name) => name.length > 0)
        .join(", ");

    console.log(
        `Successfully loaded models for providers ${loadedProvidersString} in parallel`
    );

    return;
}
