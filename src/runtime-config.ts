export interface RuntimeConfigInput {
  localProvider?: string;
  model?: string;
}

export interface RuntimeConfig {
  provider?: string;
  providerSource: "cli" | "dev" | "default";
  model?: string;
  modelSource: "cli" | "dev" | "default";
  codexArgs: string[];
}

const DEFAULT_OLLAMA_MODEL = "gemma4-12b-coder-fable5-q4km:latest";

export function resolveRuntimeConfig(
  input: RuntimeConfigInput,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const isDevMode = env.PRE2PROD_DEV_ACTIVE === "1";
  const devProvider = isDevMode ? nonEmpty(env.DEV_PROVIDER) : undefined;
  const devModel = isDevMode ? nonEmpty(env.DEV_MODEL) : undefined;
  const provider = nonEmpty(input.localProvider) ?? devProvider;
  const model =
    nonEmpty(input.model) ??
    devModel ??
    (provider === "ollama" ? DEFAULT_OLLAMA_MODEL : undefined);

  return {
    ...(provider ? { provider } : {}),
    providerSource: nonEmpty(input.localProvider)
      ? "cli"
      : devProvider
        ? "dev"
        : "default",
    ...(model ? { model } : {}),
    modelSource: nonEmpty(input.model) ? "cli" : devModel ? "dev" : "default",
    codexArgs: [
      ...(provider ? ["--oss", "--local-provider", provider] : []),
      "app-server",
    ],
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
