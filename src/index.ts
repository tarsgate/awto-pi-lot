import type { Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
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

async function fetchPPQModels(): Promise<Model<any>[]> {
	try {
		console.log("Fetching models from PPQ.ai...");
		const response = await fetch(`${ppqApiBaseUrl}/v1/models`);
		const data = (await response.json()) as PPQApiResponse;

		const defaultModelId = "autoclaw";

		const models: Model<any>[] = [];

		for (const model of data.data) {
			const maybeSupportedParameters = OptionHelpers.OfObj(model.supported_parameters);
			const supportedParameters = maybeSupportedParameters instanceof Some ? maybeSupportedParameters.value : [];
			const architecture = OptionHelpers.OfObj(model.architecture);

			// pi requires models to have tool support (but include "autoclaw" model in any case)
			if (model.id !== defaultModelId && supportedParameters.includes("tools")) continue;

			let inputModalities: ("text" | "image")[] = ["text"];
			if (architecture instanceof Some) {
				inputModalities = architecture.value.input_modalities.filter(
					(modality) => modality === "text" || modality === "image",
				);
			}
			models.push({
				id: model.id,
				name: model.name,
				api: "openai-completions",
				baseUrl: ppqApiBaseUrl,
				provider: "ppq",
				reasoning: supportedParameters.includes("reasoning"),
				input: inputModalities,
				cost: {
					input: model.pricing.input_per_1M_tokens,
					output: model.pricing.output_per_1M_tokens,
					cacheRead: 0,
					cacheWrite: 0,
				},
				contextWindow: model.context_length,
			});
		}

		models.sort((a, b) => (a.id === defaultModelId ? -1 : b.id === defaultModelId ? 1 : 0));

		console.log(`Fetched ${models.length} models from PPQ.ai`);
		return models;
	} catch (error) {
		console.error("Failed to fetch PPQ.ai models:", error);
		return [];
	}
}

export default async function (pi: ExtensionAPI) {
	const models = await fetchPPQModels();

	pi.registerProvider("ppq", {
		baseUrl: ppqApiBaseUrl,
		api: "openai-completions",
		apiKey: "PPQ_API_KEY",
		models: models,
	});
}
