# SiteThread

> Turn a site walk into a trusted project record.

SiteThread is a phone-first construction field agent that turns ordinary site walkthrough video, imagery, and spoken observations into structured, evidence-backed project records.

It helps construction professionals move from raw field media to reviewable findings, action items, and site reports without adding a heavy capture workflow.

## The Problem

Construction teams already capture photos, videos, and spoken notes during site walks. The difficult work comes afterward: finding what matters, connecting observations to locations and timestamps, and turning scattered media into a reliable project record.

SiteThread prepares that record while keeping the source evidence attached to each finding.

## How SiteThread Works

```text
Site walkthrough
        ↓
Media processing
        ↓
Transcript + visual evidence
        ↓
Structured observations
        ↓
Confirm / Edit / Dismiss
        ↓
Evidence-backed site report
```

Users record or upload a walkthrough and narrate what they see. SiteThread combines the transcript with relevant visual evidence to prepare structured observations. Each observation can be confirmed, edited, or dismissed by a construction professional. Only confirmed or edited information becomes part of the trusted report.

## Core Principle

> AI prepares. Human confirms.

Findings remain traceable to their source where available, including transcript segments, timestamps, frames, and clips. SiteThread supports professional review; it does not independently certify safety, compliance, engineering acceptance, or completion percentages.

## Livepeer

Livepeer is SiteThread's primary media-intelligence layer. The selected raw MCP path uses six-second SiteThread-timed `nemotron-asr` windows and bounded `marlin-video` clips. The pipeline persists transcript and visual candidates for later observation reasoning. Production bearer ownership, private signed-media fetches, and representative construction-media quality still require live validation.

See the [Livepeer integration and technical spike](docs/livepeer-integration.md) for the detailed integration decisions, provider boundaries, capability validation, and processing strategy.

## Architecture

SiteThread uses a Next.js application for the product experience and API boundaries, durable background jobs for long-running media processing, private object storage for media, and structured PostgreSQL data for project records. FFmpeg handles deterministic media operations; Livepeer handles media intelligence.

See the [architecture and engineering plan](docs/architecture.md) for system boundaries, data flow, repository structure, testing, and implementation decisions.

## Tech Stack

| Area | Technology |
|---|---|
| Application | TypeScript, Node.js, Next.js, React |
| UI | Tailwind CSS, shadcn/ui |
| Validation | Zod |
| Database | Neon PostgreSQL, Prisma |
| Media storage | Cloudflare R2 |
| Background processing | Trigger.dev |
| Media intelligence | Livepeer Agent |
| Media utilities | FFmpeg |
| Hosting | Vercel |
| Testing | Vitest, Playwright |
| CI | GitHub Actions |

## Documentation

- [Golden Path & Demo Acceptance Criteria (COD-13)](docs/golden-path.md)
- [Architecture & Engineering Plan](docs/architecture.md)
- [Livepeer Integration & Technical Spike](docs/livepeer-integration.md)
- [Repository Agent Guidance](AGENTS.md)

## Development

The repository uses the following branch model:

- `dev` — protected integration branch
- `main` — protected release branch
- short-lived feature branches — implementation work

Changes should be made on a feature branch and submitted through a pull request into `dev`. The application is still being built; the detailed architecture and integration documents describe the current engineering direction.
