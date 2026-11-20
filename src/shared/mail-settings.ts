export type MailSettings = {
  address: string;
  provider: "qq" | "163" | "126" | "custom";
  enabled: boolean;
  host?: string;
  port?: number;
  security?: "tls" | "starttls";
};
export const defaultMailSettings: MailSettings = {
  address: "",
  provider: "qq",
  enabled: false,
  host: "",
  port: 465,
  security: "tls",
};
const presets = new Map([["qq", "smtp.qq.com"], ["163", "smtp.163.com"], ["126", "smtp.126.com"]]);
export function smtpEndpoint(config: { provider: string; host?: string; port?: number; security?: string }) {
  const { provider, port, security } = config;
  const host = config.host?.trim().toLowerCase();
  if (provider === "custom") {
    if (!host || host.length > 253 || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(host) ||
        !Number.isInteger(port) || port! < 1 || port! > 65535 || (security !== "tls" && security !== "starttls")) return;
    return { host, port: port!, security };
  }
  const server = presets.get(provider);
  return server ? { host: server, port: 465, security: "tls" as const } : undefined;
}

export function mailCredentialRef(address: string, provider: string, config?: Pick<MailSettings, "host" | "port" | "security">) {
  const endpoint = provider === "custom" && smtpEndpoint({ ...config, provider });
  const identity = `${provider}:${address.trim().toLowerCase()}${endpoint ? `:${endpoint.host}:${endpoint.port}:${endpoint.security}` : ""}`;
  return (
    "RESUME_GRILL_SMTP_" +
    Array.from(identity)
      .map((character) =>
        character.codePointAt(0)!.toString(16).padStart(4, "0"),
      )
      .join("")
  );
}
