import { createHash } from "node:crypto";
import { SiteThreadError } from "@/lib/errors";
import { sanitizeResultText } from "@/lib/livepeer/sanitize";
import type { ObservationReasoningOutput } from "@/lib/schemas/observation-reasoning";

interface TranscriptEvidenceSource {
  id: string;
  sourceAssetId: string | null;
  sequence: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

interface VisualEvidenceSource {
  id: string;
  mediaAssetId: string;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  eventStartSeconds: number | null;
  eventEndSeconds: number | null;
  text: string;
}

export interface ReasoningEvidence {
  ref: string;
  kind: "transcript" | "visual";
  startSeconds: number;
  endSeconds: number;
  text: string;
}

interface DurableEvidence {
  kind: ReasoningEvidence["kind"];
  mediaAssetId?: string;
  transcriptSegmentId?: string;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  label: string;
}

export interface ObservationReasoningContext {
  evidence: ReasoningEvidence[];
  evidenceFingerprint: string;
  references: ReadonlyMap<string, DurableEvidence>;
}

export interface GroundedObservation {
  type: "PROGRESS" | "POTENTIAL_ISSUE" | "ACTION" | "NOTE";
  sourceBasis: "NARRATION" | "VISUAL" | "NARRATION_AND_VISUAL";
  description: string;
  location?: string;
  trade?: string;
  confidence?: number;
  suggestedAction?: string;
  evidence: Array<Omit<DurableEvidence, "kind">>;
}

const TYPE_MAP = {
  progress: "PROGRESS",
  potential_issue: "POTENTIAL_ISSUE",
  action: "ACTION",
  note: "NOTE",
} as const;

const UNSUPPORTED_CLAIM = /\b(?:structurally\s+(?:safe|unsafe|sound)|(?:building\s+)?code\s+(?:violation|compliant|noncompliant)|violates?\s+(?:the\s+)?(?:building\s+)?code|(?:passed|failed)\s+inspection|inspection\s+(?:approved|rejected)|engineer(?:ing)?\s+(?:approved|accepted|certified)|certified\s+(?:safe|compliant)|(?:payment|financially)\s+(?:due|entitled)|caused\s+by|due\s+to|\d+(?:\.\d+)?\s*%\s*(?:complete|completed))\b/i;

function sourceRange(source: VisualEvidenceSource): { startSeconds: number; endSeconds: number } {
  const eventStart = source.eventStartSeconds;
  const eventEnd = source.eventEndSeconds;
  if (
    eventStart !== null
    && eventEnd !== null
    && Number.isFinite(eventStart)
    && Number.isFinite(eventEnd)
    && eventStart <= eventEnd
    && eventStart >= source.sourceStartSeconds
    && eventEnd <= source.sourceEndSeconds
  ) return { startSeconds: eventStart, endSeconds: eventEnd };
  return { startSeconds: source.sourceStartSeconds, endSeconds: source.sourceEndSeconds };
}

function timeLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function normalizedText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isGroundedOptionalValue(value: string | undefined, evidenceText: string): value is string {
  if (!value) return false;
  const normalized = normalizedText(value);
  return normalized.length > 0 && normalizedText(evidenceText).includes(normalized);
}

export function buildReasoningContext(input: {
  transcriptSegments: TranscriptEvidenceSource[];
  visualCandidates: VisualEvidenceSource[];
}): ObservationReasoningContext {
  const evidence: ReasoningEvidence[] = [];
  const references = new Map<string, DurableEvidence>();
  let transcriptIndex = 0;
  for (const segment of [...input.transcriptSegments].sort((left, right) => left.sequence - right.sequence)) {
    const text = sanitizeResultText(segment.text).trim();
    if (!text) continue;
    const ref = `T${transcriptIndex++}`;
    evidence.push({ ref, kind: "transcript", startSeconds: segment.startSeconds, endSeconds: segment.endSeconds, text });
    references.set(ref, {
      kind: "transcript",
      ...(segment.sourceAssetId ? { mediaAssetId: segment.sourceAssetId } : {}),
      transcriptSegmentId: segment.id,
      sourceStartSeconds: segment.startSeconds,
      sourceEndSeconds: segment.endSeconds,
      label: `Narration ${timeLabel(segment.startSeconds)}–${timeLabel(segment.endSeconds)}`,
    });
  }
  let visualIndex = 0;
  for (const candidate of [...input.visualCandidates].sort((left, right) => left.sourceStartSeconds - right.sourceStartSeconds)) {
    const text = sanitizeResultText(candidate.text).trim();
    if (!text) continue;
    const ref = `V${visualIndex++}`;
    const range = sourceRange(candidate);
    evidence.push({ ref, kind: "visual", ...range, text });
    references.set(ref, {
      kind: "visual",
      mediaAssetId: candidate.mediaAssetId,
      sourceStartSeconds: range.startSeconds,
      sourceEndSeconds: range.endSeconds,
      label: `Visual evidence ${timeLabel(range.startSeconds)}–${timeLabel(range.endSeconds)}`,
    });
  }
  const evidenceFingerprint = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
  return { evidence, evidenceFingerprint, references };
}

export function groundReasonedObservations(
  output: ObservationReasoningOutput,
  context: ObservationReasoningContext,
): GroundedObservation[] {
  for (const observation of output.observations) {
    for (const ref of observation.evidenceRefs) {
      if (!context.references.has(ref)) {
        throw new SiteThreadError("The observation result referenced unavailable evidence.", "PROVIDER_RESULT_INVALID");
      }
    }
  }

  return output.observations.flatMap((observation) => {
    if (UNSUPPORTED_CLAIM.test(observation.description) || (observation.suggestedAction && UNSUPPORTED_CLAIM.test(observation.suggestedAction))) return [];
    const resolved = observation.evidenceRefs.map((ref) => context.references.get(ref)!);
    const hasNarration = resolved.some((evidence) => evidence.kind === "transcript");
    const hasVisual = resolved.some((evidence) => evidence.kind === "visual");
    const evidenceText = context.evidence
      .filter((evidence) => observation.evidenceRefs.includes(evidence.ref))
      .map((evidence) => evidence.text)
      .join("\n");
    const sourceBasis = hasNarration && hasVisual ? "NARRATION_AND_VISUAL" : hasNarration ? "NARRATION" : "VISUAL";
    return [{
      type: TYPE_MAP[observation.type],
      sourceBasis,
      description: observation.description,
      ...(isGroundedOptionalValue(observation.location, evidenceText) ? { location: observation.location } : {}),
      ...(isGroundedOptionalValue(observation.trade, evidenceText) ? { trade: observation.trade } : {}),
      ...(observation.confidence === undefined ? {} : { confidence: observation.confidence }),
      ...(observation.suggestedAction ? { suggestedAction: observation.suggestedAction } : {}),
      evidence: resolved.map((evidence) => {
        const durable = { ...evidence };
        Reflect.deleteProperty(durable, "kind");
        return durable;
      }),
    }];
  });
}
