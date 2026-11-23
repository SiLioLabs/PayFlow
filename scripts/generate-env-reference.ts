import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigSchema } from "./config.js";

const root = join(import.meta.dirname, "..");
const docPath = join(root, "docs", "SCRIPTS-ENVIRONMENT.md");
const envPath = join(root, "scripts", ".env.example");

const startMarker = "<!-- BEGIN GENERATED CONFIG_SCHEMA TABLE -->";
const endMarker = "<!-- END GENERATED CONFIG_SCHEMA TABLE -->";

function constraints(field: unknown): string[] {
    const def = (field as any)._def;
    const checks = def?.checks ?? [];
    const result: string[] = [];
    for (const check of checks) {
        if (check.kind === "min") result.push(`minimum ${check.value}`);
        if (check.kind === "max") result.push(`maximum ${check.value}`);
        if (check.kind === "int") result.push("integer");
        if (check.kind === "regex") {
            const source = check.regex?.source;
            if (source?.includes("C[A-Z2-7]")) result.push("starts with `C`; 56-character Stellar contract ID");
            else if (source?.includes("S[A-Z2-7]")) result.push("starts with `S`; 56-character Stellar secret key");
            else result.push(`matches \`${source}\``);
        }
        if (check.kind === "url") result.push("valid HTTP/HTTPS URL");
    }
    return result;
}

function describe(field: unknown): { required: boolean; type: string; constraints: string } {
    let inner = field as any;
    let optional = false;
    while (inner && (inner._def?.typeName === "ZodOptional" || inner._def?.typeName === "ZodDefault")) {
        optional = optional || inner._def.typeName === "ZodOptional";
        inner = inner._def.innerType ?? inner._def.defaultValue?.();
    }

    const typeName = inner?._def?.typeName;
    const type = typeName === "ZodString" ? "string" : typeName === "ZodNumber" ? "number" : typeName ?? "unknown";
    const items = constraints(inner);
    if (items.length === 0 && typeName === "ZodString") items.push("string");
    return {
        required: !optional,
        type,
        constraints: items.join("; "),
    };
}

const rows = Object.entries(ConfigSchema.shape).map(([name, field]) => {
    const info = describe(field);
    const description = (field as any)._def?.description ?? "";
    return `| \`${name}\` | ${info.required ? "Yes" : "No"} | ${info.type} | ${info.constraints || "—"} | ${description} |`;
});

const table = [
    "| Variable | Required | Type | Constraints | Purpose |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
].join("\n");

const content = readFileSync(docPath, "utf8");
const start = content.indexOf(startMarker);
const end = content.indexOf(endMarker);
if (start === -1 || end === -1) {
    throw new Error(`Missing generated-table markers in ${docPath}`);
}

const replacement = `${startMarker}\n${table}\n${endMarker}`;
const generatedStart = start;
const generatedEnd = end + endMarker.length;
const nextContent = content.slice(0, generatedStart) + replacement + content.slice(generatedEnd);

const envContent = readFileSync(envPath, "utf8");
const envNames = new Set<string>();
for (const line of envContent.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:#\s*)?([A-Z][A-Z0-9_]*)=/);
    if (match) envNames.add(match[1]);
}
const missingFromEnv = Object.keys(ConfigSchema.shape).filter((name) => !envNames.has(name));

const check = process.argv.includes("--check");
if (check) {
    const errors: string[] = [];
    if (nextContent !== content) errors.push(`${docPath} is stale; run 'npm run generate:env-docs'`);
    if (missingFromEnv.length) errors.push(`${envPath} is missing schema variables: ${missingFromEnv.join(", ")}`);
    if (errors.length) {
        console.error(errors.join("\n"));
        process.exit(1);
    }
    console.log("Environment reference and scripts/.env.example match ConfigSchema.");
} else {
    writeFileSync(docPath, nextContent);
    console.log(`Generated ConfigSchema table in ${docPath}`);
}
