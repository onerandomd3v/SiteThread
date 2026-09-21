export function validateReportArtifactBinding(reportId, artifactReportId) {
  if (reportId !== artifactReportId) throw new Error("report ID does not match the browser rehearsal artifact");
}

export function validateReportObservationEvidence({ observation, sourceObservation, segments, mediaById, walkthrough, processingRunId }) {
  if (!sourceObservation) throw new Error("report observation is not from the current run");
  if (!["CONFIRMED", "EDITED"].includes(observation.reviewState)) throw new Error("report contains an ineligible review state");
  if (observation.evidence.length === 0) throw new Error("report finding has no evidence");

  for (const evidence of observation.evidence) {
    if (evidence.sourceWalkthroughId !== walkthrough.id) throw new Error("report evidence points to another walkthrough");
    const sourceEvidence = sourceObservation.evidence.find((candidate) => candidate.id === evidence.sourceEvidenceId);
    if (!sourceEvidence) throw new Error("report evidence does not match source ObservationEvidence");
    if (sourceEvidence.mediaAssetId !== evidence.mediaAssetId || sourceEvidence.transcriptSegmentId !== evidence.transcriptSegmentId) throw new Error("report evidence identity does not match source evidence");
    const hasStart = evidence.sourceStartSeconds !== null;
    const hasEnd = evidence.sourceEndSeconds !== null;
    if (hasStart !== hasEnd) throw new Error("report evidence has an incomplete range");
    if (hasStart && hasEnd && evidence.sourceEndSeconds < evidence.sourceStartSeconds) throw new Error("report evidence range is reversed");
    if (hasEnd && walkthrough.durationSeconds !== null && evidence.sourceEndSeconds > walkthrough.durationSeconds) throw new Error("report evidence exceeds walkthrough duration");

    if (evidence.transcriptSegmentId) {
      const segment = segments.find((candidate) => candidate.id === evidence.transcriptSegmentId);
      if (!segment || segment.walkthroughId !== walkthrough.id || segment.processingRunId !== processingRunId) throw new Error("report transcript evidence is from another run");
      continue;
    }

    if (!evidence.mediaAssetId) throw new Error("pure visual report evidence has no media asset");
    const mediaAsset = mediaById.get(evidence.mediaAssetId);
    if (!mediaAsset || mediaAsset.walkthroughId !== walkthrough.id || mediaAsset.kind !== "EVIDENCE_CLIP" || mediaAsset.status !== "AVAILABLE") throw new Error("pure visual report evidence is not an available evidence clip");
    if (!mediaAsset.visualCandidates.some((candidate) => candidate.processingRunId === processingRunId && candidate.walkthroughId === walkthrough.id && candidate.providerInvocation?.processingRunId === processingRunId && candidate.providerInvocation?.provider === "livepeer" && candidate.providerInvocation?.capability === "marlin-video" && candidate.providerInvocation?.status === "SUCCEEDED")) throw new Error("pure visual report evidence lacks current-run Marlin provenance");
  }
}
