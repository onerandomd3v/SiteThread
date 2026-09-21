import { z } from "zod";

const liveRehearsalSchema = z.object({
  DATABASE_URL: z.string().url(),
  R2_ACCOUNT_ID: z.string().trim().min(1),
  R2_BUCKET_NAME: z.string().trim().min(1),
  R2_ACCESS_KEY_ID: z.string().trim().min(1),
  R2_SECRET_ACCESS_KEY: z.string().trim().min(1),
  TRIGGER_SECRET_KEY: z.string().trim().min(1),
  TRIGGER_PROJECT_REF: z.string().trim().min(1),
  LIVEPEER_MCP_URL: z.string().url(),
  LIVEPEER_MCP_BEARER: z.string().trim().min(1),
  MEDIA_PROVIDER_MODE: z.literal("live"),
  LIVE_REHEARSAL: z.literal("true"),
  REHEARSAL_REFERENCE_VIDEO: z.string().trim().min(1),
  REHEARSAL_MEDIA_CONSENT: z.literal("confirmed"),
  REHEARSAL_DATABASE_CONSENT: z.literal("disposable"),
  REHEARSAL_BASE_URL: z.string().url().default("http://localhost:3002"),
});

export type LiveRehearsalConfig = z.infer<typeof liveRehearsalSchema>;

export function parseLiveRehearsalConfig(values: Record<string, string | undefined> = process.env): LiveRehearsalConfig {
  const parsed = liveRehearsalSchema.safeParse(values);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Live rehearsal is not configured; refusing to run: ${missing}`);
  }
  return parsed.data;
}
