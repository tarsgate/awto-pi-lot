// code based on https://github.com/GCaringi/pi-nanogpt

import {
    type ExtensionAPI,
    getAgentDir,
    type ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Empty } from "fp-sdk";

interface NanoGptModel {
    id: string;
    context_length: number;
    max_output_tokens?: number;
}

const baseUrl = "https://nano-gpt.com/api/v1";

async function fetchJson(
    url: string,
    apiKey?: string
): Promise<NanoGptModel[]> {
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
    const responseJson = (await response.json()) as { data: NanoGptModel[] };
    return responseJson.data;
}

function mapModels(list: NanoGptModel[]) {
    return list.map(
        (model) =>
            ({
                id: model.id,
                name: model.id,
                reasoning:
                    model.id.includes("r1") || model.id.includes("thinking"),
                input: ["text"] as ("text" | "image")[],
                cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                },
                contextWindow: model.context_length,
                maxTokens: model.max_output_tokens,
            } as ProviderModelConfig)
    );
}

async function fetchModels(apiKey?: string) {
    const models = await fetchJson(`${baseUrl}/models?detailed=true`, apiKey);
    return mapModels(models);
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
                baseUrl,
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
