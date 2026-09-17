import { expect, test } from "@playwright/test";

test("home page exposes the SiteThread product promise", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /trusted project record/i })).toBeVisible();
  await expect(page.getByText("AI prepares. Human confirms.")).toBeVisible();
});
