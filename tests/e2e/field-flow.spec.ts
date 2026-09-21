import { expect, test } from "@playwright/test";

const project = { id: "project-1", name: "North site" };

function projectRoutes(page: import("@playwright/test").Page) {
  return Promise.all([
    page.route("**/api/projects", (route) => route.fulfill({ json: { projects: [project] } })),
    page.route("**/api/projects/project-1/walkthroughs", (route) => route.fulfill({ json: { walkthroughs: [{ id: "walk-previous", title: "Previous site walk", createdAt: "2026-09-20T09:00:00.000Z", updatedAt: "2026-09-20T10:00:00.000Z", run: { status: "NEEDS_REVIEW", updatedAt: "2026-09-20T10:00:00.000Z" }, report: null }] } })),
  ]);
}

test("home continues a selected project without inventing walkthrough data", async ({ page }) => {
  await projectRoutes(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Recent walkthroughs" })).toBeVisible();
  await expect(page.getByText("Previous site walk")).toBeVisible();
  await expect(page.getByText("Ready for your review")).toBeVisible();
  await expect(page.getByText("Latest five for this project")).toBeVisible();
});

test("upload navigates to friendly processing stages and refreshes status", async ({ page }) => {
  let statusRequests = 0;
  await projectRoutes(page);
  await page.route("**/api/projects/project-1/walkthroughs/upload-intent", (route) => route.fulfill({ json: { walkthroughId: "walk-new", assetId: "asset-new", uploadUrl: "https://upload.test/walk-new", requiredHeaders: {} } }));
  await page.route("https://upload.test/**", (route) => route.fulfill({ status: 200 }));
  await page.route("**/api/walkthroughs/walk-new/finalize", (route) => route.fulfill({ json: { run: { id: "run-new", status: "QUEUED", retryCount: 0, errorMessage: null } } }));
  await page.route("**/api/walkthroughs/walk-new/status", (route) => { statusRequests += 1; return route.fulfill({ json: { walkthrough: { id: "walk-new", title: "New walkthrough", project }, asset: { status: "AVAILABLE", mimeType: "video/mp4", byteSize: 1024 }, run: { status: statusRequests <= 2 ? "QUEUED" : "TRANSCRIBING", retryCount: 0, failedStep: null, errorMessage: null, retryable: null }, report: null } }); });

  await page.goto("/");
  await expect(page.locator("select")).toHaveValue("project-1");
  await page.locator("input[type=file]").setInputFiles({ name: "walkthrough.mp4", mimeType: "video/mp4", buffer: Buffer.from("test-video") });
  await page.getByRole("button", { name: "Upload walkthrough" }).click();
  await expect(page).toHaveURL(/\/walkthroughs\/walk-new$/);
  await expect(page.getByRole("heading", { name: "Queued for processing" })).toBeVisible();
  await expect(page.getByText("QUEUED", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.getByRole("heading", { name: "Reading narration" })).toBeVisible();
});

test("processing failure presents a recoverable retry action", async ({ page }) => {
  let retryRequests = 0;
  await page.route("**/api/walkthroughs/walk-failed/status", (route) => route.fulfill({ json: { walkthrough: { id: "walk-failed", title: "Failed walkthrough", project }, asset: { status: "AVAILABLE", mimeType: "video/mp4", byteSize: 1024 }, run: { status: retryRequests ? "QUEUED" : "PROCESSING_FAILED", retryCount: retryRequests, failedStep: "ANALYZING_MEDIA", errorMessage: "Visual evidence could not be prepared.", retryable: true }, report: null } }));
  await page.route("**/api/walkthroughs/walk-failed/retry", (route) => { retryRequests += 1; return route.fulfill({ json: { run: { status: "QUEUED" } } }); });
  await page.goto("/walkthroughs/walk-failed");
  await expect(page.getByRole("heading", { name: "Processing needs attention" })).toBeVisible();
  await page.getByRole("button", { name: "Retry processing" }).click();
  await expect(page.getByRole("heading", { name: "Queued for processing" })).toBeVisible();
});

test("manual recovery restarts polling after a failed status request", async ({ page }) => {
  let statusRequests = 0;
  let recoveryRequests = 0;
  let allowRecovery = false;
  let recoveryStartedAt = 0;
  let resumedAt = 0;
  await page.route("**/api/walkthroughs/walk-recovery/status", async (route) => {
    statusRequests += 1;
    if (!allowRecovery) return route.fulfill({ status: 503, json: { error: { message: "Temporary status failure." } } });
    recoveryRequests += 1;
    if (recoveryRequests >= 3) resumedAt ||= Date.now();
    return route.fulfill({ json: { walkthrough: { id: "walk-recovery", title: "Recovery walkthrough", project }, asset: { status: "AVAILABLE", mimeType: "video/mp4", byteSize: 1024 }, run: { status: recoveryRequests >= 3 ? "TRANSCRIBING" : "QUEUED", retryCount: 0, failedStep: null, errorMessage: null, retryable: null }, report: null } });
  });
  await page.goto("/walkthroughs/walk-recovery");
  await expect(page.locator("main [role=alert]")).toContainText("Temporary status failure.");
  await expect.poll(() => statusRequests).toBeGreaterThanOrEqual(1);
  recoveryStartedAt = Date.now();
  allowRecovery = true;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Queued for processing" })).toBeVisible();
  await expect.poll(() => recoveryRequests, { timeout: 12000 }).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole("heading", { name: "Reading narration" })).toBeVisible();
  expect(resumedAt - recoveryStartedAt).toBeGreaterThanOrEqual(3500);
});

test("status refreshes never overlap while an earlier response is settling", async ({ page }) => {
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  let delayResponses = false;
  await page.route("**/api/walkthroughs/walk-overlap/status", async (route) => {
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    try {
      if (delayResponses) await new Promise((resolve) => setTimeout(resolve, 100));
      await route.fulfill({ json: { walkthrough: { id: "walk-overlap", title: "Overlap check", project }, asset: { status: "AVAILABLE", mimeType: "video/mp4", byteSize: 1024 }, run: { status: "REVIEWED", retryCount: 0, failedStep: null, errorMessage: null, retryable: null }, report: null } });
    } finally {
      activeRequests -= 1;
    }
  });
  await page.route("**/api/walkthroughs/walk-overlap/observations", (route) => route.fulfill({ json: { runStatus: "REVIEWED", totalCount: 0, reviewedCount: 0, remainingDrafts: 0, complete: true, observations: [] } }));
  await page.goto("/walkthroughs/walk-overlap");
  await expect(page.getByRole("heading", { name: "Review complete" })).toBeVisible();
  await expect.poll(() => activeRequests).toBe(0);
  await page.waitForLoadState("networkidle");
  maximumActiveRequests = 0;
  delayResponses = true;
  await page.getByRole("button", { name: "Refresh status" }).evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(() => maximumActiveRequests).toBe(1);
});
