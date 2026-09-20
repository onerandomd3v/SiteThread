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

const UNSUPPORTED_CLAIM = /\b(?:structur(?:al|ally)|load[- ]bearing|beam|foundation|building\s+code|code\s+(?:violation|compliant|noncompliant)|violates?\s+(?:the\s+)?(?:building\s+)?code|(?:passed|failed)\s+inspection|inspection\s+(?:approved|rejected)|engineer(?:ing)?\s+(?:approved|accepted|certified)|(?:approved|accepted|certified|compliant|compliance|signed\s+off)|certified\s+(?:safe|compliant)|\b(?:safe|unsafe|dangerous|hazardous)\b|(?:clear|okay)\s+to\s+enter|fit\s+for\s+occupancy|(?:payment|financially|cost|budget)\s+(?:due|entitled)|entitlement|\$\s*\d|\d+(?:\.\d+)?\s*(?:%|percent|percentage)|caused?\s+by|due\s+to|because|result(?:ed|ing)?\s+(?:from|in)|leads?\s+to|led\s+to|therefore)\b/i;
const UNSUPPORTED_REMEDIATION = /\b(?:repair|replace|fix|seal|remove|clean|rework|correct|demolish|secure|patch)\b/i;
const REVIEW_ACTION = /^\s*(?:ask|have|request|refer|flag|invite)\s+(?:the\s+)?(?:site\s+)?(?:supervisor|professional|reviewer|team)\s+(?:to\s+)?(?:review|follow[- ]?up|inspect|assess|check)\s+(?:the\s+)?(?:visible\s+)?(?:condition|finding|observation|area)\.?\s*$/i;
const SPATIAL_RELATIONS = new Set(["above", "at", "behind", "beside", "between", "by", "in", "inside", "near", "on", "under"]);
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "be", "for", "from", "is", "it", "of", "or", "reported", "reports", "the", "to", "was", "were", "with",
]);

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

export function normalizeReasoningEvidenceText(value: string): string {
  return sanitizeResultText(value)
    .replace(/<\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*>\s*/g, "")
    .replace(/\b(?:\d{1,2}:){1,2}\d{2}(?:\.\d+)?\b/g, "")
    .replace(/\b\d+(?:\.\d+)?\s*(?:milliseconds?|ms|seconds?|secs?|s)\b/gi, "")
    .trim();
}

function stemToken(value: string): string {
  if (value.length > 5 && value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.length > 5 && value.endsWith("ing")) return value.slice(0, -3);
  if (value.length > 4 && value.endsWith("ed")) return value.slice(0, -2);
  if (value.length > 4 && value.endsWith("s")) return value.slice(0, -1);
  return value;
}

function factualTokens(value: string): string[] {
  return normalizedText(value).split(" ").filter((token) => token && !STOP_WORDS.has(token)).map(stemToken);
}

function spatialRelations(value: string): Set<string> {
  return new Set(factualTokens(value).filter((token) => SPATIAL_RELATIONS.has(token)).map((token) => token === "inside" ? "in" : token));
}

function claimClauses(value: string): string[] {
  return value
    .replace(/\b(?:and\s+)?(?:requires?|needs?)\s+(?:a\s+)?(?:professional|site\s+supervisor|supervisor)?\s*(?:review|follow[- ]?up)\b[\s\S]*$/i, "")
    .split(/\s*(?:[.;]|\b(?:and|but|while)\b)\s*/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function matchesSingleEvidence(clause: string, evidence: ReasoningEvidence): boolean {
  const claimTokens = factualTokens(clause);
  if (claimTokens.length === 0) return true;
  const evidenceTokens = new Set(factualTokens(evidence.text));
  if (claimTokens.some((token) => !evidenceTokens.has(token))) return false;
  const claimRelations = spatialRelations(clause);
  const evidenceRelations = spatialRelations(evidence.text);
  return [...claimRelations].every((relation) => evidenceRelations.has(relation));
}

function requiredEvidenceKind(clause: string): ReasoningEvidence["kind"] | undefined {
  if (/\b(?:visible|seen|shown|appears|looks?)\b/i.test(clause)) return "visual";
  if (/\b(?:reported|said|mentioned|narrated)\b/i.test(clause)) return "transcript";
  return undefined;
}

function isDescriptionGrounded(description: string, resolved: Array<ReasoningEvidence>): boolean {
  if (UNSUPPORTED_CLAIM.test(description) || UNSUPPORTED_REMEDIATION.test(description)) return false;
  const clauses = claimClauses(description);
  return clauses.every((clause) => {
    const requiredKind = requiredEvidenceKind(clause);
    return resolved.some((evidence) => (!requiredKind || evidence.kind === requiredKind) && matchesSingleEvidence(clause, evidence));
  }) && resolved.every((evidence) => clauses.some((clause) => {
    const requiredKind = requiredEvidenceKind(clause);
    return (!requiredKind || evidence.kind === requiredKind) && matchesSingleEvidence(clause, evidence);
  }));
}

function isSuggestedActionAllowed(value: string): boolean {
  return REVIEW_ACTION.test(value);
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
    const text = normalizeReasoningEvidenceText(segment.text);
    if (!text) continue;
    const ref = `T${transcriptIndex++}`;
    evidence.push({ ref, kind: "transcript", text });
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
    const text = normalizeReasoningEvidenceText(candidate.text);
    if (!text) continue;
    const ref = `V${visualIndex++}`;
    const range = sourceRange(candidate);
    evidence.push({ ref, kind: "visual", text });
    references.set(ref, {
      kind: "visual",
      mediaAssetId: candidate.mediaAssetId,
      sourceStartSeconds: range.startSeconds,
      sourceEndSeconds: range.endSeconds,
      label: `Visual evidence ${timeLabel(range.startSeconds)}–${timeLabel(range.endSeconds)}`,
    });
  }
  const evidenceFingerprint = createHash("sha256")
    .update(JSON.stringify(evidence.map((item) => ({ ...item, durable: references.get(item.ref) }))))
    .digest("hex");
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
    const resolved = observation.evidenceRefs.map((ref) => context.references.get(ref)!);
    const reasoningEvidence = context.evidence.filter((evidence) => observation.evidenceRefs.includes(evidence.ref));
    if (!isDescriptionGrounded(observation.description, reasoningEvidence)) return [];
    if (observation.suggestedAction && !isSuggestedActionAllowed(observation.suggestedAction)) return [];
    const hasNarration = resolved.some((evidence) => evidence.kind === "transcript");
    const hasVisual = resolved.some((evidence) => evidence.kind === "visual");
    const evidenceText = reasoningEvidence
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
