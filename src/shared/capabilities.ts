export const capabilityLabels = {
  mail: "邮件投递",
  boss: "BOSS 投递",
  website: "官网填写",
} as const;

export type Capability = keyof typeof capabilityLabels;
export const capabilities = Object.keys(capabilityLabels) as Capability[];

export function hasCapability(
  enabled: readonly Capability[] | undefined,
  capability: Capability,
) {
  return (enabled ?? capabilities).includes(capability);
}
