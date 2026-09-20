import { ReviewMutationResponseSchema, type ReviewMutationResponse } from "@/lib/schemas/review";

type ReviewDecision = { state: "CONFIRMED" | "DISMISSED" } | { state: "EDITED"; editedText: string };

export async function saveReviewDecision(
  fetcher: typeof fetch,
  walkthroughId: string,
  observationId: string,
  decision: ReviewDecision,
): Promise<ReviewMutationResponse> {
  const response = await fetcher(`/api/walkthroughs/${walkthroughId}/observations/${observationId}/review`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(decision),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) {
    const errorBody = payload as { error?: { message?: string } };
    throw new Error(errorBody.error?.message ?? "The review decision could not be saved.");
  }
  return ReviewMutationResponseSchema.parse(payload);
}
