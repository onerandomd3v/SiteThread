import { z } from "zod";
import { ObservationTypeSchema, SourceBasisSchema } from "./media";

export const ReportEvidenceSchema = z.object({
  reportEvidenceId: z.string().min(1),
  sourceWalkthroughId: z.string().min(1),
  sourceEvidenceId: z.string().min(1),
  mediaAssetId: z.string().min(1).nullable(),
  transcriptSegmentId: z.string().min(1).nullable(),
  sourceStartSeconds: z.number().finite().nonnegative().nullable(),
  sourceEndSeconds: z.number().finite().nonnegative().nullable(),
  label: z.string().min(1),
  transcriptText: z.string().min(1).nullable(),
  frameUrl: z.string().min(1).nullable(),
  mediaAvailability: z.enum(["AVAILABLE", "UNAVAILABLE", "NOT_APPLICABLE"]),
  applicationUrl: z.string().min(1),
});
export type ReportEvidence = z.infer<typeof ReportEvidenceSchema>;

export const ReportFindingSchema = z.object({
  reportObservationId: z.string().min(1),
  sourceObservationId: z.string().min(1),
  type: ObservationTypeSchema,
  sourceBasis: SourceBasisSchema,
  text: z.string().trim().min(1),
  suggestedAction: z.string().trim().min(1).nullable(),
  location: z.string().trim().min(1).nullable(),
  trade: z.string().trim().min(1).nullable(),
  reviewState: z.enum(["CONFIRMED", "EDITED"]),
  reviewerId: z.string().min(1).nullable(),
  reviewedAt: z.coerce.date().nullable(),
  evidence: z.array(ReportEvidenceSchema).min(1),
});
export type ReportFinding = z.infer<typeof ReportFindingSchema>;

export const SiteReportSchema = z.object({
  reportId: z.string().min(1),
  generatedAt: z.coerce.date(),
  generatedBy: z.string().min(1).nullable(),
  project: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  walkthrough: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    capturedAt: z.coerce.date().nullable(),
    createdAt: z.coerce.date(),
    durationSeconds: z.number().finite().nonnegative().nullable(),
  }),
  findings: z.array(ReportFindingSchema).min(1),
});
export type SiteReport = z.infer<typeof SiteReportSchema>;
