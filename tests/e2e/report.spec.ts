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
    { reportObservationId: "report-observation-1", sourceObservationId: "confirmed-1", type: "PROGRESS", sourceBasis: "NARRATION", text: "The flooring is installed.", suggestedAction: null, location: "Level 1", trade: "Flooring", reviewState: "CONFIRMED", reviewerId: "mvp-reviewer", reviewedAt: "2026-09-20T10:00:00.000Z", evidence: [{ reportEvidenceId: "report-evidence-1", sourceWalkthroughId: "walk-1", sourceEvidenceId: "evidence-confirmed", mediaAssetId: null, transcriptSegmentId: "segment-1", sourceStartSeconds: 1, sourceEndSeconds: 2, label: "Narration", transcriptText: "Reviewed source", frameUrl: null, mediaAvailability: "NOT_APPLICABLE", applicationUrl: "/walkthroughs/walk-1" }] },
    { reportObservationId: "report-observation-2", sourceObservationId: "edited-1", type: "ACTION", sourceBasis: "NARRATION", text: "Ask the site supervisor to review the doorway.", suggestedAction: null, location: "North doorway", trade: null, reviewState: "EDITED", reviewerId: "mvp-reviewer", reviewedAt: "2026-09-20T10:01:00.000Z", evidence: [{ reportEvidenceId: "report-evidence-2", sourceWalkthroughId: "walk-1", sourceEvidenceId: "evidence-edited", mediaAssetId: null, transcriptSegmentId: "segment-1", sourceStartSeconds: 1, sourceEndSeconds: 2, label: "Narration", transcriptText: "Reviewed source", frameUrl: null, mediaAvailability: "NOT_APPLICABLE", applicationUrl: "/walkthroughs/walk-1" }] },
  ],
};

test("completed review exposes a working report-generation action", async ({ page }) => {
  let reportRequests = 0;
  await page.route("**/api/walkthroughs/walk-1/status", (route) => route.fulfill({ json: { walkthrough: { id: "walk-1", title: "Morning walk", project: { id: "project-1", name: "North site" } }, asset: { id: "asset-1", status: "AVAILABLE", mimeType: "video/mp4", byteSize: 100 }, run: { status: "REVIEWED", retryCount: 0, failedStep: null, errorMessage: null, retryable: null }, report: null } }));
  await page.route("**/api/walkthroughs/walk-1/observations", (route) => route.fulfill({ json: review }));
  await page.route("**/api/walkthroughs/walk-1/report", async (route) => { reportRequests += 1; await route.fulfill({ json: report }); });
  await page.addInitScript(() => {
    const pushState = history.pushState.bind(history);
    const replaceState = history.replaceState.bind(history);
    const captureReportNavigation = (url: string | URL | null | undefined): boolean => {
      if (typeof url === "string" && url.includes("/reports/")) {
        window.name = url;
        return true;
      }
      return false;
    };
    history.pushState = (state, title, url) => {
      if (captureReportNavigation(url)) return;
      pushState(state, title, url);
    };
    history.replaceState = (state, title, url) => {
      if (captureReportNavigation(url)) return;
      replaceState(state, title, url);
    };
  });

  await page.goto("/walkthroughs/walk-1");
  await expect(page.getByRole("button", { name: "Generate report" })).toBeVisible();
  await page.getByRole("button", { name: "Generate report" }).click();
  await expect.poll(() => reportRequests).toBe(1);
  await expect.poll(() => page.evaluate(() => window.name)).toContain("/reports/report-1");
});
