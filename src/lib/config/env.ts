import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().url().optional(),
);

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  R2_ACCOUNT_ID: optionalSecret,
  R2_BUCKET_NAME: z.string().trim().min(1),
  R2_ACCESS_KEY_ID: optionalSecret,
  R2_SECRET_ACCESS_KEY: optionalSecret,
  TRIGGER_SECRET_KEY: optionalSecret,
  TRIGGER_PROJECT_REF: optionalSecret,
  LIVEPEER_MCP_URL: optionalUrl,
  LIVEPEER_CREATIVE_MCP_URL: optionalUrl,
  LIVEPEER_MCP_BEARER: optionalSecret,
  MEDIA_PROVIDER_MODE: z.enum(["live", "fixture"]).default("fixture"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(values: Record<string, string | undefined> = process.env): ServerEnv {
  return serverEnvSchema.parse(values);
}
