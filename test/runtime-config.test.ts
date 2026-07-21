import { describe, expect, it } from "vitest";

import { resolveRuntimeConfig } from "../src/runtime-config.js";

describe("resolveRuntimeConfig", () => {
  it("uses DEV_PROVIDER and DEV_MODEL in dev mode", () => {
    expect(
      resolveRuntimeConfig(
        {},
        {
          PRE2PROD_DEV_ACTIVE: "1",
          DEV_PROVIDER: "ollama",
          DEV_MODEL: "local-model",
        },
      ),
    ).toEqual({
      provider: "ollama",
      providerSource: "dev",
      model: "local-model",
      modelSource: "dev",
      codexArgs: ["--oss", "--local-provider", "ollama", "app-server"],
    });
  });

  it("lets CLI options override development defaults", () => {
    const config = resolveRuntimeConfig(
      { localProvider: "lmstudio", model: "explicit-model" },
      {
        PRE2PROD_DEV_ACTIVE: "1",
        DEV_PROVIDER: "ollama",
        DEV_MODEL: "local-model",
      },
    );

    expect(config.provider).toBe("lmstudio");
    expect(config.providerSource).toBe("cli");
    expect(config.model).toBe("explicit-model");
    expect(config.modelSource).toBe("cli");
  });

  it("ignores DEV_PROVIDER and DEV_MODEL outside dev mode", () => {
    expect(
      resolveRuntimeConfig(
        {},
        {
          DEV_PROVIDER: "ollama",
          DEV_MODEL: "local-model",
        },
      ),
    ).toEqual({
      providerSource: "default",
      modelSource: "default",
      codexArgs: ["app-server"],
    });
  });
});
