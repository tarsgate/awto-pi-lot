// imports for pi
import type {
    ExtensionAPI,
    ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
// imports for opencode
import type { Plugin } from "@opencode-ai/plugin";
import type { ProviderConfig } from "@opencode-ai/sdk";
// common imports
import { None, Nothing, type Option, OptionHelpers, Some } from "fp-sdk";

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
        const data = (await response.json()) as PPQApiResponse;
        console.log(`Fetched ${data.data.length} models from PPQ.ai`);
        return data.data;
    } catch (error) {
        console.error("Failed to fetch PPQ.ai models:\n", error);
        return [];
    }
}

async function filterPpqModelsForPi(
    apiModels: PPQModel[]
): Promise<ProviderModelConfig[]> {
    try {
        const models: ProviderModelConfig[] = [];

        for (const model of apiModels) {
            const maybeSupportedParameters = OptionHelpers.OfObj(
                model.supported_parameters
            );
            const supportedParameters =
                maybeSupportedParameters instanceof Some
                    ? maybeSupportedParameters.value
                    : [];
            const architecture = OptionHelpers.OfObj(model.architecture);

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

        const defaultModelId = "autoclaw";
        models.sort((a, b) =>
            a.id === defaultModelId ? -1 : b.id === defaultModelId ? 1 : 0
        );

        console.log(`Found ${models.length} compatible models from PPQ.ai`);
        return models;
    } catch (error) {
        console.error("Failed to filter PPQ.ai models:\n", error);
        return [];
    }
}

async function filterPpqModelsForOpenCode(
    apiModels: PPQModel[]
): Promise<ProviderConfig["models"]> {
    // PPQ API doesn't provide output limit, so use on from https://opencode.ai/docs/providers#example
    const defaultOutputLimit = 65536;

    function restrictToSupportedModalities(
        modalities: Option<string[]>
    ): ("text" | "image" | "audio" | "video" | "pdf")[] {
        if (modalities instanceof None) {
            return ["text"];
        }
        return modalities.value.filter((modality) => {
            return (
                modality === "text" ||
                modality === "audio" ||
                modality === "image" ||
                modality === "video" ||
                modality === "pdf"
            );
        });
    }

    const opencodeModels: ProviderConfig["models"] = {};
    for (const model of apiModels) {
        const maybeSupportedParameters = OptionHelpers.OfObj(
            model.supported_parameters
        );
        const supportedParameters =
            maybeSupportedParameters instanceof Some
                ? maybeSupportedParameters.value
                : [];
        const maybeArchitecture = OptionHelpers.OfObj(model.architecture);
        const inputModalities =
            maybeArchitecture instanceof None
                ? Nothing
                : new Some(maybeArchitecture.value.input_modalities);
        const outputModalities =
            maybeArchitecture instanceof None
                ? Nothing
                : new Some(maybeArchitecture.value.output_modalities);

        opencodeModels[model.id] = {
            id: model.id,
            name: model.name,
            cost: {
                input: model.pricing.input_per_1M_tokens,
                output: model.pricing.output_per_1M_tokens,
            },
            limit: {
                context: model.context_length,
                output: defaultOutputLimit,
            },
            tool_call: supportedParameters.includes("tools"),
            reasoning: supportedParameters.includes("reasoning"),
            modalities: {
                input: restrictToSupportedModalities(inputModalities),
                output: restrictToSupportedModalities(outputModalities),
            },
        };
    }

    return opencodeModels;
}

// opencode plugin
export const PpqPlugin: Plugin = async ({ client }) => {
    await client.app.log({
        body: {
            service: "ppq-plugin",
            level: "info",
            message: "PPQ.ai plugin loaded",
        },
    });

    return {
        async config(config) {
            const maybeProvider = OptionHelpers.OfObj(config.provider);
            let provider: Record<string, ProviderConfig>;
            // Initialize the providers dictionary if it doesn't exist
            if (maybeProvider instanceof None) {
                provider = config.provider = {};
            } else {
                provider = maybeProvider.value;
            }

            const models = await fetchPpqModels();

            await client.app.log({
                body: {
                    service: "ppq-plugin",
                    level: "info",
                    message: `${models.length} PPQ.ai models fetched`,
                },
            });

            const opencodeModels = await filterPpqModelsForOpenCode(models);

            const apiKey = process.env.PPQ_API_KEY;
            provider.ppq = {
                npm: "@ai-sdk/openai-compatible",
                name: "PPQ.ai",
                options: {
                    baseURL: ppqApiBaseUrl,
                    apiKey: apiKey,
                },
                models: opencodeModels,
            };
        },
    };
};

// pi plugin
export default async function (pi: ExtensionAPI): Promise<Plugin | undefined> {
    // avoid fetching PPQ models twice if loaded from OpenCode
    if ("client" in pi) {
        // just `return;` would crash OpenCode
        return PpqPlugin;
    }

    const apiModels = await fetchPpqModels();
    const models = await filterPpqModelsForPi(apiModels);
    if (models.length > 0) {
        pi.registerProvider("ppq", {
            baseUrl: ppqApiBaseUrl,
            api: "openai-completions",
            apiKey: "PPQ_API_KEY",
            models: models,
        });
        console.log(
            `awto-pi-lot ready: Successfully loaded ${models.length} models from PPQ.ai`
        );
    } else {
        console.error(
            `ERROR: no models from PPQ.ai could be fetched/configured`
        );
    }

    return;
}
