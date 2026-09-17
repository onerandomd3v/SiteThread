# SiteThread Architecture & Engineering Plan

> **Project:** SiteThread  
> **Hackathon Track:** Livepeer Agent Builder — Track 1  
> **Core principle:** **AI prepares. Human confirms.**  
> **Working tagline:** *Turn a site walk into a trusted project record.*

---

## 1. Purpose of This Document

This document defines the recommended technical architecture, stack, responsibilities, system boundaries, data model, media-processing flow, development environments, testing strategy, and implementation guardrails for the SiteThread hackathon MVP.

The goal is to optimize for:

1. **Hackathon speed**
2. **Reliable media processing**
3. **Clear Livepeer centrality**
4. **Strong demo UX**
5. **A foundation that can evolve after the hackathon without requiring a rewrite**

SiteThread should remain technically simple at the application layer while taking the media-processing pipeline seriously.

---

## 2. Product Definition

SiteThread is a **phone-first construction field agent** that turns ordinary construction-site walkthrough video, imagery, and spoken observations into:

- structured site observations;
- evidence-backed findings;
- reviewable action items;
- daily/progress site reports;
- searchable project records over time.

The primary MVP workflow is:

```text
Construction walkthrough
        ↓
Video + audio + images
        ↓
Livepeer-backed media intelligence
        ↓
Timestamped transcript + visual evidence
        ↓
Construction observation extraction
        ↓
Human Confirm / Edit / Dismiss
        ↓
Evidence-backed site report
```

The AI is **not** the engineer, inspector, or final authority.

It prepares structured draft observations for a construction professional to review.

---

# 3. Architecture Principles

## 3.1 Golden-path first

The [COD-13 product contract](golden-path.md) defines the required journey, review and evidence rules, release scope, and demo acceptance checks. This document describes the engineering approach to that contract.

The MVP exists to make one workflow excellent:

```text
Upload one walkthrough
        ↓
Process media
        ↓
Extract grounded observations
        ↓
Human review
        ↓
Generate final report
```

Everything else is secondary.

We should not expand into:

- collaboration systems;
- BIM integrations;
- live-stream site monitoring;
- project scheduling;
- cost management;
- autonomous compliance inspection;
- advanced analytics;
- OriginTrail;
- enterprise integrations;

until the golden path is reliable.

## 3.2 Livepeer must be materially central

Livepeer must not be a cosmetic integration.

SiteThread should depend on Livepeer for core media-intelligence work such as:

- audio transcription;
- timestamped speech understanding;
- image/video understanding;
- multimodal media analysis;
- media transformations where useful.

If Livepeer disappeared, the key SiteThread workflow should materially degrade.

## 3.3 Evidence before prose

SiteThread should not behave like a generic summarization application.

Every meaningful AI-generated observation should be grounded in source evidence.

A finding should be traceable to one or more of:

- source video timestamp;
- transcript segment;
- extracted image/frame;
- evidence clip.

Example:

```json
{
  "type": "potential_issue",
  "location": "Level 2 / Room 204",
  "trade": "general",
  "description": "Water accumulation was reported and visually observed near Room 204.",
  "startSeconds": 128,
  "endSeconds": 141,
  "confidence": 0.91
}
```

## 3.4 AI prepares. Human confirms.

AI output begins as draft information.

Only human-reviewed observations become trusted project records.

```text
                  DRAFT
                /   |    \
               /    |     \
      CONFIRMED   EDITED   DISMISSED
```

Only `CONFIRMED` and `EDITED` findings are eligible for inclusion in final reports.

---

# 4. Recommended Stack

| Layer | Technology | Reason |
|---|---|---|
| Language | TypeScript | One language across application, API, schemas, and jobs |
| Runtime | Node.js 22 | Stable modern Node runtime |
| Package Manager | pnpm | Fast and deterministic dependency management |
| Web Framework | Next.js 16 App Router | Full-stack application without unnecessary service split |
| UI | React 19 | Product UI |
| Styling | Tailwind CSS 4 | Fast, consistent implementation |
| Components | shadcn/ui | High-quality reusable primitives |
| Icons | Lucide | Clean consistent iconography |
| Validation | Zod | Strict API and AI-output validation |
| Database | Neon PostgreSQL | Managed Postgres with branching and serverless-friendly access |
| ORM | Prisma | Strong schema, migration, and TypeScript developer experience |
| Media Storage | Cloudflare R2 | Private S3-compatible object storage |
| Background Jobs | Trigger.dev | Durable long-running media workflows |
| Media Intelligence | Livepeer Agent | Core audio/video/image processing layer |
| Deterministic Media Utilities | FFmpeg | Frame, audio, clip, and metadata operations |
| Hosting | Vercel | Best fit for Next.js + previews |
| CI | GitHub Actions | Automated checks on pull requests |
| Unit Tests | Vitest | Fast TypeScript testing |
| E2E Tests | Playwright | Golden-path browser testing |
| Project Management | Linear | Planning and execution tracking |

---

# 5. High-Level System Architecture

```text
┌───────────────────────────────────────────────┐
│                 USER / BROWSER                │
│                                               │
│ Upload walkthrough → Review → Final report    │
└──────────────────────┬────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────┐
│            SITETHREAD WEB APPLICATION         │
│                                               │
│        Next.js + React + TypeScript            │
│                                               │
│ UI │ API │ Server Actions │ Report Renderer   │
└─────┬─────────────┬───────────────┬───────────┘
      │             │               │
      ▼             ▼               ▼
   NEON         CLOUDFLARE       TRIGGER.DEV
 POSTGRES           R2             WORKER
      │             │               │
      │             │               ▼
      │             │       ┌──────────────────┐
      │             │       │ WALKTHROUGH JOB  │
      │             │       │                  │
      │             │       │ Transcription    │
      │             │       │ Frame selection  │
      │             │       │ Vision analysis  │
      │             │       │ Observation      │
      │             │       │ extraction       │
      │             │       └────────┬─────────┘
      │             │                │
      │             │                ▼
      │             │         LIVEPEER AGENT
      │             │        ┌───────────────┐
      │             │        │ Audio         │
      │             │        │ Video         │
      │             │        │ Vision        │
      │             │        │ Media tools   │
      │             │        └───────────────┘
      │             │
      └─────────────┴───────────────┐
                                    ▼
                           STRUCTURED FINDINGS
                                    │
                                    ▼
                          HUMAN REVIEW LAYER
                                    │
                                    ▼
                              FINAL REPORT
```

---

# 6. Why a Single Next.js Application

For the hackathon MVP, SiteThread does **not** need a separate Next.js frontend plus NestJS backend.

The normal application/backend responsibilities are:

- authentication later if needed;
- CRUD operations;
- database reads/writes;
- presigned upload generation;
- starting processing jobs;
- review actions;
- report rendering.

Next.js handles these well.

The genuinely heavy backend work is the multimodal media pipeline. That work belongs in a durable background worker rather than inside request handlers.

Recommended split:

```text
Next.js
   │
   ├── UI + APIs + database operations
   │
   └── Trigger walkthrough processing job
                    │
                    ▼
              Trigger.dev worker
                    │
                    ▼
              Livepeer + FFmpeg
```

A standalone API service can be extracted later if SiteThread grows into:

- mobile apps;
- enterprise integrations;
- multi-tenant external APIs;
- Procore/Autodesk integrations;
- live site events;
- advanced streaming workflows.

---

# 7. Background Processing

## Why background jobs are required

A media-processing pipeline can take far longer than a normal HTTP request.

Example:

```text
Video upload
    ↓
Transcription
    ↓
Frame selection
    ↓
Vision analysis
    ↓
Construction reasoning
    ↓
Persistence
```

Any individual stage may fail temporarily.

The user should not need to keep a browser request open while this happens.

Trigger.dev should manage:

- long-running execution;
- retries;
- job status;
- idempotency;
- logs;
- timeouts;
- execution history.

---

# 8. Media Storage

Construction video should not pass through the Next.js server during upload.

Recommended flow:

```text
Browser
   │
   │ request upload permission
   ▼
Next.js
   │
   │ generate presigned R2 PUT URL
   ▼
Browser ──────────────────────→ Cloudflare R2
            direct upload
```

Benefits:

- large files do not consume application-server bandwidth;
- avoids serverless body limits;
- simpler scaling;
- media remains private;
- uploads can eventually become resumable.

## 8.1 What belongs in R2

```text
source.mp4
source.mov
thumbnail.jpg
frame-001.jpg
frame-002.jpg
evidence-clip-001.mp4
report-assets/...
```

## 8.2 What belongs in Postgres

```text
walkthrough_id
project_id
storage_key
mime_type
duration
captured_at
processing_status
created_at
```

Never store large video blobs inside PostgreSQL.

---

# 9. Livepeer Integration

Livepeer is SiteThread's core media-intelligence provider.

## 9.1 Livepeer responsibilities

### Audio

- speech transcription;
- timestamps;
- speaker/segment metadata where available.

### Image / video understanding

- describe visual context;
- identify useful visual evidence;
- understand construction scenes at a general visual level;
- support media analysis required by the agent.

### Media operations

Where Livepeer exposes suitable capabilities, it may also support:

- clipping;
- transformation;
- captions;
- other media operations.

## 9.2 Livepeer adapter

Livepeer-specific integration code should live behind an internal provider abstraction.

Example:

```ts
interface MediaIntelligenceProvider {
  transcribe(input: MediaInput): Promise<Transcript>;
  analyzeVisual(input: VisualAnalysisInput): Promise<VisionResult>;
}
```

Implementation:

```text
LivepeerMediaProvider
        ↓
Livepeer Agent raw MCP (Streamable HTTP)
```

The rest of SiteThread should not know provider-specific request details.

This protects the architecture from changes to Livepeer's API surface during the hackathon.

COD-14 selected raw MCP as the runtime direction after real capability tests. Timestamped transcription and useful image understanding remain unresolved; this diagram does not imply the required media contracts are validated. See [the integration findings and gates before COD-17](livepeer-integration.md) before implementing the provider.

---

# 10. FFmpeg's Role

FFmpeg is used for deterministic media plumbing.

Examples:

- inspect video metadata;
- extract frame at a timestamp;
- extract audio;
- generate a thumbnail;
- cut a short evidence clip.

FFmpeg does **not** replace Livepeer.

The separation is:

```text
FFmpeg
→ deterministic media manipulation

Livepeer
→ media intelligence and understanding
```

---

# 11. Walkthrough Processing Pipeline

Recommended processing sequence:

```text
Walkthrough uploaded
        ↓
Create ProcessingRun
        ↓
Queue Trigger.dev job
        ↓
Probe video metadata
        ↓
LIVEPEER TRANSCRIPTION
        ↓
Timestamped transcript
        ↓
Select useful media timestamps
        ↓
Extract representative frames/clips
        ↓
LIVEPEER VISUAL ANALYSIS
        ↓
Merge speech + visual context
        ↓
CONSTRUCTION OBSERVATION AGENT
        ↓
Validate structured output with Zod
        ↓
Persist draft observations
        ↓
Walkthrough status = NEEDS_REVIEW
```

---

# 12. Frame Selection Strategy

Do **not** analyze every video frame.

A 10-minute video at 30 fps contains roughly:

```text
18,000 frames
```

Analyzing all frames would be wasteful and slow.

Instead use a hybrid strategy.

### Transcript-driven sampling

If transcript timestamps contain statements such as:

```text
00:41 "We're entering Level 2."

01:12 "Ceiling framing is complete here."

02:08 "There's water pooling beside Room 204."

03:54 "Electrical rough-in is completed."
```

inspect visual evidence around those moments.

### Coarse visual sampling

Additionally sample frames periodically to provide scene context and detect transitions.

This reduces:

- inference cost;
- processing latency;
- irrelevant frames;
- model noise.

---

# 13. Construction Observation Agent

The multimodal processing layer produces:

```text
Transcript
+
Visual analysis
+
Evidence frames
+
Timestamps
```

The construction observation agent converts this into strict structured findings.

Recommended observation shape:

```ts
type ObservationType =
  | "progress"
  | "potential_issue"
  | "action"
  | "note";

interface ObservationDraft {
  type: ObservationType;
  location?: string;
  trade?: string;
  description: string;
  startSeconds?: number;
  endSeconds?: number;
  confidence?: number;
  evidenceAssetIds: string[];
  transcriptSegmentIds: string[];
}
```

## 13.1 Agent rules

The observation reasoner must:

- ground claims in provided media/transcript;
- never invent project locations;
- never invent completion percentages;
- never claim engineering-code violations without explicit verified context;
- avoid autonomous engineering conclusions;
- prefer uncertain wording when confidence is low;
- always provide evidence references;
- return strict structured output.

---

# 14. Reasoning Provider Abstraction

Keep reasoning separate from Livepeer integration.

Example:

```ts
interface ObservationReasoner {
  extract(context: WalkthroughContext): Promise<ObservationDraft[]>;
}
```

Preferred approach:

1. Use a suitable Livepeer reasoning/text capability where reliable.
2. If necessary, use another text model only for final structured reasoning.
3. Keep the core multimodal media intelligence on Livepeer.

This preserves output quality while keeping Livepeer materially central.

---

# 15. Core Data Model

Recommended entities:

| Entity | Purpose |
|---|---|
| `Project` | Construction project |
| `Walkthrough` | One uploaded/recorded site walkthrough |
| `MediaAsset` | Video, image, extracted frame, or evidence clip |
| `ProcessingRun` | One media-processing attempt |
| `TranscriptSegment` | Timestamped spoken content |
| `Observation` | Progress, issue, action, or note |
| `ObservationEvidence` | Links findings to source media |
| `Report` | Final human-approved site report |

## 15.1 Critical relationship

The core SiteThread differentiator is traceability:

```text
Observation
      │
      ├── Evidence Frame
      ├── Video Timestamp
      ├── Evidence Clip
      └── Transcript Segment
```

A final report claim should never exist without a path back to source evidence.

---

# 16. Walkthrough Processing States

Recommended walkthrough lifecycle:

```text
UPLOADING
    ↓
UPLOADED
    ↓
QUEUED
    ↓
TRANSCRIBING
    ↓
ANALYZING_MEDIA
    ↓
EXTRACTING_OBSERVATIONS
    ↓
NEEDS_REVIEW
    ↓
REVIEWED
    ↓
REPORT_READY
```

Failure state:

```text
PROCESSING_FAILED
```

Recommended failure metadata:

```text
failedStep
errorCode
errorMessage
retryCount
```

---

# 17. Observation Review Lifecycle

Each observation starts in `DRAFT`.

Possible transitions:

```text
DRAFT
  ├── CONFIRMED
  ├── EDITED
  └── DISMISSED
```

Only `CONFIRMED` and `EDITED` observations enter the final report.

Reviewer edits should never remove the link to original evidence.

---

# 18. Report Architecture

The initial report should be rendered as a React/HTML page.

Example route:

```text
/reports/[reportId]
```

The report should include:

- project metadata;
- walkthrough date/time;
- progress observations;
- potential attention items;
- action items;
- representative evidence frames;
- source timestamps;
- reviewer confirmation metadata;
- generated-at timestamp.

Use print CSS so the report can be exported through:

```text
Print → Save as PDF
```

Do not introduce a dedicated PDF-generation service during the MVP unless necessary.

---

# 19. Product UX

SiteThread should feel like professional construction software.

Primary concepts:

```text
Project
Walkthrough
Processing
Findings
Evidence
Report
```

Avoid making the core product chatbot-first.

Conversational search can come later.

The primary interface should be:

- evidence-first;
- task-oriented;
- professional;
- mobile-friendly;
- simple enough for field use.

---

# 20. Suggested Routes

```text
/
│
├── projects/
│   └── [projectId]/
│
├── walkthroughs/
│   └── [walkthroughId]/
│       ├── processing
│       └── review
│
└── reports/
    └── [reportId]
```

For the hackathon MVP, one seeded project is acceptable if it improves implementation speed.

## 20.1 Repository foundation

COD-15 establishes the first implementation seams without implementing the product workflow:

```text
prisma/schema.prisma                 structured persistence model
src/lib/schemas/                     SiteThread-owned Zod contracts
src/lib/livepeer/types.ts            provider boundary (no Livepeer client yet)
src/lib/storage/types.ts             private media storage boundary
src/lib/processing/types.ts          durable job and transition boundary
src/lib/config/env.ts                server-only environment validation
src/app/                             minimal Next.js App Router entry point
tests/e2e/                           Playwright foundation
```

Prisma owns relational records and migrations; R2 and Trigger.dev remain interfaces until their feature issues implement them. The provider contracts intentionally accept normalized, provider-neutral results. COD-32 must resolve timestamp and visual-input behavior before a Livepeer adapter is added in COD-17. `ReportObservation` snapshots eligible reviewed wording so a later edit requires report regeneration instead of silently changing an existing report.

---

# 21. Recommended Repository Structure

```text
SiteThread/
│
├── src/
│   ├── app/
│   │
│   ├── components/
│   │   └── ui/
│   │
│   ├── features/
│   │   ├── projects/
│   │   ├── walkthroughs/
│   │   ├── observations/
│   │   └── reports/
│   │
│   ├── lib/
│   │   ├── db/
│   │   ├── storage/
│   │   ├── livepeer/
│   │   ├── media/
│   │   ├── reasoning/
│   │   └── schemas/
│   │
│   └── trigger/
│       └── process-walkthrough.ts
│
├── prisma/
│   └── schema.prisma
│
├── tests/
│
├── docs/
│   ├── architecture.md
│   └── livepeer-integration.md
│
├── AGENTS.md
├── .env.example
├── trigger.config.ts
├── next.config.ts
└── package.json
```

---

# 22. Environment Strategy

Keep environments minimal during the hackathon.

| Service | Development | Demo / Production |
|---|---|---|
| Vercel | Preview deployments | Production |
| Neon | `dev` branch | `production` |
| R2 | `sitethread-dev` bucket | `sitethread-prod` bucket |
| Trigger.dev | Development environment | Production environment |
| Livepeer | Development/hackathon key | Final demo key |
| GitHub | Feature branches | `main` |

No dedicated staging environment is required during the hackathon.

---

# 23. Upload Constraints for the MVP

The [golden-path input assumptions](golden-path.md#minimum-input-and-operating-assumptions) define the required reference walkthrough and distinguish it from broader upload targets. Validate the deployed media path before advertising supported formats or limits; provider-specific constraints remain in the Livepeer integration document.

---

# 24. Testing Strategy

AI workflows are nondeterministic, so SiteThread should support two execution modes.

```text
LIVE MODE
→ real Livepeer calls

FIXTURE MODE
→ stored representative provider responses
```

### Unit tests

Use Vitest for:

- schemas;
- parsing;
- observation state transitions;
- report-generation logic;
- provider adapters;
- helper utilities.

### E2E tests

Use Playwright to validate:

```text
upload
→ processing
→ findings
→ human review
→ final report
```

Fixture mode should power most automated tests to avoid wasting Livepeer credits and creating flaky CI.

The final demo should use LIVE MODE.

---

# 25. Job Idempotency

Every processing run should have a unique deterministic key.

Example:

```text
walkthroughId + pipelineVersion
```

Example value:

```text
w_123:v1
```

This prevents retries from generating duplicate:

- transcripts;
- observations;
- frames;
- evidence records.

---

# 26. Observability

For the hackathon MVP, use:

```text
Vercel logs
+
Trigger.dev run logs
+
ProcessingRun database records
```

This is sufficient.

Do not introduce:

- Datadog;
- Grafana;
- custom observability clusters;

unless a clear need appears.

---

# 27. CI/CD

Recommended pull-request checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm prisma validate
pnpm build
```

Deployment flow:

```text
Feature branch
      ↓
Pull Request
      ↓
GitHub Actions
      ↓
Vercel Preview
      ↓
Review
      ↓
Merge to main
      ↓
Production deployment
```

---

# 28. Required Resources

| Resource | Purpose |
|---|---|
| GitHub — SiteThread | Source control |
| Linear — SiteThread | Project management |
| Vercel | Application hosting |
| Neon | PostgreSQL |
| Cloudflare R2 | Construction media storage |
| Trigger.dev | Durable background processing |
| Livepeer Agent access | Core media intelligence |
| FFmpeg | Deterministic media operations |
| Node.js 22 + pnpm | Development runtime/tooling |
| Representative construction walkthrough | Demo input |

The representative construction video should be obtained early.

Do not wait until demo day to source or record it.

---

# 29. Technologies We Deliberately Will Not Add Yet

| Technology | Decision |
|---|---|
| NestJS | Not needed for MVP |
| Redis | Not needed |
| BullMQ | Trigger.dev already covers the job need |
| Kafka | Unnecessary |
| Kubernetes | Unnecessary |
| Dedicated Docker deployment | Not needed initially |
| Pinecone | Not needed |
| Elasticsearch | Not needed |
| pgvector | Later |
| LangChain | No clear need |
| CrewAI | No clear need |
| OriginTrail | Future / possible Track 2 evolution |
| Dedicated mobile app | Not now |
| Custom WebSocket server | Not now |

The goal is to build a strong product, not an impressive dependency list.

---

# 30. Why No Vector Database Yet

Future SiteThread may support questions such as:

> Show every plumbing observation from Level 3 before drywall.

At that point embeddings and `pgvector` may become valuable.

For the MVP, however, most important data is already structured:

- location;
- trade;
- observation type;
- date;
- review status;
- timestamps.

Standard PostgreSQL queries are sufficient.

---

# 31. Why No OriginTrail Yet

First prove this pipeline:

```text
media
→ useful construction observation
→ human confirmation
→ trusted report
```

Only after the primary workflow is strong should SiteThread consider adding:

- verifiable project memory;
- provenance;
- trusted evidence relationships;
- long-term knowledge graphs.

That can become a future Track 2-style extension without changing the core media pipeline.

---

# 32. Stretch Feature: Evidence Refinement Loop

After the basic pipeline is working, SiteThread could add an agentic evidence-refinement step.

Example:

```text
Agent:
"Possible water accumulation near Room 204."
Confidence: 0.62
```

The agent determines that evidence quality is insufficient.

It requests frames around:

```text
02:06
02:08
02:10
02:12
```

Livepeer analyzes the additional evidence.

Then:

```text
Confidence: 0.91
Best evidence frame: 02:10
```

This produces a stronger agent workflow:

```text
reason
→ inspect
→ gather better evidence
→ refine
→ present to human
```

This is a stretch goal, not part of the first implementation milestone.

---

# 33. System Responsibility Boundaries

## SiteThread owns

- product UX;
- construction domain logic;
- project records;
- review states;
- report generation;
- evidence relationships;
- job orchestration.

## Livepeer owns

- media intelligence;
- audio understanding;
- visual understanding;
- supported media AI operations.

## Cloudflare R2 owns

- media-object storage.

## Neon owns

- structured project data.

## Trigger.dev owns

- durable long-running execution;
- retries;
- job history.

## Vercel owns

- web application delivery;
- preview and production deployments.

---

# 34. Final Architecture Summary

```text
                SITETHREAD
                    │
        ┌───────────┴───────────┐
        │                       │
    PRODUCT LAYER           MEDIA LAYER
        │                       │
 Next.js + Neon           Livepeer Agent
        │                       │
        └───────────┬───────────┘
                    │
               Trigger.dev
                    │
                    ▼
              Human Review
                    │
                    ▼
             Trusted Record
```

---

# 35. Immediate Engineering Order

The first engineering work should happen in this order:

### 1. Validate Livepeer capabilities

Run a representative construction walkthrough through the current Livepeer interface and confirm:

- exact APIs/tools;
- authentication;
- transcription output;
- timestamps;
- visual-analysis format;
- latency;
- limits;
- errors;
- cost/credits.

### 2. Freeze the integration contracts

Define:

```text
MediaIntelligenceProvider
ObservationReasoner
Transcript schema
VisionResult schema
ObservationDraft schema
```

### 3. Scaffold the repository

Initialize:

- Next.js;
- TypeScript;
- Tailwind;
- shadcn/ui;
- Prisma;
- Neon connection;
- R2 adapter;
- Trigger.dev;
- test setup.

### 4. Implement the golden path

```text
Upload
→ process
→ extract
→ review
→ report
```

### 5. Stop feature expansion

Once the golden path works, prioritize:

- reliability;
- demo UX;
- README;
- architecture explanation;
- final video;
- hackathon submission.

---

# 36. Final Engineering Thesis

SiteThread should remain a simple application around a serious multimodal workflow.

The architecture is intentionally designed so that:

- the web application remains easy to build and deploy;
- large media bypasses the application server;
- long-running work is durable;
- Livepeer remains central;
- AI output is structured and evidence-backed;
- humans retain authority;
- reports remain traceable;
- the system can evolve into deeper project memory later.

The architecture should serve the product thesis:

> **Turn ordinary construction-site media into trusted, reviewable project records.**

And the product should always preserve the core rule:

> **AI prepares. Human confirms.**

---

## References

- Livepeer: https://livepeer.org/
- Livepeer Agent: https://agent.livepeer.org/
- Livepeer Forum: https://forum.livepeer.org/
- Next.js: https://nextjs.org/
- Neon: https://neon.com/
- Prisma: https://www.prisma.io/
- Cloudflare R2: https://developers.cloudflare.com/r2/
- Trigger.dev: https://trigger.dev/
- Vercel: https://vercel.com/
- Playwright: https://playwright.dev/
- Vitest: https://vitest.dev/
