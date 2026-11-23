import {
    type ExtensionAPI,
    type ProviderModelConfig,
    getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Dyn, Empty, Nothing, Option, Some } from "fp-sdk";
import type { Logger } from "./awto-pi-lot.js";

interface NumesRates {
    prompt: string;
    completion: string;
    request: string;
    input_cache_read?: string;
    input_cache_write?: string;
}

interface NumesPricing extends NumesRates {
    usd_rates?: NumesRates;
}

interface NumesReasoning {
    default_effort: string | null;
    default_enabled: boolean;
    mandatory: boolean;
    supports_max_tokens: boolean;
    supported_efforts?: Array<string> | null;
}

interface NumesArchitecture {
    modality: string;
    input_modalities: Array<string>;
    output_modalities: string;
    tokenizer: string;
}

interface NumesModel {
    id: string;
    name: string;
    context_length: number;
    architecture: NumesArchitecture;
    pricing: NumesPricing;
    supported_parameters: Array<string>;
    top_provider: {
        context_length: number;
        max_completion_tokens: number;
    };
    billing_currency: "USD" | "BTC";
    maximum_output_length: number;
    embeddings: boolean;
    supported_hosted_tools?: Array<string>;
    reasoning?: NumesReasoning | null;
}

interface NumesModelsListResponse {
    data: Array<NumesModel>;
}

const providerId = "numes";
export const providerName = "Numes.ai";
const apiKeyEnvVarName = "NUMES_API_KEY";
const numesBaseUrl = "https://api.numes.ai/api/v1";
// Numes.ai rejects max_tokens outside 1..131072
const numesMaxOutputTokens = 131_072;
const numesDefaultOutputTokens = 8_192;
const numesDefaultContextWindow = 128_000;
// pi's standard thinking levels; see getSupportedThinkingLevels() in pi
const piThinkingLevels = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
] as const;

export function getNumesAiApiKey(): Option<string> {
    const envKey = process.env[apiKeyEnvVarName];
    if (envKey) {
        return Option.ofObj(envKey);
    }
    const authJsonPath = join(getAgentDir(), "auth.json");
    if (existsSync(authJsonPath)) {
        const auth = JSON.parse(readFileSync(authJsonPath, "utf-8")) as Record<
            string,
            { key?: string }
        >;
        if (Object.hasOwn(auth, providerId)) {
            return Option.ofObj(auth[providerId].key);
        }
    }
    return Nothing;
}

async function fetchModels(
    apiKey: string,
    logger: Logger
): Promise<Array<NumesModel>> {
    try {
        logger.log(`Fetching models from ${providerName}...`);

        const url = new URL(`${numesBaseUrl}/models`);
        url.searchParams.set("supported_parameters", "tools");
        url.searchParams.set("output_modalities", "text");
        const response = await fetch(url, {
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
        });
        if (response.ok === false) {
            logger.error(
                `Failed to fetch ${providerName} models due to HTTP error; status: ${response.status}`
            );
            return Empty.array();
        }
        const responseJson = (await response.json()) as NumesModelsListResponse;
        const models = responseJson.data;

        logger.log(`Fetched ${models.length} models from ${providerName}`);
        return models;
    } catch (error) {
        logger.error(`Failed to fetch models from ${providerName}:\n${error}`);
        return Empty.array();
    }
}

function filterModels(
    apiModels: Array<NumesModel>,
    logger: Logger
): Array<ProviderModelConfig> {
    const models: Array<ProviderModelConfig> = Empty.array();

    for (const model of apiModels) {
        // pi requires models to have tool support
        if (model.supported_parameters.includes("tools") === false) {
            continue;
        }

        // only include models that produce text
        if (
            model.architecture.input_modalities.includes("text") === false ||
            model.architecture.output_modalities.includes("text") === false
        ) {
            continue;
        }

        const inputModalities = model.architecture.input_modalities.filter(
            (modality) => modality === "text"
        );

        const usdIndexedRates = Option.ofObj(model.pricing.usd_rates);
        const pricing =
            usdIndexedRates instanceof Some
                ? usdIndexedRates.value
                : model.pricing;
        // catalogue prices are per token, pi expects USD per million tokens
        const priceMultiplier = 1_000_000;
        const inputPrice = Number.parseFloat(pricing.prompt) * priceMultiplier;
        const outputPrice =
            Number.parseFloat(pricing.completion) * priceMultiplier;

        const maybeCacheRead = Option.ofObj(pricing.input_cache_read);
        const cacheRead =
            maybeCacheRead instanceof Some
                ? Number.parseFloat(maybeCacheRead.value) * priceMultiplier
                : 0.0;
        const maybeCacheWrite = Option.ofObj(pricing.input_cache_write);
        const cacheWrite =
            maybeCacheWrite instanceof Some
                ? Number.parseFloat(maybeCacheWrite.value) * priceMultiplier
                : 0.0;

        const reasoning = Option.ofObj(model.reasoning);
        const maxOutputLength =
            model.maximum_output_length === 0
                ? numesDefaultOutputTokens
                : model.maximum_output_length;
        const maxTokens = Math.min(maxOutputLength, numesMaxOutputTokens);
        const contextWindow =
            model.context_length === 0
                ? numesDefaultContextWindow
                : model.context_length;

        // Map Numes.ai effort names to pi standard thinking levels. Unsupported
        // levels use Nothing internally, converted to null at the pi boundary
        // to hide them from the thinking picker and prevent rejected efforts.
        const thinkingLevelMap = Empty.object() as Record<
            string,
            Option<string>
        >;
        let supportsEfforts = false;
        // A reasoning object does not guarantee a configurable effort list.
        // Validate the API data before using array or string methods.
        const supportedEfforts =
            reasoning instanceof Some
                ? Dyn.tryCast(reasoning.value.supported_efforts).to(Array)
                : Nothing;
        if (supportedEfforts instanceof Some) {
            const efforts = supportedEfforts.value.flatMap(
                (effort: unknown) => {
                    const maybeEffort = Dyn.tryCast(effort).to(String);
                    return maybeEffort instanceof Some &&
                        maybeEffort.value.trim().length > 0
                        ? [maybeEffort.value]
                        : Empty.array<string>();
                }
            );
            supportsEfforts = efforts.length > 0;
            if (supportsEfforts) {
                for (const level of piThinkingLevels) {
                    thinkingLevelMap[level] = Nothing;
                }
                for (const effort of efforts) {
                    const piLevel = effort === "none" ? "off" : effort;
                    if (
                        (piThinkingLevels as ReadonlyArray<string>).includes(
                            piLevel
                        )
                    ) {
                        thinkingLevelMap[piLevel] = new Some(effort);
                    }
                }
            }
        }

        models.push({
            id: model.id,
            name: model.name,
            reasoning: supportsEfforts,
            input: inputModalities,
            cost: {
                input: inputPrice,
                output: outputPrice,
                cacheRead: cacheRead,
                cacheWrite: cacheWrite,
            },
            thinkingLevelMap: Object.fromEntries(
                Object.entries(thinkingLevelMap).map(([level, effort]) => [
                    level,
                    effort instanceof Some ? effort.value : null,
                ])
            ),
            contextWindow: contextWindow,
            maxTokens: maxTokens,
            // Numes.ai rejects unknown request fields and expects max_tokens
            compat: {
                supportsStore: false,
                supportsDeveloperRole: false,
                supportsReasoningEffort: supportsEfforts,
                maxTokensField: "max_tokens",
                ...(supportsEfforts
                    ? { thinkingFormat: "openrouter" }
                    : Empty.object()),
            },
        } as ProviderModelConfig);
    }

    models.sort((a, b) => a.id.localeCompare(b.id));

    logger.log(`Found ${models.length} compatible models from ${providerName}`);
    return models;
}

export async function fetchNumesModels(
    apiKey: string,
    logger: Logger
): Promise<Array<ProviderModelConfig>> {
    const apiModels = await fetchModels(apiKey, logger);
    const models = filterModels(apiModels, logger);
    if (models.length === 0) {
        logger.error(
            `ERROR: no models from ${providerName} could be fetched/configured`
        );
    }
    return models;
}

export function registerNumesProvider(
    pi: ExtensionAPI,
    models: Array<ProviderModelConfig>,
    logger: Logger
) {
    if (models.length === 0) {
        logger.error(
            `WARNING: empty model list from ${providerName}, skipping provider registration`
        );
        return;
    }

    pi.registerProvider(providerId, {
        name: providerName,
        baseUrl: numesBaseUrl,
        apiKey: apiKeyEnvVarName,
        authHeader: true,
        api: "openai-completions",
        models: models,
    });
    logger.log(
        `Successfully loaded ${models.length} models from ${providerName}\r\n`
    );
}
