import { z } from "zod";

export const ProviderTranscriptSegmentSchema = z.object({
  text: z.string().trim().min(1),
  startSeconds: z.number().finite().nonnegative().optional(),
  endSeconds: z.number().finite().nonnegative().optional(),
  speaker: z.string().trim().min(1).optional(),
  language: z.string().trim().min(1).optional(),
});

export const ProviderTranscriptResultSchema = z.object({
  text: z.string().trim().min(1),
  segments: z.array(ProviderTranscriptSegmentSchema).optional(),
}).passthrough();
export type ProviderTranscriptResult = z.infer<typeof ProviderTranscriptResultSchema>;

export const ProviderVisionResultSchema = z.object({
  text: z.string().trim().min(1),
  sourceStartSeconds: z.number().finite().nonnegative().optional(),
  sourceEndSeconds: z.number().finite().nonnegative().optional(),
}).passthrough();
export type ProviderVisionResult = z.infer<typeof ProviderVisionResultSchema>;
