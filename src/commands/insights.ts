import { buildExternalInsight } from "../external/insight-provider.js";

export interface InsightsCommandOptions {
  format?: string;
  projectRoot?: string;
  config?: string;
}

export async function commandInsights(
  options: InsightsCommandOptions,
): Promise<void> {
  const format = options.format ?? "json";
  if (format !== "json") {
    throw new Error(`Unsupported --format: ${format}. Only "json" is supported.`);
  }

  const projectRoot = options.projectRoot ?? process.cwd();
  const insight = buildExternalInsight(projectRoot, {
    configPath: options.config,
  });

  process.stdout.write(`${JSON.stringify(insight)}\n`);
}
