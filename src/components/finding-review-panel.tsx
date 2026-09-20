"use client";

import { useRef, useState } from "react";
import type { ReviewObservation, WalkthroughReview } from "@/lib/schemas/review";

function timeLabel(value: number | null): string {
  if (value === null) return "Time unavailable";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function reviewLabel(observation: ReviewObservation): string {
  if (observation.reviewState === "CONFIRMED") return "Human confirmed";
  if (observation.reviewState === "EDITED") return "Human edited";
  if (observation.reviewState === "DISMISSED") return "Dismissed";
  return "AI-generated draft";
}

function reviewerLabel(observation: ReviewObservation): string | null {
  if (!observation.reviewedAt) return null;
  return observation.reviewerId === "mvp-reviewer" ? "MVP reviewer" : "Reviewer";
}

function typeLabel(value: ReviewObservation["type"]): string {
  return value.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function sourceBasisLabel(value: ReviewObservation["sourceBasis"]): string {
  if (value === "NARRATION_AND_VISUAL") return "Narration and visual";
  return value === "NARRATION" ? "Narration" : "Visual";
}

function EvidenceMedia({ url, startSeconds, mediaKind }: { url: string; startSeconds: number | null; mediaKind: string | null }) {
  const video = useRef<HTMLVideoElement>(null);
  return <video
    ref={video}
    controls
    preload="metadata"
    src={url}
    onLoadedMetadata={() => {
      if (mediaKind === "SOURCE_VIDEO" && startSeconds !== null && video.current) video.current.currentTime = startSeconds;
    }}
    className="max-h-64 w-full rounded-lg bg-slate-950"
    aria-label="Evidence media"
  />;
}

export function FindingReviewPanel({
  review,
  onReview,
}: {
  review: WalkthroughReview;
  onReview: (observationId: string, decision: { state: "CONFIRMED" | "DISMISSED" } | { state: "EDITED"; editedText: string }) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedText, setEditedText] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function beginEdit(observation: ReviewObservation) {
    setEditingId(observation.observationId);
    setEditedText(observation.finalDisplayText);
    setError(null);
  }

  async function save(observationId: string, decision: { state: "CONFIRMED" | "DISMISSED" } | { state: "EDITED"; editedText: string }) {
    setSavingId(observationId);
    setError(null);
    try {
      await onReview(observationId, decision);
      if (decision.state === "EDITED") {
        setEditingId(null);
        setEditedText("");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The review decision could not be saved.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="findings-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Findings review</p>
          <h2 id="findings-heading" className="mt-1 text-2xl font-semibold text-slate-950">Evidence-backed findings</h2>
        </div>
        <p className="text-right text-sm text-slate-600" data-testid="review-progress">
          {review.reviewedCount} of {review.totalCount} reviewed
          {review.remainingDrafts > 0 && <span className="block text-xs text-amber-700">{review.remainingDrafts} remaining</span>}
        </p>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}

      {review.totalCount === 0 && <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">No valid findings were extracted from this walkthrough. Review is complete without adding unsupported observations.</div>}
      {review.complete && review.totalCount > 0 && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Review complete — report preparation is the next step.</div>}

      <div className="space-y-4">
        {review.observations.map((observation) => {
          const isEditing = editingId === observation.observationId;
          const isSaving = savingId === observation.observationId;
          const isDraft = observation.reviewState === "DRAFT";
          return (
            <article id={`finding-${observation.observationId}`} key={observation.observationId} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid={`finding-${observation.observationId}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{typeLabel(observation.type)}</p>
                  <p className="mt-1 text-sm font-medium text-slate-700">{reviewLabel(observation)}</p>
                  {reviewerLabel(observation) && <p className="mt-1 text-xs text-slate-500">{reviewerLabel(observation)} · {observation.reviewedAt?.toLocaleString()}</p>}
                </div>
                {observation.confidence !== null && <p className="text-xs text-slate-500">Confidence {Math.round(observation.confidence * 100)}%</p>}
              </div>

              {(observation.location || observation.trade) && <p className="text-sm text-slate-600">{[observation.location, observation.trade].filter(Boolean).join(" · ")}</p>}
              <p className="text-xs text-slate-500">Source basis: {sourceBasisLabel(observation.sourceBasis)}</p>

              {observation.reviewState === "EDITED" && <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600"><span className="font-semibold">Original AI draft:</span> {observation.originalDraftText}</div>}
              {isEditing ? (
                <div className="space-y-2">
                  <label htmlFor={`edit-${observation.observationId}`} className="text-sm font-semibold text-slate-900">Revised wording</label>
                  <textarea id={`edit-${observation.observationId}`} value={editedText} onChange={(event) => setEditedText(event.target.value)} rows={4} className="w-full rounded-lg border border-slate-300 p-3 text-sm" />
                  <p className="text-xs text-slate-600">Save only wording that remains supported by the cited evidence.</p>
                </div>
              ) : <p className="text-base leading-7 text-slate-950">{observation.finalDisplayText}</p>}

              {observation.suggestedAction && <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"><span className="font-semibold">Suggested follow-up:</span> {observation.suggestedAction}</p>}

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">Evidence</h3>
                {observation.evidence.map((item) => <div id={`finding-${observation.observationId}-evidence-${item.evidenceId}`} key={item.evidenceId} className="space-y-2 rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                    <span className="font-semibold">{item.label ?? (item.kind === "TRANSCRIPT" ? "Narration" : "Visual evidence")}</span>
                    <span>{timeLabel(item.sourceStartSeconds)}–{timeLabel(item.sourceEndSeconds)}</span>
                  </div>
                  {item.transcriptText && <p className="text-sm leading-6 text-slate-800"><span className="font-semibold">Narration:</span> “{item.transcriptText}”</p>}
                  {item.mediaAvailability === "AVAILABLE" && item.mediaUrl && <EvidenceMedia url={item.mediaUrl} startSeconds={item.sourceStartSeconds} mediaKind={item.mediaKind} />}
                  {item.mediaAvailability === "UNAVAILABLE" && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This evidence asset is unavailable right now. Refresh to try again.</p>}
                </div>)}
              </div>

              {isDraft && <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-2">
                {isEditing ? <>
                  <button type="button" disabled={isSaving || !editedText.trim()} onClick={() => void save(observation.observationId, { state: "EDITED", editedText: editedText.trim() })} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{isSaving ? "Saving…" : "Save edit"}</button>
                  <button type="button" disabled={isSaving} onClick={() => { setEditingId(null); setEditedText(""); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
                </> : <>
                  <button type="button" disabled={isSaving} onClick={() => void save(observation.observationId, { state: "CONFIRMED" })} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{isSaving ? "Saving…" : "Confirm"}</button>
                  <button type="button" disabled={isSaving} onClick={() => beginEdit(observation)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Edit</button>
                  <button type="button" disabled={isSaving} onClick={() => void save(observation.observationId, { state: "DISMISSED" })} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">Dismiss</button>
                </>}
              </div>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
