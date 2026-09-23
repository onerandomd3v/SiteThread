const RUN_PROVIDER_CONTRACTS = new Map([
  ["creative/transcribe", "livepeer"],
  ["gemini-video-understanding", "google-gemini"],
  ["observation-reasoning", "google-gemini"],
]);

const SUPERSEDED_CAPABILITIES = new Set(["nemotron-asr", "marlin-video", "gemini-text"]);

export function validateReportArtifactBinding(reportId, artifactReportId) {
  if (reportId !== artifactReportId) throw new Error("report ID does not match the browser rehearsal artifact");
}

export function validateRunProviderInvocations({ invocations, transcriptSegments, processingRunId }) {
  if (!processingRunId) throw new Error("current processing run ID is missing");
  if (invocations.some((invocation) => invocation.processingRunId !== processingRunId)) throw new Error("provider invocation is from another processing run");

  for (const invocation of invocations) {
    if (SUPERSEDED_CAPABILITIES.has(invocation.capability)) throw new Error(`current run contains superseded capability ${invocation.capability}`);
    const expectedProvider = RUN_PROVIDER_CONTRACTS.get(invocation.capability);
    if (!expectedProvider) throw new Error(`current run contains unsupported provider capability ${invocation.capability}`);
    if (invocation.provider !== expectedProvider) throw new Error(`${invocation.capability} must use ${expectedProvider}`);
  }

  for (const [capability, provider] of RUN_PROVIDER_CONTRACTS) {
    if (!invocations.some((invocation) => invocation.capability === capability && invocation.provider === provider && invocation.status === "SUCCEEDED")) {
      throw new Error(`current run is missing successful ${provider}/${capability} provenance`);
    }
  }

  if (transcriptSegments.length === 0) throw new Error("current run has no transcript segments");
  const transcriptionInvocations = invocations.filter((invocation) => invocation.capability === "creative/transcribe" && invocation.status === "SUCCEEDED");
  for (const segment of transcriptSegments) {
    if (segment.processingRunId !== processingRunId) throw new Error("transcript segment is from another processing run");
    if (!transcriptionInvocations.some((invocation) => invocation.sourceStartSeconds === segment.startSeconds && invocation.sourceEndSeconds === segment.endSeconds)) {
      throw new Error("transcript segment has no matching current-run source-window transcription invocation");
    }
  }
  for (const invocation of transcriptionInvocations) {
    if (!transcriptSegments.some((segment) => segment.startSeconds === invocation.sourceStartSeconds && segment.endSeconds === invocation.sourceEndSeconds)) {
      throw new Error("transcription invocation has no matching current-run source-window transcript segment");
    }
  }
  return [...RUN_PROVIDER_CONTRACTS].map(([capability, provider]) => ({ capability, provider }));
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
    const hasValidRange = hasStart && hasEnd
      && Number.isFinite(evidence.sourceStartSeconds)
      && Number.isFinite(evidence.sourceEndSeconds)
      && evidence.sourceStartSeconds >= 0
      && evidence.sourceEndSeconds > evidence.sourceStartSeconds;
    if (!hasValidRange) throw new Error("pure visual report evidence has no valid source range");
    const backedByCurrentGemini = mediaAsset.visualCandidates.some((candidate) =>
      candidate.processingRunId === processingRunId
      && candidate.walkthroughId === walkthrough.id
      && Number.isFinite(candidate.sourceStartSeconds)
      && Number.isFinite(candidate.sourceEndSeconds)
      && candidate.sourceStartSeconds >= 0
      && candidate.sourceEndSeconds > candidate.sourceStartSeconds
      && evidence.sourceStartSeconds >= candidate.sourceStartSeconds
      && evidence.sourceEndSeconds <= candidate.sourceEndSeconds
      && candidate.provider === "google-gemini"
      && candidate.capability === "gemini-video-understanding"
      && candidate.providerInvocation?.processingRunId === processingRunId
      && candidate.providerInvocation?.provider === "google-gemini"
      && candidate.providerInvocation?.capability === "gemini-video-understanding"
      && candidate.providerInvocation?.status === "SUCCEEDED");
    if (!backedByCurrentGemini) throw new Error("pure visual report evidence lacks current-run Gemini visual provenance");
  }
}
