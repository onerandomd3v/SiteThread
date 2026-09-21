# SiteThread demo rehearsal

COD-22 separates deterministic regression proof from real provider acceptance.

## Preconditions

The live rehearsal requires a controlled private deployment with working Neon, private R2, Trigger.dev, Livepeer raw MCP, FFmpeg/FFprobe, and server-only credentials. Provide an owned or consented MP4 reference file with:

- 60–120 seconds;
- H.264 video and AAC audio;
- clear English narration;
- a size within the current 100 MiB upload policy;
- at least three distinct evidence-backed findings.

Set `REHEARSAL_MEDIA_CONSENT=confirmed` only after the input has been approved for the rehearsal. Set `REHEARSAL_DATABASE_CONSENT=disposable` only when `DATABASE_URL` points to a disposable rehearsal database; never point the harness at a shared or production database. The harness refuses fixture mode, missing credentials, missing private storage configuration, or an uninspectable reference file before provider calls.

## Deterministic checks

Use the ordinary quality gate for application behavior:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
npx prisma validate
pnpm test:e2e
```

These tests use explicit fixtures or browser mocks. They prove application behavior, review persistence, report eligibility, evidence navigation, failure recovery, and mobile rendering. They do not prove GP-03 or GP-09.

## Live rehearsal

Set the server-only values listed by the live rehearsal configuration, including:

```text
LIVE_REHEARSAL=true
MEDIA_PROVIDER_MODE=live
REHEARSAL_REFERENCE_VIDEO=<local approved MP4>
REHEARSAL_MEDIA_CONSENT=confirmed
REHEARSAL_DATABASE_CONSENT=disposable
DATABASE_URL=...
R2_ACCOUNT_ID=...
R2_BUCKET_NAME=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
TRIGGER_SECRET_KEY=...
TRIGGER_PROJECT_REF=...
LIVEPEER_MCP_URL=https://agent.livepeer.org/api/mcp/raw
LIVEPEER_MCP_BEARER=...
```

Run:

```text
pnpm rehearse:live
```

The command FFprobes the reference, then runs two sequential fresh walkthrough uploads. Each run must reach `REPORT_READY`, produce at least three findings, save Confirm/Edit/Dismiss decisions, generate a report with two eligible findings, inspect source evidence, verify Print / Save PDF is present, and confirm the final walkthrough is read-only. The second run always uses a new walkthrough and upload intent.

The read-only verifier checks current-run provider provenance for `nemotron-asr`, `marlin-video`, and `gemini-text`, requires `livepeer` rather than `fixture`, checks evidence ranges and walkthrough identity, verifies one logical report per run, and rejects duplicate logical ranges or sequences. It never mutates the database and is not exposed as an API route.

## Artifacts and failure policy

Sanitized records and local PDFs are written under ignored `.rehearsal/`. They contain IDs, fingerprints, timings, provider mode, counts, and safe statuses only. They must not contain media paths, signed URLs, credentials, bearer tokens, prompts, transcript contents, finding text, or raw provider responses.

Fixture mode is an explicit local/demo mode only. Livepeer failure is a failed live rehearsal; the harness never switches from live to fixture. A previous successful run may be shown during an outage only when identified as a prior run.

The live proof remains incomplete until two real rehearsals pass with the selected reference media and configured deployment. Authentication and project authorization remain a separate controlled-private-MVP limitation; COD-22 does not add them.
