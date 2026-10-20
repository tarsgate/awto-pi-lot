import {
    type ExtensionAPI,
    getAgentDir,
    type ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Empty, Nothing, type Option, OptionHelpers } from "fp-sdk";
import type { Logger } from "./awto-pi-lot.js";

interface MixRouteModel {
    id: string;
    supported_endpoint_types: string[];
}

interface MixRouteModelsListResponse {
    data: MixRouteModel[];
    success: boolean;
}

const providerId = "mixroute";
export const providerName = "MixRoute";
const apiKeyEnvVarName = "MIXROUTE_API_KEY";
const mixRouterBaseUrl = "https://api.mixroute.ai/v1";

async function fetchModels(
    apiKey: string,
    logger: Logger
): Promise<Array<MixRouteModel>> {
    try {
        logger.log(`Fetching models from ${providerName}...`);
        const headers = { Authorization: `Bearer ${apiKey}` };
        const response = await fetch(`${mixRouterBaseUrl}/models`, {
            headers,
        });
        if (!response.ok) {
            logger.error(
                `Failed to fetch ${providerName} models due to HTTP error; status: ${response.status}`
            );
            return Empty.array();
        }
        const responseJson =
            (await response.json()) as MixRouteModelsListResponse;
        logger.log(
            `Fetched ${responseJson.data.length} models from ${providerName}`
        );
        return responseJson.data;
    } catch (error) {
        logger.error(`Failed to fetch models from ${providerName}:\n${error}`);
        return Empty.array();
    }
}

function filterModels(
    apiModels: Array<MixRouteModel>,
    logger: Logger
): Array<ProviderModelConfig> {
    const models: Array<ProviderModelConfig> = Empty.array();

    for (const model of apiModels) {
        // only include models that support openai-completions API
        if (!model.supported_endpoint_types.includes("openai")) {
            continue;
        }

        models.push({
            id: model.id,
            name: model.id,
            input: ["text"] as Array<"text" | "image">,
            cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
            },
        } as ProviderModelConfig);
    }

    models.sort();

    logger.log(`Found ${models.length} compatible models from ${providerName}`);
    return models;
}

export function getMixRouteApiKey(): Option<string> {
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

export async function fetchMixRouteModels(
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

export function registerMixRouteProvider(
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
        baseUrl: mixRouterBaseUrl,
        apiKey: apiKeyEnvVarName,
        authHeader: true,
        api: "openai-completions",
        models: models,
    });
    logger.log(
        `Successfully loaded ${models.length} models from ${providerName}\r\n`
    );
}
