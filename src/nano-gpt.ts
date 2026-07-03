// code based on https://github.com/GCaringi/pi-nanogpt

import {
    type ExtensionAPI,
    getAgentDir,
    type ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Empty } from "fp-sdk";

interface NanoGptPricing {
    prompt: number;
    completion: number;
    currency: string;
    unit: string;
}

interface NanoGptModel {
    id: string;
    context_length: number;
    max_output_tokens?: number;
    pricing: NanoGptPricing;
    capabilities: Record<string, boolean>;
}

const providerId = "nanogpt";
const providerName = "NanoGPT";
const apiKeyEnvVarName = "NANOGPT_API_KEY";
const nanoGptBaseUrl = "https://nano-gpt.com/api/v1";

async function fetchModels(apiKey?: string): Promise<Array<NanoGptModel>> {
    try {
        console.log(`Fetching models from ${providerName}...`);
        const headers = apiKey
            ? { Authorization: `Bearer ${apiKey}` }
            : (Empty.object() as RequestInit["headers"]);
        const response = await fetch(`${nanoGptBaseUrl}/models?detailed=true`, {
            headers,
        });
        if (!response.ok) {
            console.error(
                `Failed to fetch ${providerName} models due to HTTP error; status: ${response.status}`
            );
            return Empty.array();
        }
        const responseJson = (await response.json()) as {
            data: Array<NanoGptModel>;
        };
        console.log(
            `\r\nFetched ${responseJson.data.length} models from ${providerName}`
        );
        return responseJson.data;
    } catch (error) {
        console.error(`Failed to fetch models from ${providerName}:\n`, error);
        return Empty.array();
    }
}

function filterModels(
    apiModels: Array<NanoGptModel>
): Array<ProviderModelConfig> {
    const models: Array<ProviderModelConfig> = Empty.array();

    const autoModelPrefix = "auto-model";
    for (const model of apiModels) {
        // pi requires models to have tool support
        if (
            !model.id.startsWith(autoModelPrefix) &&
            !model.capabilities["tool_calling"]
        ) {
            continue;
        }

        models.push({
            id: model.id,
            name: model.id,
            reasoning: model.capabilities["reasoning"],
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

    console.log(
        `Found ${models.length} compatible models from ${providerName}`
    );
    return models;
}

export async function registerNanoGptProvider(pi: ExtensionAPI) {
    // Initial loading if a key already exists
    let apiKey = process.env[apiKeyEnvVarName];
    if (!apiKey) {
        const authJsonPath = join(getAgentDir(), "auth.json");
        if (existsSync(authJsonPath)) {
            const auth = JSON.parse(
                readFileSync(authJsonPath, "utf-8")
            ) as Record<string, { key?: string }>;
            if (Object.hasOwn(auth, providerId)) {
                apiKey = auth[providerId].key;
            }
        }
    }

    const apiModels = await fetchModels(apiKey);
    const models = filterModels(apiModels);
    if (models.length > 0) {
        pi.registerProvider(providerId, {
            name: providerName,
            baseUrl: nanoGptBaseUrl,
            apiKey: apiKeyEnvVarName,
            authHeader: true,
            api: "openai-completions",
            models: models,
        });
        console.log(
            `Successfully loaded ${models.length} models from ${providerName}`
        );
    } else {
        console.error(
            `ERROR: no models from ${providerName} could be fetched/configured`
        );
    }
}
