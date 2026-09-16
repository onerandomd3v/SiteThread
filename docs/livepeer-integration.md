# SiteThread — Livepeer Integration & Technical Spike

> **Project:** SiteThread  
> **Hackathon:** Livepeer Agent Hackathon 2026  
> **Track:** Livepeer Agent Builder — Track 1  
> **Linear:** COD-14 — Validate exact Livepeer Agent capabilities for the MVP  
> **Status:** Architecture validated from current public Livepeer sources; runtime capability verification still required with the project API key.  
> **Last reviewed:** 2026-09-16

---

## 1. Purpose

This document defines how SiteThread should integrate with Livepeer for the hackathon MVP.

It is intentionally more specific than `architecture.md`.

The goal is to answer:

- Where Livepeer sits in the SiteThread pipeline.
- Which Livepeer interfaces we should use.
- Which capabilities SiteThread needs.
- What is verified from current Livepeer sources.
- What still must be verified at runtime.
- How our adapter should be designed.
- What request/response contracts SiteThread should own.
- How we handle failures, latency, cost, and capability drift.
- What constitutes sufficient Livepeer usage for the hackathon.
- What we should **not** build around Livepeer yet.

The implementation rule is:

> **Livepeer provides SiteThread's media intelligence. SiteThread provides the construction domain logic, evidence model, review workflow, and trusted report.**

---

# 2. SiteThread's Livepeer Requirement

The SiteThread MVP processes an ordinary construction-site walkthrough containing:

- video;
- spoken narration;
- visual construction context;
- potentially useful evidence moments.

The application must turn that media into:

```text
Walkthrough
    ↓
Timestamped speech understanding
    ↓
Relevant visual evidence
    ↓
Structured construction observations
    ↓
Human review
    ↓
Trusted report
```

Livepeer must be materially central to the first three stages.

If Livepeer were removed, SiteThread would lose the media-understanding layer that makes the product work.

---

# 3. Current Livepeer Architecture Relevant to SiteThread

Current Livepeer Agent infrastructure exposes multiple ways to consume the same underlying network capabilities.

The documented consumer shapes are:

1. **Direct CLI / SDK**
2. **MCP**
3. **Embedded runtime inside an application**
4. **Direct capability/API calls through the SDK service**

For SiteThread, the preferred production path is:

```text
SiteThread worker
      ↓
Livepeer adapter
      ↓
Livepeer SDK / HTTP capability layer
      ↓
Livepeer orchestrator network
      ↓
Capability runner
```

MCP remains useful for:

- exploration;
- development;
- manually testing capabilities;
- inspecting available tools;
- learning request schemas.

MCP should **not** be the primary SiteThread production runtime.

---

# 4. Primary Integration Decision

## Decision

Use **direct capability invocation / embedded SDK patterns** for SiteThread's runtime rather than making SiteThread an MCP-first application.

### Why

SiteThread needs:

- deterministic orchestration;
- background execution;
- retries;
- structured results;
- job observability;
- database persistence;
- repeatable automated workflows.

Those requirements fit an application-controlled worker better than a human-driven MCP chat session.

Recommended architecture:

```text
Trigger.dev job
      │
      ├── SiteThread pipeline logic
      │
      ├── LivepeerMediaProvider
      │       │
      │       ├── discover capabilities
      │       ├── transcription
      │       └── visual analysis
      │
      ├── FFmpeg
      │
      └── ObservationReasoner
```

---

# 5. Livepeer Interfaces Verified From Current Sources

Current Livepeer Storyboard / Agent architecture documents describe a public SDK service with these relevant routes:

```text
POST /inference
POST /llm/chat
GET  /capabilities
GET  /health
```

The universal inference contract is described as:

```json
{
  "capability": "capability-name",
  "input": {
    "...": "capability-specific input"
  }
}
```

with a response shaped approximately as:

```json
{
  "output": {
    "...": "capability-specific output"
  }
}
```

Authentication currently uses a bearer API key in the documented Storyboard/Daydream path.

Conceptually:

```http
Authorization: Bearer sk_<key>
```

### Important

Exact capability names and schemas are dynamic.

They should be discovered at runtime instead of being permanently hard-coded from this document.

---

# 6. Current Capability Discovery

Livepeer's architecture intentionally supports dynamic capability registration.

That means SiteThread must treat capability discovery as a first-class operation.

Recommended startup/development behavior:

```text
GET /capabilities
       ↓
normalize registry
       ↓
resolve required SiteThread capabilities
       ↓
fail clearly if a required capability is unavailable
```

We should never assume that a capability visible today will retain:

- the same name;
- the same runner;
- the same request schema;
- the same pricing metadata;
- the same capacity.

---

# 7. Two Relevant Livepeer Capability Surfaces

Research identified two currently relevant surfaces.

## 7.1 Livepeer Agent / Storyboard SDK service

Current architecture documentation describes the Livepeer Agent/Storyboard backend as exposing:

- `/inference`;
- `/llm/chat`;
- `/capabilities`;
- media-generation capabilities;
- deterministic tool capabilities;
- streaming capabilities.

This should be considered SiteThread's **preferred integration surface** where required media-intelligence capabilities are exposed.

---

## 7.2 Livepeer Modules / Open Clearinghouse ecosystem

The Livepeer Workflow Kit project has also publicly demonstrated two capabilities particularly relevant to SiteThread:

### Audio transcription

Capability described as:

```text
openai:audio-transcriptions
```

The runner is based on NeMo and supports:

- bounded transcription;
- streaming transcription;
- speaker diarization;
- segment timestamps;
- word timestamps;
- OpenAI-compatible interfaces.

### Vision

Capability described as:

```text
florence-2
```

The runner supports:

- image understanding;
- visual-text understanding;
- screen/slide/image interpretation;
- OpenAI-compatible vision chat;
- direct visual-analysis routes.

Both have been publicly described as live Livepeer network capabilities.

---

# 8. Critical Integration Risk

Do **not** assume the Storyboard SDK `/capabilities` registry and the Livepeer Modules/Open Clearinghouse catalog expose exactly the same capabilities.

This must be checked during implementation.

The SiteThread implementation should support one of these outcomes:

### Outcome A — ideal

The required transcription and vision capabilities are directly available through the preferred Agent SDK service.

```text
SiteThread
   ↓
SDK service
   ├── transcription
   └── vision
```

### Outcome B — acceptable

Transcription and/or vision must be called through the Modules Gateway/Clearinghouse surface.

```text
SiteThread
   ↓
LivepeerMediaProvider
   ├── Agent SDK capability
   └── Modules Gateway capability
```

Both remain Livepeer-backed.

### Outcome C — capability unavailable

If a critical capability cannot be reached through the hackathon-supported Livepeer path, pause implementation and confirm the correct endpoint with the hackathon/Livepeer team before introducing an unrelated provider.

Do not quietly replace Livepeer's core media work with another vendor.

---

# 9. Required SiteThread Capabilities

SiteThread requires three capability categories.

## P0 — Required

### 9.1 Timestamped transcription

Input:

```text
audio/video
```

Required output:

```text
full transcript
+
timestamped segments
```

Preferred output:

```text
speaker labels
word timestamps
language metadata
```

Minimum acceptance criterion:

```json
{
  "text": "There's water pooling beside Room 204.",
  "segments": [
    {
      "start": 128.0,
      "end": 141.0,
      "text": "There's water pooling beside Room 204."
    }
  ]
}
```

SiteThread cannot reliably create grounded observations if transcript timing is absent.

---

## 9.2 Visual understanding

Input:

```text
image/frame
```

Required output:

```text
descriptive visual context
```

Examples of useful SiteThread visual outputs:

```text
"Interior unfinished corridor with metal ceiling framing."

"Visible standing water on the floor near an unfinished wall."

"Electrical conduit visible along the wall."

"Tile work visible inside a bathroom area."
```

The visual model should provide evidence.

It should **not** be asked to autonomously certify:

- engineering compliance;
- structural safety;
- building-code violations;
- project completion percentages.

---

## 9.3 Capability discovery

SiteThread needs to know:

- what capabilities are currently available;
- their names;
- their schemas where exposed;
- relevant limits;
- pricing/work units where available.

Capability discovery should happen before media processing in development and can be cached for production jobs.

---

# 10. P1 / Optional Livepeer Capabilities

These are useful but are not required for the first golden path.

### Livepeer-hosted reasoning / LLM

If the Livepeer text capability reliably produces strict structured outputs, it can be used for construction observation extraction.

Otherwise the `ObservationReasoner` remains provider-abstracted.

---

### Object detection

A suitable detection capability could eventually improve evidence extraction.

Potential use:

```text
visual frame
→ object/detection candidates
→ better evidence context
```

Do not block MVP delivery on this.

---

### Media finishing tools

Livepeer's tool layer includes deterministic media operations.

Useful future possibilities:

- trim evidence clips;
- concatenate clips;
- burn timestamps/captions;
- label evidence;
- export media.

SiteThread may continue using local FFmpeg for simple deterministic operations during the MVP.

---

# 11. Capabilities We Do Not Need for MVP

Do not spend hackathon time integrating:

- text-to-video generation;
- image-to-video generation;
- image generation;
- talking heads;
- TTS;
- music generation;
- 3D generation;
- live video-to-video streaming;
- social publishing;
- creative storyboarding.

These may be impressive Livepeer capabilities but they do not solve SiteThread's core problem.

---

# 12. SiteThread Livepeer Adapter

All Livepeer-specific behavior should live inside:

```text
src/lib/livepeer/
```

Suggested structure:

```text
src/lib/livepeer/
├── client.ts
├── capabilities.ts
├── provider.ts
├── transcription.ts
├── vision.ts
├── errors.ts
├── schemas.ts
└── fixtures/
```

---

# 13. Media Intelligence Contract

SiteThread should own an internal abstraction.

```ts
export interface MediaIntelligenceProvider {
  discoverCapabilities(): Promise<MediaCapabilities>;

  transcribe(
    input: TranscriptionInput
  ): Promise<Transcript>;

  analyzeImage(
    input: VisionInput
  ): Promise<VisionResult>;
}
```

Optional later:

```ts
analyzeVideo?(
  input: VideoAnalysisInput
): Promise<VideoAnalysisResult>;
```

The rest of the product must depend on this interface rather than directly depending on Livepeer response shapes.

---

# 14. SiteThread-Owned Transcript Schema

Normalize provider output immediately.

Example:

```ts
export const TranscriptSegmentSchema = z.object({
  id: z.string(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  text: z.string().min(1),
  speaker: z.string().optional(),
});

export const TranscriptSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  durationSeconds: z.number().optional(),
  segments: z.array(TranscriptSegmentSchema),
});
```

Why normalize?

Because Livepeer capability runners may expose:

- different field names;
- different timestamp granularity;
- OpenAI-compatible formats;
- runner-specific metadata.

SiteThread's domain layer should never care.

---

# 15. SiteThread-Owned Vision Schema

Example:

```ts
export const VisionResultSchema = z.object({
  summary: z.string(),
  objects: z.array(z.string()).default([]),
  visibleText: z.array(z.string()).default([]),
  raw: z.unknown().optional(),
});
```

We do not need to normalize every possible vision field during the hackathon.

Only normalize data SiteThread actually consumes.

---

# 16. Evidence Candidate Model

The pipeline should merge transcript and vision into evidence candidates before construction reasoning.

Example:

```ts
export interface EvidenceCandidate {
  timestampSeconds: number;
  transcriptSegmentIds: string[];
  frameAssetId: string;
  visionSummary: string;
}
```

Example record:

```json
{
  "timestampSeconds": 130,
  "transcriptSegmentIds": ["seg_18"],
  "frameAssetId": "asset_frame_130",
  "visionSummary": "Standing water is visible on the unfinished floor."
}
```

This becomes the source material for `ObservationReasoner`.

---

# 17. Recommended Processing Flow

```text
1. User uploads walkthrough to R2

2. Trigger.dev starts processWalkthrough

3. FFmpeg probes source media

4. Extract audio if required by transcription capability

5. Livepeer transcription

6. Normalize transcript

7. Select relevant timestamps
      ├── narration-driven timestamps
      └── coarse periodic samples

8. FFmpeg extracts frames

9. Livepeer vision analysis

10. Normalize vision results

11. Build EvidenceCandidate[]

12. ObservationReasoner produces ObservationDraft[]

13. Validate with Zod

14. Persist:
      ├── transcript
      ├── frames
      ├── evidence
      └── observations

15. Walkthrough → NEEDS_REVIEW
```

---

# 18. Transcript-Driven Visual Sampling

Do not send an entire video through expensive frame-by-frame vision processing.

Use the transcript to identify important moments.

Example transcript:

```text
00:41  "We're entering Level 2."

01:12  "Ceiling framing is complete here."

02:08  "There's water pooling beside Room 204."

03:54  "Electrical rough-in is completed."
```

Select frames around:

```text
00:41
01:12
02:08
03:54
```

Optionally inspect a small window:

```text
T - 2 sec
T
T + 2 sec
```

Only expand the window when evidence quality is poor.

---

# 19. Coarse Sampling

Narration may miss important visual transitions.

Therefore also sample periodically.

For the MVP:

```text
one frame every 10–20 seconds
```

is a reasonable starting point for a short walkthrough.

The final strategy can combine:

```text
timestamp union =
  transcript-important timestamps
  +
  periodic scene samples
```

Deduplicate timestamps before vision calls.

---

# 20. Evidence Refinement — Stretch Goal

If an observation is uncertain:

```text
Potential issue
confidence = 0.58
```

the agent may request more evidence around that timestamp.

Example:

```text
02:06
02:08
02:10
02:12
```

Run additional visual analysis and re-evaluate.

This produces a more genuinely agentic workflow:

```text
reason
→ detect uncertainty
→ inspect more evidence
→ refine
→ present to human
```

Do not implement this until the base pipeline is stable.

---

# 21. Authentication

Current public Storyboard documentation describes Daydream/Livepeer access using a bearer key.

Environment variable recommendation:

```env
LIVEPEER_API_KEY=
LIVEPEER_SDK_URL=https://sdk.daydream.monster
```

Never expose the key in browser code.

All Livepeer requests must originate from:

- server-side application code; or
- Trigger.dev workers.

Never use:

```text
NEXT_PUBLIC_LIVEPEER_API_KEY
```

---

# 22. Development Configuration

Suggested environment contract:

```env
# Livepeer
LIVEPEER_API_KEY=
LIVEPEER_SDK_URL=https://sdk.daydream.monster

# Optional if Modules Gateway is required
LIVEPEER_MODULES_GATEWAY_URL=
LIVEPEER_MODULES_GATEWAY_API_KEY=

# Media
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_BASE_URL=

# Database
DATABASE_URL=
DIRECT_URL=

# Trigger
TRIGGER_SECRET_KEY=
```

Actual environment names should be adjusted once the exact hackathon-provided credentials are confirmed.

---

# 23. Capability Resolution Strategy

Do not write:

```ts
const transcriptionModel = "some-name";
```

throughout the codebase.

Create semantic requirements.

Example:

```ts
type RequiredCapability =
  | "TRANSCRIPTION"
  | "VISION";
```

Then map discovered capabilities.

Example concept:

```ts
resolveCapability("TRANSCRIPTION", registry)
```

Possible aliases:

```ts
TRANSCRIPTION:
  - openai:audio-transcriptions
  - nemo-transcription
  - other verified Livepeer transcription capability
```

```ts
VISION:
  - florence-2
  - other verified Livepeer vision capability
```

The final alias list must be populated from the live registry during COD-14 implementation.

---

# 24. Fail Loudly

If SiteThread cannot find the required Livepeer capability, do not silently continue using an unrelated provider.

Return something actionable.

Example:

```text
LIVEPEER_CAPABILITY_UNAVAILABLE

Required: TRANSCRIPTION

Available registry checked successfully, but no supported
Livepeer transcription capability was found.

Action:
Verify hackathon Livepeer access or update capability mapping.
```

This protects:

- hackathon compliance;
- debugging;
- architecture integrity.

---

# 25. Livepeer Raw Response Persistence

During the hackathon, persist raw provider responses for debugging.

Recommended:

```text
ProcessingRun
  providerMetadata JSON
```

or:

```text
dev-only object:
debug/livepeer/<run-id>/transcription.json
debug/livepeer/<run-id>/vision-130.json
```

Do not expose these raw responses directly to end users.

Benefits:

- reproduce parsing failures;
- improve normalizers;
- create fixture tests;
- verify Livepeer usage for the demo.

---

# 26. Fixture Mode

SiteThread needs two provider modes.

```env
MEDIA_PROVIDER_MODE=live
```

or:

```env
MEDIA_PROVIDER_MODE=fixture
```

### Live mode

Makes real Livepeer calls.

Used for:

- development verification;
- manual QA;
- final hackathon demo.

### Fixture mode

Loads saved successful responses.

Used for:

- unit tests;
- Playwright;
- UI development;
- offline development;
- CI.

Fixture mode must not be presented as live Livepeer execution in the hackathon demo.

---

# 27. Retry Strategy

Retry only errors that are plausibly transient.

Examples:

### Retry

- network timeout;
- 429;
- temporary 5xx;
- capacity unavailable;
- transient upstream failure.

### Do not blindly retry

- invalid request schema;
- unsupported media;
- authentication failure;
- missing capability;
- malformed credentials.

Suggested retry policy:

```text
attempt 1
↓
short exponential delay
attempt 2
↓
longer delay
attempt 3
↓
fail ProcessingRun
```

Trigger.dev should own job-level retries.

The Livepeer adapter should classify provider errors.

---

# 28. Timeouts

Every Livepeer call needs an explicit timeout.

Suggested initial categories:

```text
Capability discovery:
10–15 seconds

Image analysis:
30–90 seconds

Transcription:
duration-dependent, bounded by worker job timeout
```

Do not depend on indefinite HTTP requests.

Record elapsed time for every capability call.

---

# 29. Latency Metrics

During development collect:

```text
transcription_ms
vision_call_ms
vision_total_ms
reasoning_ms
pipeline_total_ms
```

This should be attached to `ProcessingRun`.

We need to know where the pipeline is slow before demo day.

---

# 30. Cost Metadata

Capability discovery may expose:

- price/work-unit metadata;
- work-unit type;
- route/provider information.

Where available, log this in development.

We do **not** need an end-user cost dashboard for MVP.

However, knowing approximate per-walkthrough cost is useful before submission.

Recommended spike output:

```text
Demo walkthrough:
Duration:
Number of transcription calls:
Number of vision calls:
Approximate Livepeer cost:
Total pipeline time:
```

---

# 31. Media Input Strategy

The preferred source of truth is R2.

```text
R2 private object
      ↓
temporary presigned GET URL
      ↓
Livepeer capability
```

Generate short-lived presigned URLs.

Do not permanently make construction walkthroughs public.

If a capability requires direct file upload rather than URL input:

```text
Trigger worker
      ↓
download temporary copy
      ↓
send multipart request
      ↓
delete temporary file
```

The exact path will be selected after testing the live capability.

---

# 32. Transcription Input Strategy

Potential approaches:

## Preferred

Capability accepts audio/video URL.

```text
R2 signed URL
→ Livepeer transcription
```

## Fallback

Extract audio first.

```text
source.mp4
    ↓
FFmpeg
    ↓
audio.m4a / wav
    ↓
Livepeer transcription
```

This is still a Livepeer media-intelligence workflow.

FFmpeg is only preparing the input.

---

# 33. Vision Input Strategy

Recommended:

```text
source video
    ↓
FFmpeg frame extraction
    ↓
R2 frame object / temporary URL
    ↓
Livepeer vision capability
```

Why frames instead of sending full video to vision?

- lower inference cost;
- easier evidence traceability;
- exact timestamps;
- simpler retries;
- easier visual UI.

If Livepeer exposes a reliable full-video understanding capability later, we can compare approaches.

---

# 34. Construction Reasoning Boundary

Livepeer vision should answer questions like:

> What is visibly present in this image?

The construction reasoner should answer:

> Given the narration and visible evidence, what reviewable project observation should be drafted?

Do not ask the vision layer to produce final construction records directly.

Separation:

```text
LIVEPEER
"Visible standing water on floor."

TRANSCRIPT
"There's water pooling here beside Room 204."

SITETHREAD REASONER
Potential issue:
"Water accumulation was reported and visually observed near Room 204."

HUMAN
Confirm / Edit / Dismiss
```

---

# 35. Safety / Professional Guardrails

SiteThread must not automatically produce claims such as:

```text
"The structure is unsafe."

"This violates electrical code."

"This wall will fail."

"The work has passed inspection."
```

unless such statements are directly supplied and confirmed by an authorized human user.

Preferred language:

```text
"Potential issue requiring review."

"Visible condition detected."

"User reported..."

"Observed in source media..."

"Requires professional confirmation."
```

---

# 36. Minimum Livepeer Proof for Hackathon

The final demo should visibly demonstrate that Livepeer is central.

Recommended processing UI:

```text
✓ Walkthrough uploaded

✓ Livepeer transcription complete

✓ Evidence timestamps selected

✓ Livepeer visual analysis complete

✓ 8 grounded observations prepared

→ Waiting for human review
```

In README / architecture:

```text
Livepeer:
- transcript intelligence
- vision intelligence
- media capability execution
```

Do not hide the integration behind a generic:

```text
"AI processing..."
```

The judges should understand the Livepeer role immediately.

---

# 37. Runtime Validation Checklist

Before writing the full pipeline, run the following tests using the real project key.

## Test A — credentials

- Can we authenticate?
- What key format is provided?
- Which base URL is officially recommended for hackathon builders?

## Test B — capability discovery

- Call capability listing.
- Save the response.
- Identify transcription candidates.
- Identify vision candidates.
- Inspect schemas/metadata.

## Test C — transcription

Use a 30–60 second construction sample.

Verify:

- audio accepted;
- transcript quality;
- timestamps;
- speaker metadata;
- response shape;
- latency;
- cost.

## Test D — vision

Extract one construction frame.

Verify:

- image accepted;
- useful scene description;
- visible-object/context output;
- latency;
- cost.

## Test E — combined grounding

Use a timestamp where narration and image correspond.

Verify we can create:

```text
TranscriptSegment
+
VisionResult
+
EvidenceCandidate
```

## Test F — failure cases

Try:

- missing auth;
- invalid capability;
- inaccessible media URL;
- unsupported format.

Document error formats.

---

# 38. COD-14 Exit Criteria

COD-14 is complete only when we have real answers for:

```text
[ ] Official runtime integration surface selected

[ ] Livepeer credentials working

[ ] Capability discovery working

[ ] Exact transcription capability selected

[ ] Exact vision capability selected

[ ] Request schema captured for both

[ ] Response fixtures saved for both

[ ] Media ingress method decided

[ ] Typical latency measured

[ ] Cost/work-unit metadata recorded where available

[ ] Failure response shapes documented

[ ] LivepeerMediaProvider contract finalized
```

Until these are complete, the exact provider-specific implementation remains provisional.

---

# 39. Proposed Adapter Implementation

High-level implementation:

```ts
export class LivepeerMediaProvider
  implements MediaIntelligenceProvider
{
  async discoverCapabilities() {
    // query Livepeer registry
    // normalize result
  }

  async transcribe(input: TranscriptionInput) {
    // resolve transcription capability
    // call Livepeer
    // validate raw response
    // normalize into SiteThread Transcript
  }

  async analyzeImage(input: VisionInput) {
    // resolve vision capability
    // call Livepeer
    // validate raw response
    // normalize into SiteThread VisionResult
  }
}
```

Provider-specific schemas should be colocated with the adapter.

SiteThread domain schemas live elsewhere.

---

# 40. Recommended Implementation Files

```text
src/lib/livepeer/
├── client.ts
├── provider.ts
├── capabilities.ts
├── schemas.ts
├── errors.ts
├── transcription.ts
├── vision.ts
└── fixtures/
    ├── capabilities.json
    ├── transcription.json
    └── vision.json
```

And:

```text
src/lib/media/
├── ffmpeg.ts
├── frame-selection.ts
└── evidence-candidates.ts
```

---

# 41. What Not to Hard-Code

Avoid hard-coding:

- model/capability names throughout feature code;
- Livepeer response fields outside adapter code;
- capability pricing;
- worker URLs;
- model-provider URLs;
- public media URLs;
- timeouts with no configuration;
- assumptions that every capability accepts the same media format.

Hard-code semantic requirements, not network implementation details.

---

# 42. Version the Pipeline

Add:

```env
SITETHREAD_PIPELINE_VERSION=v1
```

Processing idempotency key:

```text
walkthroughId:pipelineVersion
```

Example:

```text
w_123:v1
```

If prompts, model mappings, or evidence logic change materially:

```text
v1 → v2
```

This makes test results and demo behavior reproducible.

---

# 43. Recommended Demo Media

The final demo walkthrough should be approximately:

```text
60–120 seconds
```

It should include spoken observations such as:

```text
"We're on Level 2."

"Ceiling framing is complete along this corridor."

"There's water pooling beside Room 204 and it needs checking."

"Electrical rough-in in Room 205 is complete."
```

The scene should visually support at least:

- one progress observation;
- one potential issue;
- one clear location/context transition.

Avoid an overly difficult construction video for the demo.

We are proving the product workflow, not benchmarking general construction computer vision.

---

# 44. Final Integration Thesis

SiteThread should not become a thin UI around one Livepeer request.

The integration should demonstrate orchestration:

```text
media upload
     ↓
Livepeer transcription
     ↓
timestamp reasoning
     ↓
frame extraction
     ↓
Livepeer vision
     ↓
evidence fusion
     ↓
construction reasoning
     ↓
human validation
     ↓
trusted record
```

That is the hackathon story.

Livepeer is the system that enables SiteThread to **understand the site's media**.

SiteThread turns that understanding into **construction work**.

---

# 45. Current Research Conclusions

As of this spike:

### Verified from public Livepeer sources

- Livepeer Agent supports SDK, API/embedded, CLI, and MCP consumption patterns.
- The current agent architecture exposes a universal capability-inference concept.
- Capability discovery is dynamic.
- Livepeer-hosted/Livepeer-routed LLM capabilities exist.
- A NeMo-based diarized transcription runner has been publicly deployed through Livepeer's network ecosystem.
- A Florence-2 vision runner has been publicly deployed through Livepeer's network ecosystem.
- Those media-intelligence capabilities support the type of transcript/vision workflow SiteThread needs.
- Direct SDK/API-style execution is a better conceptual fit than MCP for SiteThread's automated durable pipeline.

### Not yet verified with SiteThread credentials

- Exact hackathon API base URL we should use.
- Whether NeMo transcription is exposed through the same registry as Storyboard Agent capabilities.
- Whether Florence-2 vision is exposed through the same registry as Storyboard Agent capabilities.
- Exact capability names available to our account.
- Exact input schema for each selected capability.
- Exact output schema returned today.
- File/url size limits.
- Current pricing for the selected capabilities.
- Real latency on our sample construction footage.
- Whether signed Cloudflare R2 URLs are accepted directly.
- Whether a direct video input or extracted audio is preferred for transcription.

These items are the remaining hands-on portion of COD-14.

---

# 46. Immediate Next Action

Before building the main SiteThread pipeline:

```text
1. Obtain/configure the hackathon Livepeer credential.

2. Call capability discovery.

3. Capture the real registry response.

4. Select:
   - transcription capability;
   - vision capability.

5. Run one real construction clip.

6. Save successful raw responses as fixtures.

7. Update this document with:
   - exact capability names;
   - exact request examples;
   - exact normalized mappings;
   - measured latency;
   - measured/estimated cost.

8. Mark COD-14 complete.

9. Begin COD-15 / architecture foundation and COD-17 / media pipeline.
```

---

# 47. References

## Livepeer Agent / Storyboard

- Livepeer Storyboard repository  
  https://github.com/livepeer/storyboard

- Livepeer agent-native architecture  
  https://github.com/livepeer/storyboard/blob/main/full-architecture.md

- MCP vs CLI / production workflow discussion  
  https://github.com/livepeer/storyboard/blob/main/mcp-vs-cli-livepeer.md

- Livepeer Agent architecture overview  
  https://github.com/livepeer/storyboard/blob/main/livepeer-architecture-blog.html

## Livepeer media intelligence

- Livepeer Workflow Kit grant/application discussion  
  https://forum.livepeer.org/t/livepeer-workflow-kit/3271

- Workflow Kit approval / independently verified gateway execution  
  https://forum.livepeer.org/t/livepeer-workflow-kit/3271/12

## Livepeer Agent Hackathon context

- WEAVE / Livepeer Agent Hackathon updates  
  https://forum.livepeer.org/t/weave-growth-spe-updates/3239

- Livepeer Agent Framework RFC  
  https://forum.livepeer.org/t/rfc-agent-framework-the-five-milestones/3311

---

## Related SiteThread Documentation

```text
docs/architecture.md
docs/livepeer-integration.md   ← this document
```

Future documentation:

```text
docs/data-model.md
docs/processing-pipeline.md
docs/demo-runbook.md
```
