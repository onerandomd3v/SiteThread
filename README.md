# SiteThread

> **Turn a site walk into a trusted project record.**

SiteThread is a phone-first construction field agent that turns ordinary site walkthrough video, images, and spoken observations into **evidence-backed findings, reviewable action items, and structured site reports**.

Built for the **Livepeer Agent Hackathon 2026 — Track 1: Livepeer Agent Builder**.

> **Core principle:** AI prepares. Human confirms.

---

## The Problem

Construction teams already create large amounts of visual project documentation every day:

- site photos;
- walkthrough videos;
- inspection media;
- progress records;
- punch-list evidence;
- pre-cover / hidden-work documentation;
- issue and change-condition evidence.

The problem is not capturing media. The problem is what happens **after** it is captured.

A superintendent, project engineer, QA/QC professional, or site manager may finish a walkthrough with dozens of photos, minutes of video, spoken notes, and observations that still have to be manually turned into usable project records.

That usually means answering questions such as:

- Where was this photo taken?
- What was happening at this point in the walkthrough?
- Was this progress, an issue, or just a note?
- Which trade does it relate to?
- Which image best proves the observation?
- What needs action?
- How does this become a daily or progress report?
- Can we find this evidence again months later?

Construction software already proves that visual documentation is valuable. Tools such as Procore, Autodesk Build, Fieldwire, OpenSpace, Buildots, and DroneDeploy all treat site imagery as important project information. SiteThread focuses on a narrower gap:

> **turning ordinary site media into structured, evidence-backed project knowledge without forcing the field team into a heavy capture workflow.**

---

## The Product Thesis

A construction professional should be able to walk the site with the phone already in their pocket, record what they see, speak naturally, and let SiteThread prepare the documentation.

Instead of this:

```text
Walk site
   ↓
Take photos and videos
   ↓
Return to office
   ↓
Search through media
   ↓
Match notes to locations
   ↓
Write observations manually
   ↓
Build report manually
```

SiteThread aims for this:

```text
Walk + record + speak
        ↓
SiteThread understands the media
        ↓
Draft observations + evidence
        ↓
Human Confirm / Edit / Dismiss
        ↓
Trusted site report
```

---

## Who SiteThread Is For

The initial product is designed around people who already document and review site conditions:

- Superintendents / Site Managers
- Project Engineers
- Project Managers
- QA/QC teams
- Foremen
- Architects and Engineers performing observations
- Owner / Developer representatives
- Commercial and quantity-surveying teams
- Facilities teams during handover and later building operation

The hackathon MVP focuses primarily on the **site manager / superintendent site-walk workflow**.

---

## How It Works

### 1. Capture or upload a site walkthrough

A user records a normal construction walkthrough using a phone and narrates what they see.

Example:

> “We’re on Level 2. Ceiling framing is complete along this corridor.”
>
> “There’s water pooling beside Room 204 and it needs checking.”
>
> “Electrical rough-in in Room 205 is complete.”

### 2. Process the walkthrough with Livepeer

Livepeer acts as SiteThread’s core media-intelligence layer.

The processing pipeline combines:

- timestamped speech transcription;
- visual understanding of selected frames;
- media evidence extraction;
- multimodal context from video, imagery, and narration.

### 3. Build evidence-backed observations

SiteThread combines narration and visual evidence into structured draft findings such as:

```text
Type: Progress
Location: Level 2 / Room 205
Trade: Electrical
Observation: Electrical rough-in was reported complete.
Evidence: 03:54–04:03 + selected frame
Status: Draft
```

Or:

```text
Type: Potential issue
Location: Level 2 / Room 204
Observation: Water accumulation was reported and visually observed.
Evidence: 02:08–02:21 + selected frame
Status: Needs review
```

### 4. Human review

Every AI-prepared finding is reviewed by a construction professional.

The reviewer can:

- **Confirm**
- **Edit**
- **Dismiss**

Only confirmed or edited observations become part of the final project record.

### 5. Generate the site report

SiteThread produces a structured report containing:

- walkthrough/project metadata;
- progress observations;
- potential issues / attention items;
- action items;
- representative evidence frames;
- source timestamps;
- reviewer-confirmed information.

---

## The Golden Path

The hackathon MVP is intentionally focused on one complete experience:

```text
Upload walkthrough
      ↓
Livepeer media processing
      ↓
Timestamped transcript
      ↓
Relevant frame extraction
      ↓
Livepeer visual analysis
      ↓
Grounded construction observations
      ↓
Confirm / Edit / Dismiss
      ↓
Evidence-backed daily site report
```

If this path is reliable and easy to understand, the MVP succeeds.

---

## Why Livepeer

SiteThread is not using Livepeer as a decorative AI integration.

Livepeer is intended to sit at the center of the media workflow:

```text
Construction video + audio
            ↓
      Livepeer Agent
       /           \
 transcription    vision
       \           /
        media context
             ↓
      SiteThread logic
             ↓
     trusted project record
```

For the MVP, the Livepeer integration is being designed around:

- timestamped transcription;
- image / frame understanding;
- dynamic capability discovery;
- media-intelligence execution through a provider adapter.

See [`docs/livepeer-integration.md`](docs/livepeer-integration.md) for the detailed integration plan and technical spike.

---

## What Makes SiteThread Different

SiteThread is **not** just:

> Upload video → receive AI summary.

The product is designed around **traceability and review**.

Every meaningful observation should retain a path back to its source:

```text
Observation
    │
    ├── Transcript segment
    ├── Video timestamp
    ├── Evidence frame
    └── Evidence clip (where useful)
```

That changes the output from generic AI prose into something closer to real construction documentation.

### Evidence first

A finding should be inspectable against the original walkthrough.

### Human authority

AI prepares the record; the construction professional decides what becomes trusted project information.

### Low-friction capture

The product is designed to begin with ordinary phone video rather than requiring a site to adopt specialist capture hardware before receiving value.

### Construction workflow, not generic chat

The primary product concepts are:

```text
Project → Walkthrough → Findings → Evidence → Review → Report
```

not a generic “chat with your construction AI” interface.

---

## What SiteThread Is Not

The hackathon MVP is **not** an autonomous construction inspector.

SiteThread does not attempt to independently certify:

- structural safety;
- building-code compliance;
- engineering acceptance;
- exact percentage completion;
- inspection approval;
- financial entitlement or change-order value.

The system should prefer language such as:

- “Potential issue requiring review”
- “Visible condition detected”
- “User reported…”
- “Observed in source media…”
- “Requires professional confirmation”

rather than pretending the AI is the engineer of record.

---

## MVP Scope

### In scope

- Walkthrough upload
- Private construction media storage
- Background processing lifecycle
- Livepeer-backed transcription
- Selected-frame visual analysis
- Evidence candidate generation
- Structured construction observations
- Confirm / Edit / Dismiss review flow
- Evidence-backed site report
- Mobile-friendly product UX
- Reliable golden-path demo

### Deliberately out of scope for the hackathon

- BIM integration
- Autonomous code inspection
- Precise project-completion percentages
- Safety certification
- Full Procore / Autodesk integration
- Live continuous site monitoring
- Dedicated native mobile app
- Multi-company enterprise administration
- Advanced semantic project search
- OriginTrail / DKG project memory

These can come later if the core workflow proves valuable.

---

## Architecture

The application is intentionally simple around a more serious media-processing pipeline.

```text
┌──────────────────────────────┐
│        User / Browser        │
│ Upload → Review → Report     │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│       Next.js Application    │
│ UI + API + Report Renderer   │
└───────┬────────┬─────────────┘
        │        │
        ▼        ▼
      Neon      R2
    Postgres   Media
        │        │
        └───┬────┘
            ▼
      Trigger.dev Worker
            │
       ┌────┴─────┐
       ▼          ▼
    FFmpeg   Livepeer Agent
                  │
                  ▼
          Structured Findings
                  │
                  ▼
             Human Review
                  │
                  ▼
             Final Report
```

The complete engineering plan is documented in [`docs/architecture.md`](docs/architecture.md).

---

## Planned Stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| Runtime | Node.js 22 |
| Package Manager | pnpm |
| Web | Next.js 16 + React 19 |
| Styling | Tailwind CSS 4 |
| Components | shadcn/ui |
| Validation | Zod |
| Database | Neon PostgreSQL |
| ORM | Prisma |
| Media Storage | Cloudflare R2 |
| Background Jobs | Trigger.dev |
| Media Intelligence | Livepeer Agent |
| Media Utilities | FFmpeg |
| Hosting | Vercel |
| Unit Testing | Vitest |
| E2E Testing | Playwright |
| CI | GitHub Actions |
| Project Management | Linear |

---

## Repository Documentation

The project documentation currently lives under `docs/`:

```text
docs/
├── architecture.md
└── livepeer-integration.md
```

### [`docs/architecture.md`](docs/architecture.md)

Defines:

- system architecture;
- stack decisions;
- service responsibilities;
- data model direction;
- media-processing pipeline;
- environment strategy;
- testing and CI/CD;
- implementation guardrails.

### [`docs/livepeer-integration.md`](docs/livepeer-integration.md)

Defines:

- Livepeer's role in SiteThread;
- direct SDK/API vs MCP decision;
- capability discovery;
- transcription and vision requirements;
- adapter contracts;
- retry/timeout strategy;
- fixture mode;
- COD-14 runtime validation checklist.

---

## Product Roadmap

The hackathon MVP is the first layer of a larger product direction.

### Phase 1 — Site Walk → Report

```text
Capture → Understand → Review → Report
```

### Phase 2 — Issues and follow-up

Connect observations to:

- responsible trades;
- action items;
- before/after evidence;
- issue closure.

### Phase 3 — Visual project search

Examples:

> “Show me the electrical work in Apartment 403 before drywall.”

> “Find every observation related to the third-floor plumbing.”

### Phase 4 — Project memory

Turn confirmed observations into a long-lived visual history of the project:

```text
Location
   ↓
Activity
   ↓
Evidence
   ↓
Inspection / Review
   ↓
Status
```

This is where deeper provenance or a future OriginTrail/DKG integration may become useful.

### Phase 5 — Integrations

Potential future integrations include construction-management platforms, project schedules, drawings, BIM, and handover systems.

---

## Development Status

SiteThread is currently in active hackathon development.

Current priorities:

1. Validate the real Livepeer runtime capabilities available to the project.
2. Lock transcription and vision request/response contracts.
3. Scaffold the application architecture.
4. Implement the walkthrough processing pipeline.
5. Build evidence-backed observation review.
6. Generate the final site report.
7. Harden the golden path for the hackathon demo.

The detailed build plan is tracked in Linear.

---

## Branch Strategy

- `main` — protected release branch
- `dev` — protected development / integration branch
- short-lived feature branches — implementation work

Changes should flow through pull requests into `dev`, with stable release-ready work promoted to `main`.

---

## Research Foundation

SiteThread's product thesis is based on research into real construction documentation workflows and existing construction technology, including:

- [Procore — Photos](https://www.procore.com/project-management/photos)
- [Procore — Daily Log](https://support.procore.com/products/online/user-guide/project-level/daily-log/tutorials/daily-log-overview)
- [Autodesk Build — Daily Logs](https://help.autodesk.com/cloudhelp/ENU/BIM360D-Field-Management/files/GUID-CDBFE508-C833-42AB-9A36-A67999BBE58E.html)
- [Fieldwire — Photos](https://help.fieldwire.com/hc/en-us/articles/211358926-Introduction-to-the-Photos-Tab)
- [Fieldwire — Punch Lists](https://www.fieldwire.com/punch-list-app/)
- [OpenSpace Capture](https://www.openspace.ai/products/capture/)
- [Buildots — Progress Tracking](https://buildots.com/blog/project-progress-tracking/)
- [DroneDeploy — Progress AI](https://www.dronedeploy.com/product/progress-ai)

These products validate the importance of construction-site imagery. SiteThread's focus is the workflow between **ordinary field media and trusted project records**.

---

## Hackathon Goal

The final demo should make one thing obvious within seconds:

> A construction professional records a normal site walkthrough. SiteThread uses Livepeer-powered media intelligence to prepare evidence-backed observations. The professional reviews them, and SiteThread turns the approved findings into a trusted project report.

That is the product.

---

## Documentation

- [Architecture & Engineering Plan](docs/architecture.md)
- [Livepeer Integration & Technical Spike](docs/livepeer-integration.md)

---

**SiteThread** — *Turn a site walk into a trusted project record.*
