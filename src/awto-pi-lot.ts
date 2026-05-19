import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
import type {
    ExtensionAPI,
    ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { OptionHelpers, Some } from "fp-sdk";

interface PPQPricing {
    input_per_1M_tokens: number;
    output_per_1M_tokens: number;
}

interface PPQArchitecture {
    modality: string;
    input_modalities: string[];
    output_modalities: string[];
}

interface PPQModel {
    id: string;
    name: string;
    context_length: number;
    pricing: PPQPricing;
    supported_parameters?: string[];
    architecture?: PPQArchitecture;
}

interface PPQApiResponse {
    data: PPQModel[];
}

const ppqApiBaseUrl = "https://api.ppq.ai";

function isMetaModel(modelId: string): boolean {
    const lowered = modelId.toLowerCase();

    // e.g. AutoClaw and Auto
    return (
        lowered.startsWith("auto") ||
        // there's a bunch of free models in PPQ.ai website, maybe they'll get exposed by the API at some point?
        lowered.startsWith("free")
    );
}

async function fetchPpqModels(): Promise<PPQModel[]> {
    try {
        console.log("Fetching models from PPQ.ai...");
        const response = await fetch(`${ppqApiBaseUrl}/v1/models`);
        if (!response.ok) {
            console.error(
                `Failed to fetch PPQ.ai models due to HTTP error; status: ${response.status}`
            );
            return [];
        }
        const data = (await response.json()) as PPQApiResponse;
        console.log(`Fetched ${data.data.length} models from PPQ.ai`);
        return data.data;
    } catch (error) {
        console.error("Failed to fetch PPQ.ai models:\n", error);
        return [];
    }
}

async function filterPpqModels(
    apiModels: PPQModel[]
): Promise<ProviderModelConfig[]> {
    try {
        const models: ProviderModelConfig[] = [];

        for (const model of apiModels) {
            const maybeSupportedParameters = OptionHelpers.ofObj(
                model.supported_parameters
            );
            const supportedParameters =
                maybeSupportedParameters instanceof Some
                    ? maybeSupportedParameters.value
                    : [];
            const architecture = OptionHelpers.ofObj(model.architecture);

            // pi requires models to have tool support
            if (
                !isMetaModel(model.id) &&
                !supportedParameters.includes("tools")
            ) {
                continue;
            }

            let inputModalities: ("text" | "image")[] = ["text"];
            if (architecture instanceof Some) {
                inputModalities = architecture.value.input_modalities.filter(
                    (modality) => modality === "text" || modality === "image"
                );
            }
            models.push({
                id: model.id,
                name: model.name,
                api: "openai-completions",
                reasoning: supportedParameters.includes("reasoning"),
                input: inputModalities,
                cost: {
                    input: model.pricing.input_per_1M_tokens,
                    output: model.pricing.output_per_1M_tokens,
                    cacheRead: 0,
                    cacheWrite: 0,
                },
                contextWindow: model.context_length,
            } as ProviderModelConfig);
        }

        const defaultModelId = "auto";
        const secondDefaultModelId = "autoclaw";
        models.sort((a, b) => {
            const position = (id: string) => {
                switch (id) {
                    case defaultModelId:
                        return 0;
                    case secondDefaultModelId:
                        return 1;
                    default:
                        return 2;
                }
            };
            const diff = position(a.id) - position(b.id);
            if (diff !== 0) {
                return diff;
            }
            // alphabetically sort models that come after the defaults
            return a.id.localeCompare(b.id);
        });

        console.log(`Found ${models.length} compatible models from PPQ.ai`);
        return models;
    } catch (error) {
        console.error("Failed to filter PPQ.ai models:\n", error);
        return [];
    }
}

export default async function (pi: ExtensionAPI) {
    console.log(`${packageJson.name} v${packageJson.version} initializing...`);
    const apiModels = await fetchPpqModels();
    const models = await filterPpqModels(apiModels);
    if (models.length > 0) {
        pi.registerProvider("ppq", {
            baseUrl: ppqApiBaseUrl,
            api: "openai-completions",
            apiKey: "PPQ_API_KEY",
            models: models,
        });
        console.log(
            `${packageJson.name} ready: Successfully loaded ${models.length} models from PPQ.ai`
        );
    } else {
        console.error(
            `ERROR: no models from PPQ.ai could be fetched/configured`
        );
    }

    return;
}
