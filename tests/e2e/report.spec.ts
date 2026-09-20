import { expect, test } from "@playwright/test";

const evidence = { kind: "TRANSCRIPT", mediaAssetId: null, transcriptSegmentId: "segment-1", sourceStartSeconds: 1, sourceEndSeconds: 2, label: "Narration", transcriptText: "Reviewed source", mediaKind: null, mediaMimeType: null, mediaAvailability: "NOT_APPLICABLE", mediaUrl: null };

const review = {
  runStatus: "REVIEWED",
  totalCount: 3,
  reviewedCount: 3,
  remainingDrafts: 0,
  complete: true,
  observations: [
    { observationId: "confirmed-1", sequence: 0, type: "PROGRESS", sourceBasis: "NARRATION", originalDraftText: "The flooring is installed.", editedText: null, finalDisplayText: "The flooring is installed.", suggestedAction: null, location: "Level 1", trade: "Flooring", confidence: null, reviewState: "CONFIRMED", reviewerId: "mvp-reviewer", reviewedAt: "2026-09-20T10:00:00.000Z", evidence: [{ ...evidence, evidenceId: "evidence-confirmed" }] },
    { observationId: "edited-1", sequence: 1, type: "ACTION", sourceBasis: "NARRATION", originalDraftText: "Review the doorway.", editedText: "Ask the site supervisor to review the doorway.", finalDisplayText: "Ask the site supervisor to review the doorway.", suggestedAction: null, location: "North doorway", trade: null, confidence: null, reviewState: "EDITED", reviewerId: "mvp-reviewer", reviewedAt: "2026-09-20T10:01:00.000Z", evidence: [{ ...evidence, evidenceId: "evidence-edited" }] },
    { observationId: "dismissed-1", sequence: 2, type: "NOTE", sourceBasis: "VISUAL", originalDraftText: "A dismissed note.", editedText: null, finalDisplayText: "A dismissed note.", suggestedAction: null, location: null, trade: null, confidence: null, reviewState: "DISMISSED", reviewerId: "mvp-reviewer", reviewedAt: "2026-09-20T10:02:00.000Z", evidence: [{ ...evidence, evidenceId: "evidence-dismissed", kind: "MEDIA", mediaAssetId: "asset-1", transcriptSegmentId: null, transcriptText: null, mediaKind: "EVIDENCE_CLIP", mediaMimeType: "video/mp4", mediaAvailability: "AVAILABLE", mediaUrl: "https://media.test/evidence.mp4" }] },
  ],
};

const report = {
  reportId: "report-1",
  generatedAt: "2026-09-20T10:03:00.000Z",
  generatedBy: "mvp-reviewer",
  project: { id: "project-1", name: "North site" },
  walkthrough: { id: "walk-1", title: "Morning walk", capturedAt: null, createdAt: "2026-09-20T09:00:00.000Z", durationSeconds: 30 },
  findings: [
    { reportObservationId: "report-observation-1", sourceObservationId: "confirmed-1", type: "PROGRESS", sourceBasis: "NARRATION", text: "The flooring is installed.", suggestedAction: null, location: "Level 1", trade: "Flooring", reviewState: "CONFIRMED", reviewerId: "mvp-reviewer", reviewedAt: "2026-09-20T10:00:00.000Z", evidence: [{ reportEvidenceId: "report-evidence-1", sourceWalkthroughId: "walk-1", sourceEvidenceId: "evidence-confirmed", mediaAssetId: null, transcriptSegmentId: "segment-1", sourceStartSeconds: 1, sourceEndSeconds: 2, label: "Narration", transcriptText: "Reviewed source", frameUrl: null, mediaAvailability: "NOT_APPLICABLE", applicationUrl: "/walkthroughs/walk-1#finding-confirmed-1-evidence-evidence-confirmed" }] },
    { reportObservationId: "report-observation-2", sourceObservationId: "edited-1", type: "ACTION", sourceBasis: "NARRATION", text: "Ask the site supervisor to review the doorway.", suggestedAction: null, location: "North doorway", trade: null, reviewState: "EDITED", reviewerId: "mvp-reviewer", reviewedAt: "2026-09-20T10:01:00.000Z", evidence: [{ reportEvidenceId: "report-evidence-2", sourceWalkthroughId: "walk-1", sourceEvidenceId: "evidence-edited", mediaAssetId: null, transcriptSegmentId: "segment-1", sourceStartSeconds: 1, sourceEndSeconds: 2, label: "Narration", transcriptText: "Reviewed source", frameUrl: null, mediaAvailability: "NOT_APPLICABLE", applicationUrl: "/walkthroughs/walk-1#finding-edited-1-evidence-evidence-edited" }] },
  ],
};

test("completed review exposes a working report-generation action", async ({ page }) => {
  let reportRequests = 0;
  await page.route("**/api/walkthroughs/walk-1/status", (route) => route.fulfill({ json: { walkthrough: { id: "walk-1", title: "Morning walk", project: { id: "project-1", name: "North site" } }, asset: { id: "asset-1", status: "AVAILABLE", mimeType: "video/mp4", byteSize: 100 }, run: { status: "REVIEWED", retryCount: 0, failedStep: null, errorMessage: null, retryable: null }, report: null } }));
  await page.route("**/api/walkthroughs/walk-1/observations", (route) => route.fulfill({ json: review }));
  await page.route("**/api/walkthroughs/walk-1/report", async (route) => { reportRequests += 1; await route.fulfill({ json: report }); });

  await page.goto("/walkthroughs/walk-1");
  await expect(page.getByRole("button", { name: "Generate report" })).toBeVisible();
  await page.getByRole("button", { name: "Generate report" }).click();
  await expect.poll(() => reportRequests).toBe(1);
});

test("report evidence returns to a REPORT_READY walkthrough as read-only anchored evidence", async ({ page }) => {
  let reportRequests = 0;
  await page.route("**/api/walkthroughs/walk-1/status", (route) => route.fulfill({ json: {
    walkthrough: { id: "walk-1", title: "Morning walk", project: { id: "project-1", name: "North site" } },
    asset: { id: "asset-1", status: "AVAILABLE", mimeType: "video/mp4", byteSize: 100 },
    run: { status: reportRequests > 0 ? "REPORT_READY" : "REVIEWED", retryCount: 0, failedStep: null, errorMessage: null, retryable: null },
    report: reportRequests > 0 ? { id: "report-1" } : null,
  } }));
  await page.route("**/api/walkthroughs/walk-1/observations", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ json: { ...review, runStatus: reportRequests > 0 ? "REPORT_READY" : "REVIEWED" } });
  });
  await page.route("**/api/walkthroughs/walk-1/report", async (route) => {
    reportRequests += 1;
    await route.fulfill({ json: report });
  });
  await page.goto("/walkthroughs/walk-1");
  await expect(page.getByRole("button", { name: "Generate report" })).toBeVisible();
  await page.getByRole("button", { name: "Generate report" }).click();
  await expect.poll(() => reportRequests).toBe(1);

  await page.setContent('<main><h1>Reviewed site record</h1><a href="/walkthroughs/walk-1#finding-confirmed-1-evidence-evidence-confirmed">Open source evidence</a></main>');
  await page.evaluate(() => history.replaceState(null, "", "/reports/report-1"));
  await page.getByRole("link", { name: "Open source evidence" }).click();
  await expect(page).toHaveURL(/\/walkthroughs\/walk-1#finding-confirmed-1-evidence-evidence-confirmed$/);
  await expect(page.locator("#finding-confirmed-1-evidence-evidence-confirmed")).toBeVisible();
  await expect(page.getByRole("link", { name: "View report" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate report" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dismiss", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Boolean(document.getElementById("finding-confirmed-1-evidence-evidence-confirmed")))).toBe(true);
});
