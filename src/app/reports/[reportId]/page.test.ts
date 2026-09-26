import { beforeEach, describe, expect, it, vi } from "vitest";
import { SiteThreadError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  getReport: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/reports/service", () => ({ getReport: mocks.getReport }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import ReportPage from "./page";

describe("report page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses Next's not-found boundary when the report does not exist", async () => {
    mocks.getReport.mockRejectedValue(new SiteThreadError("The report was not found.", "NOT_FOUND"));

    await expect(ReportPage({ params: Promise.resolve({ reportId: "missing" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
