# AGENTS.md — SiteThread

Instructions for coding agents working in this repository.

> **Product principle:** AI prepares. Human confirms.  
> **Product goal:** Turn construction site media into evidence-backed project records that professionals can review and trust.

## Read first

Before making a non-trivial change, inspect the repository and read the documentation relevant to the task:

- `README.md` — product overview, users, workflows, and product direction.
- `docs/architecture.md` — stack, system boundaries, data flow, repository structure, testing, and engineering decisions.
- `docs/livepeer-integration.md` — Livepeer integration, capability discovery, provider abstractions, retries, and fixture mode.

Do not duplicate those documents here.

If code and documentation conflict, identify the mismatch before extending the inconsistency.

## Core product flow

Protect this workflow:

```text
Upload walkthrough
→ media processing
→ timestamped transcript
→ visual evidence
→ structured construction observations
→ Confirm / Edit / Dismiss
→ evidence-backed site report
```

Changes should preserve or improve this flow unless the task explicitly concerns another part of the product.

## Product rules

### Evidence first

Meaningful observations should remain traceable to source evidence where available:

```text
Observation
├── transcript segment
├── video timestamp
├── evidence frame
└── evidence clip
```

Do not persist unsupported model output as trusted project information.

### Human authority

AI-generated observations begin as drafts.

```text
DRAFT → CONFIRMED
      → EDITED
      → DISMISSED
```

Only confirmed or edited observations may appear in final reports.

Dismissed findings must not.

### No autonomous engineering claims

Do not implement behavior that independently certifies:

- structural safety;
- building-code compliance;
- inspection approval;
- engineering acceptance;
- exact completion percentages;
- financial entitlement.

Prefer wording such as:

- potential issue;
- visible condition;
- reported by user;
- observed in source media;
- requires professional review.

## Agreed stack

Current architecture:

- TypeScript
- Node.js
- Next.js App Router
- React
- Tailwind CSS
- shadcn/ui
- Zod
- Neon PostgreSQL
- Prisma
- Cloudflare R2
- Trigger.dev
- Livepeer Agent
- FFmpeg
- Vercel
- Vitest
- Playwright
- GitHub Actions

Follow `docs/architecture.md` for the rationale.

Do not introduce major infrastructure or frameworks without a clear requirement.

Avoid adding technologies such as Redis, Kafka, Kubernetes, Elasticsearch, Pinecone, LangChain, or a second backend framework unless the existing architecture cannot reasonably support the requirement.

## Responsibility boundaries

### Next.js

Owns:

- product UI;
- route handlers and application APIs;
- fast application operations;
- report rendering;
- orchestration entry points.

Do not run long-running media inference inside user-facing HTTP requests.

### Trigger.dev

Owns:

- durable background processing;
- retries;
- long-running walkthrough workflows;
- job observability.

### Cloudflare R2

Owns:

- source walkthroughs;
- extracted frames;
- thumbnails;
- evidence clips;
- other large media objects.

Large uploads should go directly from the browser to R2 using short-lived presigned URLs.

Do not store large media blobs in PostgreSQL.

### Neon / Prisma

Owns structured application data.

Use Prisma migrations for schema changes.

Do not make undocumented manual production schema changes.

### FFmpeg

Use for deterministic media operations such as:

- probing media metadata;
- extracting audio;
- extracting frames;
- generating thumbnails;
- cutting evidence clips.

FFmpeg is not the media-intelligence layer.

## Livepeer integration

Livepeer is the primary media-intelligence layer.

Keep Livepeer-specific behavior behind:

```text
src/lib/livepeer/
```

Application and domain code should depend on SiteThread-owned interfaces and normalized schemas rather than raw provider responses.

Expected abstraction:

```ts
interface MediaIntelligenceProvider {
  discoverCapabilities(): Promise<MediaCapabilities>;
  transcribe(input: TranscriptionInput): Promise<Transcript>;
  analyzeImage(input: VisionInput): Promise<VisionResult>;
}
```

Capabilities may change.

Resolve semantic requirements such as `TRANSCRIPTION` and `VISION` through the provider layer instead of scattering model names, capability names, URLs, or provider-specific fields through feature code.

If a required capability is unavailable, fail clearly.

Do not silently replace core Livepeer processing with another provider unless the architecture is intentionally changed and documented.

Fixture responses may be used for automated tests and local development.

Do not confuse fixture execution with live provider execution.

Read `docs/livepeer-integration.md` before modifying the media pipeline.

## Structured AI output

Treat model and provider output as untrusted input.

- Validate boundary data with Zod.
- Prefer `unknown` plus parsing over `any`.
- Normalize provider responses immediately.
- Keep SiteThread-owned types explicit.
- Do not persist malformed or partially parsed output.

Important domain concepts include:

- `Transcript`
- `TranscriptSegment`
- `VisionResult`
- `EvidenceCandidate`
- `ObservationDraft`
- observation review state

## Media-processing rules

Do not analyze every video frame.

Use the documented processing strategy:

```text
timestamped transcript
→ meaningful narration timestamps + periodic samples
→ deduplicate timestamps
→ extract frames
→ visual analysis
→ combine transcript + visual evidence
→ grounded draft observations
```

Keep processing idempotent.

Use a deterministic key that includes:

```text
walkthroughId + pipelineVersion
```

Retries must not create duplicate transcripts, frames, evidence, or observations.

## Security

Never commit credentials or real environment values.

Never expose server secrets through `NEXT_PUBLIC_*`.

Keep Livepeer, R2, database, and Trigger.dev credentials server-side.

Construction media should be private by default.

Use short-lived signed URLs when an external processor needs temporary access.

Avoid logging credentials or secret-bearing URLs.

## Code organization

Follow the repository structure defined in `docs/architecture.md`.

Expected direction:

```text
src/
├── app/
├── components/
├── features/
│   ├── projects/
│   ├── walkthroughs/
│   ├── observations/
│   └── reports/
├── lib/
│   ├── db/
│   ├── storage/
│   ├── livepeer/
│   ├── media/
│   ├── reasoning/
│   └── schemas/
└── trigger/
```

Keep route and page components thin.

Put domain logic in feature or library modules.

Avoid large generic utility files.

## Coding style

- Use strict TypeScript.
- Avoid `any`.
- Prefer small, composable functions.
- Use names that reflect domain meaning.
- Keep side effects at boundaries.
- Prefer readable code over clever abstractions.
- Reuse existing patterns before creating new ones.
- Remove dead code introduced by your change.
- Do not perform unrelated refactors inside a scoped task.
- Comments should explain why, not restate obvious code.

Before adding a dependency:

1. check whether the repository already solves the problem;
2. prefer platform capabilities where reasonable;
3. verify the dependency materially reduces complexity;
4. avoid large frameworks for small problems.

If an architecture decision changes, update the relevant documentation in the same change.

## Testing

Run the relevant checks before considering work complete:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm prisma validate
pnpm build
```

Use:

- Vitest for schemas, parsers, adapters, domain rules, and pure logic;
- Playwright for important user flows.

Use provider fixtures for deterministic automated tests where appropriate.

Keep an explicit live validation path for external integrations.

A bug fix should include a regression test when practical.

Do not claim a command passed unless it was actually run.

If a check cannot run, report why.

## UX expectations

SiteThread should feel like professional construction software, not a generic chatbot.

Primary concepts:

```text
Project
Walkthrough
Processing
Findings
Evidence
Review
Report
```

Important asynchronous actions need clear states:

- loading;
- queued;
- processing;
- success;
- failure;
- retry where appropriate.

Core workflows must remain usable on phone-sized screens.

Do not create dead buttons, fake actions, or controls that appear functional but are not.

## Branch workflow

Repository model:

```text
main    → release branch
dev     → integration branch
feature → short-lived implementation branches
```

Start feature work from `dev` unless instructed otherwise.

Do not push feature work directly to `main`.

Keep changes scoped to the requested task.

Before editing:

1. inspect relevant files;
2. search for existing patterns;
3. read applicable docs;
4. understand current behavior.

After editing:

1. inspect the diff;
2. run relevant validation;
3. remove accidental or unrelated changes;
4. update documentation if a contract changed;
5. summarize what changed, what was tested, and any remaining risks.

## Documentation

Use:

- `README.md` for public project understanding;
- `docs/architecture.md` for engineering architecture;
- `docs/livepeer-integration.md` for Livepeer-specific integration details;
- focused docs for future complex subsystems.

Keep this file operational and concise.

Do not turn `AGENTS.md` into a changelog, roadmap, or architecture encyclopedia.

## Definition of done

A task is complete when:

- the requested behavior works;
- it follows the documented architecture;
- types and schemas remain sound;
- relevant tests and checks pass;
- loading and failure states are handled where applicable;
- no secrets are introduced;
- no unrelated code is changed;
- documentation is updated when contracts change;
- the diff is reviewable;
- remaining risks or assumptions are stated clearly.

> **Build the smallest reliable system that turns real construction media into evidence-backed information a professional can review and trust.**
