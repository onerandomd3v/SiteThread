import { z } from "zod";

export const ReasonedObservationSchema = z.strictObject({
  type: z.enum(["progress", "potential_issue", "action", "note"]),
  description: z.string().trim().min(1).max(600),
  location: z.string().trim().min(1).max(120).optional(),
  trade: z.string().trim().min(1).max(120).optional(),
  confidence: z.number().finite().min(0).max(1).optional(),
  suggestedAction: z.string().trim().min(1).max(400).optional(),
  evidenceRefs: z.array(z.string().regex(/^[TV]\d+$/)).min(1).max(12),
}).superRefine((value, context) => {
  if (new Set(value.evidenceRefs).size !== value.evidenceRefs.length) {
    context.addIssue({ code: "custom", path: ["evidenceRefs"], message: "Evidence references must be unique." });
  }
});

export const ObservationReasoningOutputSchema = z.strictObject({
  observations: z.array(ReasonedObservationSchema).max(20),
});

export type ReasonedObservation = z.infer<typeof ReasonedObservationSchema>;
export type ObservationReasoningOutput = z.infer<typeof ObservationReasoningOutputSchema>;
