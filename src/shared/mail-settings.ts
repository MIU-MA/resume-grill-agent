export type MailSettings = {
  address: string;
  provider: "qq" | "163" | "126";
  enabled: boolean;
};
export const defaultMailSettings: MailSettings = {
  address: "",
  provider: "qq",
  enabled: false,
};
export function mailCredentialRef(address: string, provider: string) {
  return (
    "RESUME_GRILL_SMTP_" +
    Array.from(`${provider}:${address.trim().toLowerCase()}`)
      .map((character) =>
        character.codePointAt(0)!.toString(16).padStart(4, "0"),
      )
      .join("")
  );
}
