import { z } from "zod";
import { ObservationTypeSchema, ReviewStateSchema, SourceBasisSchema } from "./media";

export const ReviewEvidenceSchema = z.object({
  evidenceId: z.string().min(1),
  kind: z.enum(["TRANSCRIPT", "MEDIA"]),
  mediaAssetId: z.string().min(1).nullable(),
  transcriptSegmentId: z.string().min(1).nullable(),
  sourceStartSeconds: z.number().finite().nonnegative().nullable(),
  sourceEndSeconds: z.number().finite().nonnegative().nullable(),
  label: z.string().min(1).nullable(),
  transcriptText: z.string().min(1).nullable(),
  mediaKind: z.string().min(1).nullable(),
  mediaMimeType: z.string().min(1).nullable(),
  mediaAvailability: z.enum(["AVAILABLE", "UNAVAILABLE", "NOT_APPLICABLE"]),
  mediaUrl: z.string().url().nullable(),
});

export const ReviewObservationSchema = z.object({
  observationId: z.string().min(1),
  sequence: z.number().int().nonnegative().nullable(),
  type: ObservationTypeSchema,
  sourceBasis: SourceBasisSchema,
  originalDraftText: z.string().min(1),
  editedText: z.string().min(1).nullable(),
  finalDisplayText: z.string().min(1),
  suggestedAction: z.string().min(1).nullable(),
  location: z.string().min(1).nullable(),
  trade: z.string().min(1).nullable(),
  confidence: z.number().finite().min(0).max(1).nullable(),
  reviewState: ReviewStateSchema,
  reviewerId: z.string().min(1).nullable(),
  reviewedAt: z.coerce.date().nullable(),
  evidence: z.array(ReviewEvidenceSchema).min(1),
});

export const WalkthroughReviewSchema = z.object({
  runStatus: z.string().min(1).nullable(),
  observations: z.array(ReviewObservationSchema),
  totalCount: z.number().int().nonnegative(),
  reviewedCount: z.number().int().nonnegative(),
  remainingDrafts: z.number().int().nonnegative(),
  complete: z.boolean(),
});

export const ReviewMutationResponseSchema = z.object({
  observation: ReviewObservationSchema,
  review: WalkthroughReviewSchema,
});

export type ReviewEvidence = z.infer<typeof ReviewEvidenceSchema>;
export type ReviewObservation = z.infer<typeof ReviewObservationSchema>;
export type WalkthroughReview = z.infer<typeof WalkthroughReviewSchema>;
export type ReviewMutationResponse = z.infer<typeof ReviewMutationResponseSchema>;
