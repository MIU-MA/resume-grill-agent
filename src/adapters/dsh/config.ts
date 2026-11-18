import Schema from "@deepseek-ai/schemastery";
import { z } from "zod";
import { capabilities } from "../../shared/capabilities.js";

export const NativeConfig = Schema.object({
  address: Schema.string().default("").volatile(),
  provider: Schema.union(["qq", "163", "126"]).default("qq").volatile(),
  enabled: Schema.boolean().default(false).volatile(),
  // DSH exposes volatile fields to its settings client. The host reads this
  // selection once per mount so an edit cannot interrupt an active batch.
  disabledCapabilities: Schema.array(Schema.union(capabilities))
    .default([])
    .volatile(),
});

const disabledModules = z.array(z.enum(capabilities)).default([]);

export function activeCapabilities(disabled: unknown) {
  const value =
    disabled &&
    typeof disabled === "object" &&
    "get" in disabled &&
    typeof disabled.get === "function"
      ? disabled.get()
      : disabled;
  const excluded = new Set(disabledModules.parse(value));
  return capabilities.filter((capability) => !excluded.has(capability));
}
