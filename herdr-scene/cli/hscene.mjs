import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import manifest from "../package.json" with { type: "json" };
import { isSource } from "../mods/mermaid/sources.js";
import { data, installation } from "./install.mjs";

const usage = `hscene check [PATH...] [--json]
hscene parts FILE [--near NAME[,NAME...]] [--json]
hscene install [--app-home DIR] [--skill DIR] [--dry-run]
hscene uninstall [--app-home DIR] [--dry-run]
hscene status [--app-home DIR] [--json]
hscene --skill [TOPIC]
hscene --version | --help`;

const string = { type: "string" }, flag = { type: "boolean" };
const options = {
  check: { json: flag },
  parts: { near: string, json: flag },
  install: { "app-home": string, skill: string, "dry-run": flag },
  uninstall: { "app-home": string, "dry-run": flag },
  status: { "app-home": string, json: flag },
};

class UsageError extends Error {}

async function main([command, ...args]) {
  if (command === "--skill") {
    // Without a topic it prints the core manual (manual/hscene.md), which lists the topics.
    const topics = ["mermaid", "pele-css"];
    if (args.length > 1 || (args.length === 1 && !topics.includes(args[0]))) {
      throw new UsageError(`Usage: hscene --skill [TOPIC]\nTopics: ${topics.join(", ")}`);
    }
    process.stdout.write(readFileSync(join(data, "manual", `${args[0] ?? "hscene"}.md`)));
    return 0;
  }
  if (command === "--help" || command === "--version") {
    if (args.length) throw new UsageError(usage);
    console.log(command === "--help" ? usage : manifest.version);
    return 0;
  }
  if (!Object.hasOwn(options, command)) throw new UsageError(usage);
  const { values, positionals } = parseArgs({ args, options: options[command], allowPositionals: true });
  if (Object.values(values).includes("")) throw new UsageError("Expected a non-empty option value");
  const appHome = resolve(values["app-home"] || process.env.HERDR_APP_HOME || resolve(homedir(), ".config/herdr-app"));
  if (command === "check" || command === "parts") {
    if (command === "parts" && positionals.length !== 1) throw new UsageError(usage);
    for (const path of positionals) {
      const entry = statSync(path, { throwIfNoEntry: false });
      if (command === "check" && entry?.isDirectory()) continue;
      if (!isSource(path) || (entry && !entry.isFile())) throw new UsageError(`Unsupported file: ${path}`);
    }
    const names = values.near?.split(",").map((s) => s.trim());
    if (names?.includes("")) throw new UsageError("Expected part names separated by commas");
    const { check, parts } = await import("./diagrams.mjs");
    return command === "check" ? check(positionals, appHome, values.json) : parts(positionals[0], names && new Set(names), values.json);
  }
  if (positionals.length) throw new UsageError(usage);
  return installation(command, appHome, values);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  console.error(e.message);
  process.exitCode = e instanceof UsageError || e.code?.startsWith("ERR_PARSE_ARGS_") ? 2 : 1;
}
