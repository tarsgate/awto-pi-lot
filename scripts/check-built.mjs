#!/usr/bin/env node
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packagesDir = join(root, "packages");
const packages = readdirSync(packagesDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name);
const missing = packages.filter((pkg) => !existsSync(join(packagesDir, pkg, "dist")));

if (missing.length > 0) {
	console.error(
		`Error: missing dist/ folder(s) for: ${missing.join(", ")}\nRun "npm run build" before "npm run check".`,
	);
	process.exit(1);
}
