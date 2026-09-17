import { z } from "zod";

export const SourceBasisSchema = z.enum(["NARRATION", "VISUAL", "NARRATION_AND_VISUAL"]);
export type SourceBasis = z.infer<typeof SourceBasisSchema>;

export const EvidenceReferenceSchema = z.object({
  evidenceId: z.string().min(1),
  walkthroughId: z.string().min(1),
  mediaAssetId: z.string().min(1).optional(),
  transcriptSegmentId: z.string().min(1).optional(),
  startSeconds: z.number().finite().nonnegative().optional(),
  endSeconds: z.number().finite().nonnegative().optional(),
  label: z.string().trim().min(1).optional(),
}).superRefine((value, ctx) => {
  if (!value.mediaAssetId && !value.transcriptSegmentId) {
    ctx.addIssue({ code: "custom", message: "Evidence must reference a media asset or transcript segment." });
  }
  if (value.startSeconds !== undefined && value.endSeconds !== undefined && value.endSeconds < value.startSeconds) {
    ctx.addIssue({ code: "custom", path: ["endSeconds"], message: "Evidence end must be after its start." });
  }
});
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const ObservationTypeSchema = z.enum(["PROGRESS", "POTENTIAL_ISSUE", "ACTION", "NOTE"]);
export type ObservationType = z.infer<typeof ObservationTypeSchema>;

export const ReviewStateSchema = z.enum(["DRAFT", "CONFIRMED", "EDITED", "DISMISSED"]);
export type ReviewState = z.infer<typeof ReviewStateSchema>;

export const ObservationDraftSchema = z.object({
  type: ObservationTypeSchema,
  sourceBasis: SourceBasisSchema,
  description: z.string().trim().min(1),
  location: z.string().trim().min(1).optional(),
  trade: z.string().trim().min(1).optional(),
  confidence: z.number().finite().min(0).max(1).optional(),
  evidence: z.array(EvidenceReferenceSchema).min(1),
  reviewState: z.literal("DRAFT").default("DRAFT"),
});
export type ObservationDraft = z.infer<typeof ObservationDraftSchema>;

export const ReviewDecisionSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("CONFIRMED") }),
  z.object({ state: z.literal("EDITED"), editedText: z.string().trim().min(1) }),
  z.object({ state: z.literal("DISMISSED") }),
]);
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export const ReportEligibleFindingSchema = z.object({
  id: z.string().min(1),
  type: ObservationTypeSchema,
  text: z.string().trim().min(1),
  reviewState: z.enum(["CONFIRMED", "EDITED"]),
  evidence: z.array(EvidenceReferenceSchema).min(1),
});
export type ReportEligibleFinding = z.infer<typeof ReportEligibleFindingSchema>;
