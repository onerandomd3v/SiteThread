import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("completes two fresh live golden-path runs", async ({ browser, baseURL }) => {
  const referencePath = process.env.REHEARSAL_REFERENCE_VIDEO;
  if (!referencePath || process.env.MEDIA_PROVIDER_MODE !== "live" || process.env.LIVE_REHEARSAL !== "true") throw new Error("NOT A LIVE ACCEPTANCE RUN: explicit live rehearsal configuration is required.");
  const referenceFingerprint = process.env.REHEARSAL_REFERENCE_FINGERPRINT ?? createHash("sha256").update(await readFile(referencePath)).digest("hex");
  const runs: Array<Record<string, unknown>> = [];
  for (let index = 0; index < 2; index += 1) {
    const startedAt = Date.now();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    const projectSelect = page.locator("select");
    await expect(projectSelect).toBeVisible();
    if (!(await projectSelect.inputValue())) {
      await page.getByPlaceholder("New project name").fill(`Live rehearsal ${new Date().toISOString()} ${index + 1}`);
      await page.getByRole("button", { name: "Create" }).click();
      await expect(projectSelect).not.toHaveValue("");
    }
    await page.locator("input[type=file]").setInputFiles(referencePath);
    await page.getByRole("button", { name: "Upload walkthrough" }).click();
    await expect(page).toHaveURL(/\/walkthroughs\/[^/]+$/, { timeout: 120_000 });
    const walkthroughId = new URL(page.url()).pathname.split("/").pop();
    if (!walkthroughId) throw new Error("The live upload did not produce a walkthrough ID.");
    await expect(page.getByRole("heading", { name: "Ready for your review" })).toBeVisible({ timeout: 2 * 60 * 60 * 1000 });
    const findings = page.locator('article[data-testid^="finding-"]');
    await expect.poll(() => findings.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
    const findingCount = await findings.count();
    await expect(findings.nth(0).getByText(/Evidence/)).toBeVisible();
    await findings.nth(0).getByRole("button", { name: "Confirm", exact: true }).click();
    for (let index = 1; index < findingCount; index += 1) {
      if (index === 1) {
        await findings.nth(index).getByRole("button", { name: "Edit", exact: true }).click();
        const edit = findings.nth(index).locator("textarea");
        await edit.fill(`${await edit.inputValue()}.`);
        await findings.nth(index).getByRole("button", { name: "Save edit" }).click();
      } else {
        await findings.nth(index).getByRole("button", { name: "Dismiss", exact: true }).click();
      }
    }
    await expect(page.getByTestId("review-progress")).toContainText(`${findingCount} of ${findingCount} reviewed`);
    await page.getByRole("button", { name: /Generate report|Preparing reviewed record/ }).click();
    await expect(page).toHaveURL(/\/reports\/[^/]+$/, { timeout: 120_000 });
    const reportId = new URL(page.url()).pathname.split("/").pop();
    if (!reportId) throw new Error("The live report URL did not contain a report ID.");
    await expect(page.getByRole("heading", { name: "Reviewed site record" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Print / Save PDF" })).toBeVisible();
    const evidenceLinks = page.getByRole("link", { name: "Open source evidence" });
    await expect(evidenceLinks).toHaveCount(2);
    await evidenceLinks.first().click();
    await expect(page).toHaveURL(new RegExp(`/walkthroughs/${walkthroughId}#finding-`));
    await expect(page.locator("[id^=finding-]").first()).toBeVisible();
    await page.goto(`${baseURL}/reports/${reportId}`);
    await page.pdf({ path: `.rehearsal/${walkthroughId}.pdf`, format: "A4" });
    await page.goto(`${baseURL}/walkthroughs/${walkthroughId}`);
    await expect(page.getByRole("heading", { name: "Report ready" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Dismiss", exact: true })).toHaveCount(0);
    runs.push({ walkthroughId, reportId, referenceFingerprint, mode: "live", elapsedMs: Date.now() - startedAt, findingCount, reviewedCount: findingCount, reportFindingCount: 2 });
    await context.close();
  }
  await mkdir(".rehearsal", { recursive: true });
  await writeFile(".rehearsal/live-runs.json", JSON.stringify({ createdAt: new Date().toISOString(), commitSha: process.env.REHEARSAL_BUILD_SHA ?? process.env.GITHUB_SHA ?? "unsupplied", runs }, null, 2));
});
