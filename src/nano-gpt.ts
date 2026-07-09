// code based on https://github.com/GCaringi/pi-nanogpt

import {
    type ExtensionAPI,
    getAgentDir,
    type ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import type { ProviderConfig } from "@opencode-ai/sdk";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Empty, Some, None, Nothing, type Option, OptionHelpers } from "fp-sdk";
import type { ILogger } from "./logging.js";

interface NanoGptPricing {
    prompt?: number;
    completion?: number;
    currency: string;
    unit: string;
}

interface NanoGptModel {
    id: string;
    name: string;
    context_length?: number;
    max_output_tokens?: number;
    pricing: NanoGptPricing;
    capabilities: Record<string, boolean>;
}

const providerId = "nanogpt";
export const providerName = "NanoGPT";
export const apiKeyEnvVarName = "NANOGPT_API_KEY";
const nanoGptBaseUrl = "https://nano-gpt.com/api/v1";

async function fetchModels(
    apiKey: Option<string>,
    logger: ILogger
): Promise<Array<NanoGptModel>> {
    try {
        logger.log(`Fetching models from ${providerName}...`);
        const headers =
            apiKey instanceof Some
                ? { Authorization: `Bearer ${apiKey.value}` }
                : (Empty.object() as RequestInit["headers"]);
        const response = await fetch(`${nanoGptBaseUrl}/models?detailed=true`, {
            headers,
        });
        if (!response.ok) {
            logger.error(
                `Failed to fetch ${providerName} models due to HTTP error; status: ${response.status}`
            );
            return Empty.array();
        }
        const responseJson = (await response.json()) as {
            data: Array<NanoGptModel>;
        };
        logger.log(
            `Fetched ${responseJson.data.length} models from ${providerName}`
        );
        return responseJson.data;
    } catch (error) {
        logger.error(`Failed to fetch models from ${providerName}:\n${error}`);
        return Empty.array();
    }
}

function filterModelsForPi(
    apiModels: Array<NanoGptModel>,
    logger: ILogger
): Array<ProviderModelConfig> {
    const models: Array<ProviderModelConfig> = Empty.array();

    const autoModelPrefix = "auto-model";
    for (const model of apiModels) {
        // pi requires models to have tool support
        if (
            !model.id.startsWith(autoModelPrefix) &&
            !model.capabilities.tool_calling
        ) {
            continue;
        }

        models.push({
            id: model.id,
            name: model.name,
            reasoning: model.capabilities.reasoning,
            input: ["text"] as Array<"text" | "image">,
            cost: {
                input: model.pricing.prompt,
                output: model.pricing.completion,
                cacheRead: 0,
                cacheWrite: 0,
            },
            contextWindow: model.context_length,
            maxTokens: model.max_output_tokens,
        } as ProviderModelConfig);
    }

    models.sort((a, b) => {
        const position = (id: string) =>
            id.startsWith(autoModelPrefix) ? 0 : 1;
        const diff = position(a.id) - position(b.id);
        if (diff !== 0) {
            return diff;
        }
        // alphabetically sort models that come after the defaults
        return a.id.localeCompare(b.id);
    });

    logger.log(`Found ${models.length} compatible models from ${providerName}`);
    return models;
}

export function getNanoGptApiKey(): Option<string> {
    const envKey = process.env[apiKeyEnvVarName];
    if (envKey) {
        return OptionHelpers.ofObj(envKey);
    }
    const authJsonPath = join(getAgentDir(), "auth.json");
    if (existsSync(authJsonPath)) {
        const auth = JSON.parse(readFileSync(authJsonPath, "utf-8")) as Record<
            string,
            { key?: string }
        >;
        if (Object.hasOwn(auth, providerId)) {
            return OptionHelpers.ofObj(auth[providerId].key);
        }
    }
    return Nothing;
}

export async function fetchNanoGptModelsForPi(
    apiKey: Option<string>,
    logger: ILogger
): Promise<Array<ProviderModelConfig>> {
    const apiModels = await fetchModels(apiKey, logger);
    const models = filterModelsForPi(apiModels, logger);
    if (models.length === 0) {
        logger.error(
            `ERROR: no models from ${providerName} could be fetched/configured`
        );
    }
    return models;
}

export function registerNanoGptProviderInPi(
    pi: ExtensionAPI,
    models: Array<ProviderModelConfig>,
    logger: ILogger
) {
    if (models.length === 0) {
        logger.error(
            `WARNING: empty model list from ${providerName}, skipping provider registration`
        );
        return;
    }
    pi.registerProvider(providerId, {
        name: providerName,
        baseUrl: nanoGptBaseUrl,
        apiKey: apiKeyEnvVarName,
        authHeader: true,
        api: "openai-completions",
        models: models,
    });
    logger.log(
        `Successfully loaded ${models.length} models from ${providerName}\r\n`
    );
}

function filterModelsForOpenCode(
    apiModels: Array<NanoGptModel>
): ProviderConfig["models"] {
    const opencodeModels: ProviderConfig["models"] =
        (Empty.object() as ProviderConfig["models"])!;

    for (const model of apiModels) {
        opencodeModels[model.id] = {
            id: model.id,
            name: model.name,
            tool_call: model.capabilities.tool_calling,
            reasoning: model.capabilities.reasoning,
            modalities: {
                input: ["text"],
                output: ["text"],
            },
        };

        const maybeMaxOutputTokens = OptionHelpers.ofObj(
            model.max_output_tokens
        );
        const maybeContextLength = OptionHelpers.ofObj(model.context_length);
        if (
            maybeMaxOutputTokens instanceof Some &&
            maybeContextLength instanceof Some
        ) {
            opencodeModels[model.id].limit = {
                context: maybeContextLength.value,
                output: maybeMaxOutputTokens.value,
            };
        }

        const maybeInputCost = OptionHelpers.ofObj(model.pricing.prompt);
        const maybeOutputCost = OptionHelpers.ofObj(model.pricing.completion);
        if (maybeInputCost instanceof Some && maybeOutputCost instanceof Some) {
            opencodeModels[model.id].cost = {
                input: maybeInputCost.value,
                output: maybeOutputCost.value,
            };
        }
    }

    return opencodeModels;
}

export async function fetchNanoGptModelsForOpenCode(
    apiKey: Option<string>,
    logger: ILogger
): Promise<ProviderConfig["models"]> {
    const apiModels = await fetchModels(apiKey, logger);
    const models = filterModelsForOpenCode(apiModels);
    const modelsCount = Object.entries(models!).length;
    if (modelsCount === 0) {
        logger.error(
            `ERROR: no models from ${providerName} could be fetched/configured`
        );
    }
    return models;
}

export function registerNanoGptProviderInOpenCode(
    config: { provider?: { [key: string]: ProviderConfig } },
    models: ProviderConfig["models"],
    apiKey: string,
    logger: ILogger
) {
    const modelsCount = Object.entries(models!).length;
    if (modelsCount === 0) {
        logger.error(
            `WARNING: empty model list from ${providerName}, skipping provider registration`
        );
        return;
    }

    const maybeProvider = OptionHelpers.ofObj(config.provider);
    let provider: Record<string, ProviderConfig>;
    // Initialize the providers dictionary if it doesn't exist
    if (maybeProvider instanceof None) {
        config.provider = Empty.object() as Record<string, ProviderConfig>;
        provider = config.provider;
    } else {
        provider = maybeProvider.value;
    }

    provider.nanogpt = {
        npm: "@ai-sdk/openai-compatible",
        name: providerName,
        options: {
            baseURL: nanoGptBaseUrl,
            apiKey: apiKey,
        },
        models: models,
    };

    logger.log(
        `Successfully loaded ${modelsCount} models from ${providerName}\r\n`
    );
}
