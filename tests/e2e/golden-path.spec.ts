import { expect, test } from "@playwright/test";

const project = { id: "project-1", name: "North site" };
const evidence = { evidenceId: "evidence-1", kind: "TRANSCRIPT", mediaAssetId: null, transcriptSegmentId: "segment-1", sourceStartSeconds: 4, sourceEndSeconds: 8, label: "Narration", transcriptText: "The flooring is installed.", mediaKind: null, mediaMimeType: null, mediaAvailability: "NOT_APPLICABLE", mediaUrl: null };

function makeObservation(id: string, sequence: number, reviewState: "DRAFT" | "CONFIRMED" | "EDITED" | "DISMISSED", editedText: string | null = null) {
  const originalDraftText = sequence === 0 ? "The flooring is installed." : sequence === 1 ? "Review the north doorway." : "The storage area is organized.";
  return { observationId: id, sequence, type: sequence === 0 ? "PROGRESS" : sequence === 1 ? "ACTION" : "NOTE", sourceBasis: "NARRATION", originalDraftText, editedText, finalDisplayText: editedText ?? originalDraftText, suggestedAction: null, location: null, trade: null, confidence: null, reviewState, reviewerId: reviewState === "DRAFT" ? null : "mvp-reviewer", reviewedAt: reviewState === "DRAFT" ? null : "2026-09-21T10:00:00.000Z", evidence: [{ ...evidence, evidenceId: `${id}-evidence` }] };
}

test("golden path preserves review decisions and report eligibility", async ({ page }) => {
  let observations = [makeObservation("finding-1", 0, "DRAFT"), makeObservation("finding-2", 1, "DRAFT"), makeObservation("finding-3", 2, "DRAFT")];
  let reportGenerated = false;
  let reportRequests = 0;
  const review = () => ({ runStatus: reportGenerated ? "REPORT_READY" : observations.every((observation) => observation.reviewState !== "DRAFT") ? "REVIEWED" : "NEEDS_REVIEW", observations, totalCount: observations.length, reviewedCount: observations.filter((observation) => observation.reviewState !== "DRAFT").length, remainingDrafts: observations.filter((observation) => observation.reviewState === "DRAFT").length, complete: observations.every((observation) => observation.reviewState !== "DRAFT") });
  const reportBase = { reportId: "report-1", generatedAt: "2026-09-21T10:03:00.000Z", generatedBy: "mvp-reviewer", project, walkthrough: { id: "walk-1", title: "Morning walk", capturedAt: null, createdAt: "2026-09-21T09:00:00.000Z", durationSeconds: 90 } };
  const buildReport = () => ({ ...reportBase, findings: observations.filter((observation) => observation.reviewState === "CONFIRMED" || observation.reviewState === "EDITED").map((observation, index) => ({ reportObservationId: `report-observation-${index + 1}`, sourceObservationId: observation.observationId, type: observation.type, sourceBasis: observation.sourceBasis, text: observation.finalDisplayText, suggestedAction: null, location: null, trade: null, reviewState: observation.reviewState, reviewerId: observation.reviewerId, reviewedAt: observation.reviewedAt, evidence: [{ ...evidence, reportEvidenceId: `${observation.observationId}-report-evidence`, sourceWalkthroughId: "walk-1", sourceEvidenceId: `${observation.observationId}-evidence`, applicationUrl: `/walkthroughs/walk-1#finding-${observation.observationId}-evidence-${observation.observationId}-evidence` }] })) });

  await page.route("**/api/projects", (route) => route.fulfill({ json: { projects: [project] } }));
  await page.route("**/api/projects/project-1/walkthroughs", (route) => route.fulfill({ json: { walkthroughs: [] } }));
  await page.route("**/api/projects/project-1/walkthroughs/upload-intent", (route) => route.fulfill({ json: { walkthroughId: "walk-1", assetId: "asset-1", uploadUrl: "https://upload.test/walk-1", requiredHeaders: {} } }));
  await page.route("https://upload.test/**", (route) => route.fulfill({ status: 200 }));
  await page.route("**/api/walkthroughs/walk-1/finalize", (route) => route.fulfill({ json: { run: { id: "run-1", status: "NEEDS_REVIEW", retryCount: 0, errorMessage: null } } }));
  await page.route("**/api/walkthroughs/walk-1/status", (route) => route.fulfill({ json: { walkthrough: { id: "walk-1", title: "Morning walk", project }, asset: { id: "asset-1", status: "AVAILABLE", mimeType: "video/mp4", byteSize: 1024 }, run: { status: reportGenerated ? "REPORT_READY" : observations.every((observation) => observation.reviewState !== "DRAFT") ? "REVIEWED" : "NEEDS_REVIEW", retryCount: 0, failedStep: null, errorMessage: null, retryable: null }, report: reportGenerated ? { id: "report-1" } : null } }));
  await page.route("**/api/walkthroughs/walk-1/observations", (route) => route.fulfill({ json: review() }));
  await page.route("**/api/walkthroughs/walk-1/observations/*/review", async (route) => {
    const body = route.request().postDataJSON() as { state: "CONFIRMED" | "DISMISSED" | "EDITED"; editedText?: string };
    const id = route.request().url().split("/").at(-2);
    observations = observations.map((observation) => observation.observationId === id ? { ...observation, reviewState: body.state, editedText: body.state === "EDITED" ? body.editedText ?? null : null, finalDisplayText: body.state === "EDITED" ? body.editedText ?? observation.finalDisplayText : observation.finalDisplayText, reviewerId: "mvp-reviewer", reviewedAt: "2026-09-21T10:00:00.000Z" } : observation);
    await route.fulfill({ json: { observation: observations.find((observation) => observation.observationId === id), review: review() } });
  });
  await page.route("**/api/walkthroughs/walk-1/report", async (route) => { reportRequests += 1; reportGenerated = true; await route.fulfill({ json: buildReport() }); });

  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({ name: "walkthrough.mp4", mimeType: "video/mp4", buffer: Buffer.from("fixture-video") });
  await page.getByRole("button", { name: "Upload walkthrough" }).click();
  await expect(page).toHaveURL(/\/walkthroughs\/walk-1$/);
  await expect(page.getByRole("heading", { name: "Ready for your review" })).toBeVisible();
  const findings = page.locator('article[data-testid^="finding-"]');
  await expect(findings).toHaveCount(3);
  await findings.nth(0).getByRole("button", { name: "Confirm", exact: true }).click();
  await findings.nth(1).getByRole("button", { name: "Edit", exact: true }).click();
  await findings.nth(1).locator("textarea").fill("Review the north doorway.");
  await findings.nth(1).getByRole("button", { name: "Save edit" }).click();
  await findings.nth(2).getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.getByTestId("review-progress")).toContainText("3 of 3 reviewed");
  await expect(page.getByRole("button", { name: "Generate report" })).toBeVisible();
  await page.getByRole("button", { name: "Generate report" }).click();
  await expect.poll(() => reportRequests).toBe(1);
  const generatedReport = buildReport();
  expect(generatedReport.findings).toHaveLength(2);
  expect(generatedReport.findings.every((finding) => finding.reviewState !== "DISMISSED")).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Report ready" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dismiss", exact: true })).toHaveCount(0);
});
