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

const nanoGptBaseUrl = "https://nano-gpt.com/api/v1";

async function fetchJson(
    url: string,
    apiKey?: string
): Promise<Array<NanoGptModel>> {
    const headers = apiKey
        ? { Authorization: `Bearer ${apiKey}` }
        : (Empty.object() as RequestInit["headers"]);
    const response = await fetch(url, {
        headers: headers,
    });
    if (!response.ok) {
        console.error(
            `Failed to fetch nano-gpt.com models due to HTTP error; status: ${response.status}`
        );
        return Empty.array();
    }
    const responseJson = (await response.json()) as {
        data: Array<NanoGptModel>;
    };
    return responseJson.data;
}

function mapModels(list: Array<NanoGptModel>) {
    return list.map(
        (model) =>
            ({
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
            } as ProviderModelConfig)
    );
}

async function fetchModels(apiKey?: string) {
    const models = await fetchJson(
        `${nanoGptBaseUrl}/models?detailed=true`,
        apiKey
    );
    console.log(`\r\nFetched ${models.length} models from nano-gpt.com`);

    const autoModelPrefix = "auto-model";
    // pi requires models to have tool support
    const filteredModels = models.filter(
        (model) =>
            model.id.startsWith(autoModelPrefix) ||
            model.capabilities["tool_calling"]
    );
    console.log(
        `Found ${filteredModels.length} compatible models from nano-gpt.com`
    );

    filteredModels.sort((a, b) => {
        const position = (id: string) =>
            id.startsWith(autoModelPrefix) ? 0 : 1;
        const diff = position(a.id) - position(b.id);
        if (diff !== 0) {
            return diff;
        }
        // alphabetically sort models that come after the defaults
        return a.id.localeCompare(b.id);
    });

    return mapModels(filteredModels);
}

export async function registerNanoGptProvider(pi: ExtensionAPI) {
    const providerId = "nanogpt";
    const apiKeyEnvVarName = "NANOGPT_API_KEY";

    async function registerWithModels(apiKey?: string) {
        try {
            console.log("Fetching models from nano-gpt.com...");
            const models = await fetchModels(apiKey);
            console.log(
                `Successfully loaded ${models.length} models from nano-gpt.com`
            );
            pi.registerProvider(providerId, {
                name: "NanoGPT",
                baseUrl: nanoGptBaseUrl,
                apiKey: apiKeyEnvVarName,
                authHeader: true,
                api: "openai-completions",
                models: models,
            });
        } catch (e) {
            console.error("Failed to fetch models from nano-gpt.com:", e);
        }
    }

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

    await registerWithModels(apiKey);
}
