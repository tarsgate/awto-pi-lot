import path from "node:path";
import os from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { OptionHelpers, type Option, Some, Nothing } from "fp-sdk";

export function getBaseUrlFromModelsJson(providerId: string): Option<string> {
    const maybePiCodingAgentDir = OptionHelpers.ofObj(
        process.env.PI_CODING_AGENT_DIR
    );
    const modelsJsonDir =
        maybePiCodingAgentDir instanceof Some
            ? maybePiCodingAgentDir.value
            : path.join(os.homedir(), ".pi", "agent");
    const modelsJsonPath = path.join(modelsJsonDir, "models.json");
    if (!existsSync(modelsJsonPath)) {
        return Nothing;
    }
    const content = readFileSync(modelsJsonPath, "utf-8");
    const modelsJson = JSON.parse(content);
    return OptionHelpers.ofObj(modelsJson.providers?.[providerId]?.baseUrl);
}
