import type { Plugin } from "@opencode-ai/plugin";
import type { OpencodeClient } from "@opencode-ai/sdk";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
import {
    registerPpqProviderInOpenCode,
    fetchPpqModelsForOpenCode,
    providerName as ppqProviderName,
} from "./ppq.js";
import type { ILogger } from "./logging.js";

type LogLevel = "debug" | "info" | "error" | "warn";

type LogMessageBody = {
    service: string;
    level: LogLevel;
    message: string;
};

class Logger implements ILogger {
    private app: OpencodeClient["app"];
    private logs: Array<LogMessageBody> = [];

    constructor(app: OpencodeClient["app"]) {
        this.app = app;
    }

    private writeLog(level: LogLevel, ...args: string[]) {
        for (const arg of args) {
            this.logs.push({
                service: "awto-pi-lot",
                level: level,
                message: arg,
            });
        }
    }

    log(...args: string[]): void {
        this.writeLog("info", ...args);
    }
    error(...args: string[]): void {
        this.writeLog("error", ...args);
    }
    async flush() {
        for (const messageBody of this.logs) {
            await this.app.log({ body: messageBody });
        }
        this.logs = [];
    }
}

export const PpqPlugin: Plugin = async ({ client }) => {
    const logger = new Logger(client.app);

    return {
        async config(config) {
            logger.log(
                `${packageJson.name} v${packageJson.version} initializing...\r\n`
            );

            const models = await fetchPpqModelsForOpenCode(logger);
            registerPpqProviderInOpenCode(config, models, logger);

            logger.log(`Successfully loaded models for ${ppqProviderName}`);

            await logger.flush();
        },
    };
};
