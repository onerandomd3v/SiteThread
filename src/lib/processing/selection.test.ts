import { describe, expect, it } from "vitest";
import { audioWindows, providerEventSourceRange, visualClips } from "./selection";

describe("source range selection", () => {
  it("keeps exact and partial six-second windows within actual duration", () => {
    expect(audioWindows(60)).toHaveLength(10);
    expect(audioWindows(60).at(-1)).toEqual({ startSeconds: 54, endSeconds: 60 });
    expect(audioWindows(62)).toHaveLength(11);
    expect(audioWindows(62).at(-1)).toEqual({ startSeconds: 60, endSeconds: 62 });
    expect(audioWindows(62).every((range) => range.endSeconds <= 62 && range.startSeconds < range.endSeconds)).toBe(true);
    expect(() => audioWindows(0)).toThrow();
    expect(() => audioWindows(Number.NaN)).toThrow();
  });

  it("selects at most one bounded visual clip per 20-second bucket", () => {
    const transcript = audioWindows(120).map((range) => ({ ...range, text: range.startSeconds === 6 ? "Narration" : "" }));
    expect(visualClips(60, transcript)).toHaveLength(3);
    expect(visualClips(120, transcript)).toHaveLength(6);
    expect(visualClips(62, transcript).at(-1)?.endSeconds).toBe(62);
    expect(visualClips(120, transcript).every((clip, index, clips) => clip.endSeconds <= 120 && (index === 0 || clip.startSeconds >= clips[index - 1].endSeconds))).toBe(true);
    expect(visualClips(21, [{ startSeconds: 18, endSeconds: 21, text: "Narration" }])).toHaveLength(1);
  });

  it("rejects invalid provider event ranges and falls back to the full clip", () => {
    const clip = { startSeconds: 42, endSeconds: 48 };
    expect(providerEventSourceRange(clip, { startSeconds: 1, endSeconds: 3 }, 60)).toEqual({ startSeconds: 43, endSeconds: 45 });
    for (const local of [{ startSeconds: -1, endSeconds: 2 }, { startSeconds: 4, endSeconds: 3 }, { startSeconds: Infinity, endSeconds: 6 }, { startSeconds: 2, endSeconds: 7 }]) {
      expect(providerEventSourceRange(clip, local, 60)).toEqual(clip);
    }
    expect(providerEventSourceRange(clip, { startSeconds: 5, endSeconds: 6 }, 60, 5.5)).toEqual(clip);
  });
});
