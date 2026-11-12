import { z } from "zod";

export const applicationMail = z
  .object({
    recipient: z.email(),
    subject: z
      .string()
      .min(1)
      .max(200)
      .refine(
        (value) => /\S/.test(value) && !/[\r\n]/.test(value),
        "主题不能为空或包含换行。",
      ),
    body: z
      .string()
      .min(1)
      .max(20000)
      .refine((value) => /\S/.test(value), "正文不能为空。"),
  })
  .strict();
export type ApplicationMail = z.infer<typeof applicationMail>;
