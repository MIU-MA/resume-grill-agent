export const brandName = "鲸历";
export const quickEntryName = "鲸历快开";

declare const __DS_CHAN__: string;

export function DsPortrait({ size, alt = "" }: { size: number; alt?: string }) {
  if (typeof __DS_CHAN__ !== "string") return null;
  return <img className="rg-ds-portrait" src={__DS_CHAN__} alt={alt} width={size} height={size} />;
}
