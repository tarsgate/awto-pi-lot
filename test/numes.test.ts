import assert from "node:assert/strict";
import { test } from "node:test";
import { Logger } from "../src/awto-pi-lot.js";
import { fetchNumesModels } from "../src/numes.js";

function catalogueModel(id: string, reasoning: unknown) {
    return {
        id,
        name: id,
        context_length: 128_000,
        maximum_output_length: 8_192,
        architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
        },
        pricing: { prompt: "0.000001", completion: "0.000002" },
        supported_parameters: ["tools"],
        reasoning,
    };
}

const incompleteReasoningCases: Array<[string, unknown]> = [
    ["absent reasoning", undefined],
    ["null reasoning", null],
    ["missing efforts", { default_enabled: true }],
    ["null efforts", { supported_efforts: null }],
    ["non-array efforts", { supported_efforts: "high" }],
    ["empty efforts", { supported_efforts: [] }],
    ["blank efforts", { supported_efforts: ["", "  "] }],
    ["non-string efforts", { supported_efforts: [null, 42, {}] }],
];

for (const [name, reasoning] of incompleteReasoningCases) {
    test(`model discovery tolerates ${name}`, async (t) => {
        t.mock.method(globalThis, "fetch", async () =>
            Response.json({
                data: [
                    catalogueModel("incomplete", reasoning),
                    catalogueModel("valid", {
                        supported_efforts: ["none", "low", "high"],
                    }),
                ],
            })
        );

        const models = await fetchNumesModels("test-key", new Logger());
        assert.equal(models.length, 2);
        const [incomplete, valid] = models;
        assert.equal(incomplete.reasoning, false);
        assert.equal(incomplete.compat?.supportsReasoningEffort, false);
        assert.equal(incomplete.compat?.thinkingFormat, undefined);
        assert.deepEqual(incomplete.thinkingLevelMap, {});
        assert.equal(valid.reasoning, true);
        assert.equal(valid.compat?.supportsReasoningEffort, true);
        assert.equal(valid.compat?.thinkingFormat, "openrouter");
        assert.deepEqual(valid.thinkingLevelMap, {
            off: "none",
            minimal: null,
            low: "low",
            medium: null,
            high: "high",
            xhigh: null,
            max: null,
        });
    });
}

test("invalid effort entries do not discard valid efforts", async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
        Response.json({
            data: [
                catalogueModel("mixed", {
                    supported_efforts: [null, 42, "", "  ", "low", "high"],
                }),
            ],
        })
    );

    const logger = new Logger();
    const log = t.mock.method(logger, "log");
    const [model] = await fetchNumesModels("test-key", logger);
    assert.deepEqual(
        log.mock.calls.map((call) => call.arguments),
        [
            ["Fetching models from Numes.ai..."],
            ["Fetched 1 models from Numes.ai"],
            ["Found 1 compatible models from Numes.ai"],
        ]
    );
    assert.equal(model.reasoning, true);
    assert.equal(model.thinkingLevelMap?.low, "low");
    assert.equal(model.thinkingLevelMap?.high, "high");
    assert.equal(model.thinkingLevelMap?.medium, null);
});
