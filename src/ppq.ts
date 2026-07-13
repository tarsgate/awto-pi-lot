import type {
    ExtensionAPI,
    ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import type { ProviderConfig } from "@opencode-ai/sdk";
import { None, Nothing, type Option, OptionHelpers, Some, Empty } from "fp-sdk";
import type { ILogger } from "./logging.js";

interface PpqPricing {
    input_per_1M_tokens: number;
    output_per_1M_tokens: number;
}

interface PpqArchitecture {
    modality: string;
    input_modalities: Array<string>;
    output_modalities: Array<string>;
}

interface PpqModel {
    id: string;
    name: string;
    context_length: number;
    pricing: PpqPricing;
    supported_parameters?: Array<string>;
    architecture?: PpqArchitecture;
}

interface PpqApiResponse {
    data: Array<PpqModel>;
}

const providerId = "ppq";
export const providerName = "PPQ.ai";
const apiKeyEnvVarName = "PPQ_API_KEY";
export const ppqApiBaseUrl = "https://api.ppq.ai";

function isMetaModel(modelId: string): boolean {
    const lowered = modelId.toLowerCase();

    // e.g. AutoClaw and Auto
    return (
        lowered.startsWith("auto") ||
        // there's a bunch of free models in PPQ.ai website, maybe they'll get exposed by the API at some point?
        lowered.startsWith("free")
    );
}

async function fetchModels(logger: ILogger): Promise<Array<PpqModel>> {
    try {
        logger.log(`Fetching models from ${providerName}...`);
        const response = await fetch(`${ppqApiBaseUrl}/v1/models`);
        if (!response.ok) {
            logger.error(
                `Failed to fetch ${providerName} models due to HTTP error; status: ${response.status}`
            );
            return Empty.array();
        }
        const data = (await response.json()) as PpqApiResponse;
        logger.log(`Fetched ${data.data.length} models from ${providerName}`);
        return data.data;
    } catch (error) {
        logger.error(`Failed to fetch ${providerName} models:\n${error}`);
        return Empty.array();
    }
}

async function filterModelsForPi(
    apiModels: Array<PpqModel>,
    logger: ILogger
): Promise<Array<ProviderModelConfig>> {
    try {
        const models: Array<ProviderModelConfig> = Empty.array();

        for (const model of apiModels) {
            const maybeSupportedParameters = OptionHelpers.ofObj(
                model.supported_parameters
            );
            const supportedParameters =
                maybeSupportedParameters instanceof Some
                    ? maybeSupportedParameters.value
                    : Empty.array();
            const architecture = OptionHelpers.ofObj(model.architecture);

            // pi requires models to have tool support
            if (
                !isMetaModel(model.id) &&
                !supportedParameters.includes("tools")
            ) {
                continue;
            }

            let inputModalities: Array<"text" | "image"> = ["text"];
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
        const secondDefaultModelId = "auto";
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

        logger.log(
            `Found ${models.length} compatible models from ${providerName}`
        );
        return models;
    } catch (error) {
        logger.error(`Failed to filter ${providerName} models:\n${error}`);
        return Empty.array();
    }
}

export async function fetchPpqModelsForPi(
    logger: ILogger
): Promise<Array<ProviderModelConfig>> {
    const apiModels = await fetchModels(logger);
    const models = await filterModelsForPi(apiModels, logger);
    if (models.length === 0) {
        logger.error(
            `ERROR: no models from ${providerName} could be fetched/configured`
        );
    }
    return models;
}

export function registerPpqProviderInPi(
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
        baseUrl: ppqApiBaseUrl,
        api: "openai-completions",
        apiKey: apiKeyEnvVarName,
        models: models,
    });
    logger.log(
        `Successfully loaded ${models.length} models from ${providerName}\r\n`
    );
}

export async function filterPpqModelsForOpenCode(
    apiModels: PpqModel[]
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

    const opencodeModels: ProviderConfig["models"] =
        (Empty.object() as ProviderConfig["models"])!;
    for (const model of apiModels) {
        const maybeSupportedParameters = OptionHelpers.ofObj(
            model.supported_parameters
        );
        const supportedParameters =
            maybeSupportedParameters instanceof Some
                ? maybeSupportedParameters.value
                : [];
        const maybeArchitecture = OptionHelpers.ofObj(model.architecture);
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

export async function fetchPpqModelsForOpenCode(
    logger: ILogger
): Promise<ProviderConfig["models"]> {
    const apiModels = await fetchModels(logger);
    const models = await filterPpqModelsForOpenCode(apiModels);
    if (Object.entries(models!).length === 0) {
        logger.error(
            `ERROR: no models from ${providerName} could be fetched/configured`
        );
    }
    return models;
}

export function registerPpqProviderInOpenCode(
    config: { provider?: { [key: string]: ProviderConfig } },
    models: ProviderConfig["models"],
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

    const apiKey = process.env.PPQ_API_KEY;
    provider.ppq = {
        npm: "@ai-sdk/openai-compatible",
        name: "PPQ.ai",
        options: {
            baseURL: ppqApiBaseUrl,
            apiKey: apiKey,
        },
        models: models,
    };

    logger.log(
        `Successfully loaded ${modelsCount} models from ${providerName}\r\n`
    );
}
