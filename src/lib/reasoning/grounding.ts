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
const NEGATION_MARKER = /\b(?:no|not|never|without|isn't|is\s+not|aren't|are\s+not|wasn't|was\s+not|weren't|were\s+not|doesn't|does\s+not|cannot|can't)\b/gi;
const PREDICATE_WORDS = new Set(["am", "are", "appeared", "appears", "be", "been", "being", "blocks", "covers", "has", "have", "is", "leaking", "lies", "looks", "looked", "pooled", "reported", "reports", "rests", "said", "seen", "shows", "shown", "visible", "was", "were"]);
const ROLE_PREDICATES = new Set(["appeared", "appears", "blocks", "covers", "leaking", "lies", "looks", "looked", "pooled", "rests", "seen", "shows", "shown", "visible"]);
const NEGATIVE_PREDICATES = new Set([...ROLE_PREDICATES, "reported", "reports", "said"]);
const NEGATION_WORDS = new Set(["no", "not", "never", "without", "isnt", "arent", "wasnt", "werent", "doesnt", "cannot", "cant"]);
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
  return normalizedText(value).split(" ").filter((token) => token && !STOP_WORDS.has(token) && !NEGATION_WORDS.has(token)).map(stemToken);
}

function spatialRelations(value: string): Set<string> {
  return new Set(factualTokens(value).filter((token) => SPATIAL_RELATIONS.has(token)).map((token) => token === "inside" ? "in" : token));
}

function hasPredicate(value: string): boolean {
  return normalizedText(value).split(" ").some((token) => PREDICATE_WORDS.has(token));
}

function shouldSplitAnd(prefix: string, suffix: string): boolean {
  if (!hasPredicate(prefix)) return false;
  const suffixTokens = normalizedText(suffix).split(" ").filter(Boolean);
  return suffixTokens.some((token) => PREDICATE_WORDS.has(token));
}

function splitGroundingClauses(value: string): string[] {
  const sentences = value.split(/\s*[.;]\s*/).map((sentence) => sentence.trim()).filter(Boolean);
  return sentences.flatMap((sentence) => {
    const clauses: string[] = [];
    let start = 0;
    const conjunctions = /\s+\b(and|but|while)\b\s+/gi;
    for (const match of sentence.matchAll(conjunctions)) {
      const index = match.index ?? 0;
      const conjunction = match[1]?.toLowerCase();
      const prefix = sentence.slice(start, index).trim();
      const suffixStart = index + match[0].length;
      const suffix = sentence.slice(suffixStart).trim();
      if (conjunction !== "and" || shouldSplitAnd(prefix, suffix)) {
        if (prefix) clauses.push(prefix);
        start = suffixStart;
      }
    }
    const remainder = sentence.slice(start).trim();
    if (remainder) clauses.push(remainder);
    return clauses;
  });
}

function polarity(value: string): "positive" | "negative" | "ambiguous" {
  const markers = value.match(NEGATION_MARKER) ?? [];
  if (markers.length > 1) return "ambiguous";
  return markers.length === 1 ? "negative" : "positive";
}

function spatialCondition(value: string): { subject: string[]; predicate: string; relation: string | undefined; object: string[] } | undefined {
  const tokens = normalizedText(value).split(" ").filter(Boolean);
  const predicateIndex = tokens.findIndex((token) => ROLE_PREDICATES.has(token));
  if (predicateIndex < 0) return undefined;
  const relationOffset = tokens.slice(predicateIndex + 1).findIndex((token) => SPATIAL_RELATIONS.has(token));
  const relation = relationOffset >= 0 ? tokens[predicateIndex + 1 + relationOffset] : undefined;
  const subject = tokens.slice(0, predicateIndex).filter((token) => !NEGATION_WORDS.has(token) && !STOP_WORDS.has(token) && !SPATIAL_RELATIONS.has(token) && !PREDICATE_WORDS.has(token));
  const object = relationOffset >= 0
    ? tokens.slice(predicateIndex + 2 + relationOffset).filter((token) => !STOP_WORDS.has(token) && !PREDICATE_WORDS.has(token) && !SPATIAL_RELATIONS.has(token))
    : [];
  return { subject: subject.map(stemToken), predicate: tokens[predicateIndex], relation, object: object.map(stemToken) };
}

function includesAll(haystack: string[], needles: string[]): boolean {
  return needles.every((needle) => haystack.includes(needle));
}

function negativeCondition(value: string): { subject: string[]; relation: string | undefined; location: string[] } | undefined {
  const tokens = normalizedText(value).split(" ").filter(Boolean);
  const negationIndex = tokens.findIndex((token) => NEGATION_WORDS.has(token));
  if (negationIndex < 0) return undefined;
  const predicateAfter = tokens.slice(negationIndex + 1).findIndex((token) => NEGATIVE_PREDICATES.has(token));
  const predicateBefore = [...tokens.slice(0, negationIndex)].reverse().findIndex((token) => NEGATIVE_PREDICATES.has(token));
  const predicateIndex = predicateAfter >= 0
    ? negationIndex + 1 + predicateAfter
    : predicateBefore >= 0 ? negationIndex - 1 - predicateBefore : -1;
  if (predicateIndex < 0) return undefined;
  const relationSearchStart = Math.max(predicateIndex, negationIndex) + 1;
  const relationOffset = tokens.slice(relationSearchStart).findIndex((token) => SPATIAL_RELATIONS.has(token));
  const subject = predicateIndex > negationIndex
    ? tokens.slice(0, predicateIndex).filter((token) => !NEGATION_WORDS.has(token) && !STOP_WORDS.has(token) && !SPATIAL_RELATIONS.has(token) && !PREDICATE_WORDS.has(token))
    : tokens.slice(negationIndex + 1, relationOffset >= 0 ? relationSearchStart + relationOffset : tokens.length)
      .filter((token) => !STOP_WORDS.has(token) && !SPATIAL_RELATIONS.has(token) && !PREDICATE_WORDS.has(token));
  const relation = relationOffset >= 0 ? tokens[relationSearchStart + relationOffset] : undefined;
  const location = relationOffset >= 0
    ? tokens.slice(relationSearchStart + relationOffset + 1).filter((token) => !STOP_WORDS.has(token) && !PREDICATE_WORDS.has(token))
    : [];
  return { subject: subject.map(stemToken), relation, location: location.map(stemToken) };
}

function matchesEvidenceFragment(clause: string, evidenceText: string): boolean {
  const claimPolarity = polarity(clause);
  const evidencePolarity = polarity(evidenceText);
  if (claimPolarity === "ambiguous" || evidencePolarity === "ambiguous" || claimPolarity !== evidencePolarity) return false;
  if (claimPolarity === "negative") {
    const claimCondition = negativeCondition(clause);
    const evidenceCondition = negativeCondition(evidenceText);
    if (!claimCondition || !evidenceCondition
      || !includesAll(evidenceCondition.subject, claimCondition.subject)
      || claimCondition.relation !== evidenceCondition.relation
      || !includesAll(evidenceCondition.location, claimCondition.location)) return false;
  }
  const claimTokens = factualTokens(clause);
  if (claimTokens.length === 0) return true;
  const evidenceTokens = new Set(factualTokens(evidenceText));
  if (claimTokens.some((token) => !evidenceTokens.has(token))) return false;
  const claimRelations = spatialRelations(clause);
  const evidenceRelations = spatialRelations(evidenceText);
  if (![...claimRelations].every((relation) => evidenceRelations.has(relation))) return false;
  const claimCondition = spatialCondition(clause);
  const evidenceCondition = spatialCondition(evidenceText);
  if (claimCondition && evidenceCondition) {
    if (stemToken(claimCondition.predicate) !== stemToken(evidenceCondition.predicate)
      || !includesAll(evidenceCondition.subject, claimCondition.subject)) return false;
    if (claimCondition.relation !== undefined && (
      claimCondition.relation !== evidenceCondition.relation
      || !includesAll(evidenceCondition.object, claimCondition.object)
    )) return false;
  }
  return true;
}

function evidenceClauses(value: string): string[] {
  return splitGroundingClauses(value);
}

function requiredEvidenceKind(clause: string): ReasoningEvidence["kind"] | undefined {
  if (/\b(?:visible|seen|shown|appears|looks?)\b/i.test(clause)) return "visual";
  if (/\b(?:reported|said|mentioned|narrated)\b/i.test(clause)) return "transcript";
  return undefined;
}

function groundedEvidenceFragments(description: string, resolved: Array<ReasoningEvidence>): string[] | undefined {
  if (UNSUPPORTED_CLAIM.test(description) || UNSUPPORTED_REMEDIATION.test(description)) return undefined;
  const clauses = splitGroundingClauses(description.replace(/\s+\b(?:and\s+)?(?:requires?|needs?)\s+(?:a\s+)?(?:professional|site\s+supervisor|supervisor)?\s*(?:review|follow[- ]?up)\b/gi, ""));
  const matchedEvidence = new Set<ReasoningEvidence>();
  const matchedFragments: string[] = [];
  for (const clause of clauses) {
    const requiredKind = requiredEvidenceKind(clause);
    const matches = resolved.flatMap((evidence) => {
      if (requiredKind && evidence.kind !== requiredKind) return [];
      return evidenceClauses(evidence.text)
        .filter((fragment) => matchesEvidenceFragment(clause, fragment))
        .map((fragment) => ({ evidence, fragment }));
    });
    if (matches.length === 0) return undefined;
    for (const match of matches) {
      matchedEvidence.add(match.evidence);
      matchedFragments.push(match.fragment);
    }
  }
  if (resolved.some((evidence) => !matchedEvidence.has(evidence))) return undefined;
  return matchedFragments;
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
    const matchedEvidenceFragments = groundedEvidenceFragments(observation.description, reasoningEvidence);
    if (!matchedEvidenceFragments) return [];
    if (observation.suggestedAction && !isSuggestedActionAllowed(observation.suggestedAction)) return [];
    const hasNarration = resolved.some((evidence) => evidence.kind === "transcript");
    const hasVisual = resolved.some((evidence) => evidence.kind === "visual");
    const evidenceText = matchedEvidenceFragments.join("\n");
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
