export const brandName = "Resume Grill";
export const quickEntryName = "求职快开";
export const mailSettingsName = `${brandName} 邮箱`;
export const moduleSettingsName = `${brandName} 模块`;

declare const __DS_CHAN__: string;

export function DsPortrait({ size, alt = "" }: { size: number; alt?: string }) {
  if (typeof __DS_CHAN__ !== "string") return null;
  return <img className="rg-ds-portrait" src={__DS_CHAN__} alt={alt} width={size} height={size} />;
}
