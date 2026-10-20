import type {
    ExtensionAPI,
    ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { Empty, Nothing, type Option, OptionHelpers, Some } from "fp-sdk";
import type { Logger } from "./awto-pi-lot.js";

interface NumesPrice {
    cost: string;
    currency: string;
    scope: string;
    type: string;
    unit: string;
    modality: string;
}

interface NumesModel {
    compatible_request_id: string;
    name: string;
    context_length: number;
    max_output_length: number;
    input_modalities: Array<string>;
    output_modalities: Array<string>;
    supported_parameters: Array<string>;
    lowest_prices: Array<NumesPrice>;
    lowest_output_prices: Array<NumesPrice>;
}

interface NumesModelsListResponse {
    data: Array<NumesModel>;
    meta: {
        next_cursor?: string | null;
        total: number;
    };
}

const providerId = "numes";
export const providerName = "Numes.ai";
const apiKeyEnvVarName = "NUMES_API_KEY";
const numesBaseUrl = "https://api.numes.ai/api/v1";
const numesCatalogueUrl = "https://numes.ai/api/public-catalogue/models";
// Numes.ai rejects max_tokens outside 1..131072
const numesMaxOutputTokens = 131_072;
const numesDefaultOutputTokens = 8_192;
const numesDefaultContextWindow = 128_000;

async function fetchModels(logger: Logger): Promise<Array<NumesModel>> {
    try {
        logger.log(`Fetching models from ${providerName}...`);
        const models: Array<NumesModel> = Empty.array();
        let cursor: Option<string> = Nothing;
        do {
            const url = new URL(numesCatalogueUrl);
            url.searchParams.set("limit", "100");
            if (cursor instanceof Some) {
                url.searchParams.set("cursor", cursor.value);
            }
            const response = await fetch(url, {
                headers: { Accept: "application/json" },
            });
            if (response.ok === false) {
                logger.error(
                    `Failed to fetch ${providerName} models due to HTTP error; status: ${response.status}`
                );
                return Empty.array();
            }
            const responseJson =
                (await response.json()) as NumesModelsListResponse;
            models.push(...responseJson.data);
            cursor = OptionHelpers.ofObj(responseJson.meta.next_cursor);
        } while (cursor instanceof Some);
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
        if (model.output_modalities.includes("text") === false) {
            continue;
        }

        // encrypted models require the encrypted client path
        if (model.compatible_request_id.includes(":e2ee") === true) {
            continue;
        }

        const inputModalities = model.input_modalities.filter(
            (modality): modality is "text" | "image" =>
                modality === "text" || modality === "image"
        );
        const inputPrice = OptionHelpers.ofObj(
            model.lowest_prices.find(
                (price) => price.scope === "input" && price.type === "prompt"
            )
        );
        const outputPrice = OptionHelpers.ofObj(
            model.lowest_output_prices.find(
                (price) =>
                    price.scope === "output" && price.type === "completion"
            )
        );
        const supportsReasoning =
            model.supported_parameters.includes("reasoning");
        const maxOutputLength =
            model.max_output_length === 0
                ? numesDefaultOutputTokens
                : model.max_output_length;
        const maxTokens = Math.min(maxOutputLength, numesMaxOutputTokens);
        const contextWindow =
            model.context_length === 0
                ? numesDefaultContextWindow
                : model.context_length;

        models.push({
            id: model.compatible_request_id,
            name: model.name,
            reasoning: supportsReasoning,
            input: inputModalities,
            // catalogue prices are per token, pi expects USD per million tokens
            cost: {
                input:
                    inputPrice instanceof Some
                        ? Number(inputPrice.value.cost) * 1_000_000
                        : 0,
                output:
                    outputPrice instanceof Some
                        ? Number(outputPrice.value.cost) * 1_000_000
                        : 0,
                cacheRead: 0,
                cacheWrite: 0,
            },
            contextWindow: contextWindow,
            maxTokens: maxTokens,
            // Numes.ai rejects unknown request fields and expects max_tokens
            compat: {
                supportsStore: false,
                supportsDeveloperRole: false,
                supportsReasoningEffort: supportsReasoning,
                maxTokensField: "max_tokens",
                ...(supportsReasoning === true
                    ? { thinkingFormat: "openrouter" }
                    : {}),
            },
        } as ProviderModelConfig);
    }

    models.sort((a, b) => a.id.localeCompare(b.id));

    logger.log(`Found ${models.length} compatible models from ${providerName}`);
    return models;
}

export async function fetchNumesModels(
    logger: Logger
): Promise<Array<ProviderModelConfig>> {
    const apiModels = await fetchModels(logger);
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
