# SiteThread demo rehearsal

COD-22 separates deterministic regression proof from real provider acceptance.

## Preconditions

The live rehearsal requires a controlled private deployment with working Neon, private R2, Trigger.dev, the Livepeer Creative MCP, Google Gemini, Groq, and FFmpeg/FFprobe. Creative transcription uses the keyless official Creative MCP endpoint; Gemini handles visual semantics, while Groq handles structured observation reasoning through SiteThread's `ObservationReasoner`. The live harness requires `GEMINI_API_KEY` and `GEMINI_MODEL` for visual analysis, plus `REASONER_PROVIDER=groq`, `REASONER_MODEL=openai/gpt-oss-20b`, and `GROQ_API_KEY` for reasoning. It does not require a raw Livepeer bearer or raw-MCP endpoint. Provide an owned or consented MP4 reference file with:

- 60–120 seconds;
- H.264 video and AAC audio;
- clear English narration;
- a size within the current 100 MiB upload policy;
- at least three distinct evidence-backed findings.

Set `REHEARSAL_MEDIA_CONSENT=confirmed` only after the input has been approved for the rehearsal. Set `REHEARSAL_DATABASE_CONSENT=disposable` only when `DATABASE_URL` points to a disposable rehearsal database; never point the harness at a shared or production database. The harness refuses fixture mode, missing Gemini or Groq configuration, an unsupported reasoner provider/model, missing private storage configuration, or an uninspectable reference file before provider calls. Fixture CI and local fixture checks remain deterministic and do not require real provider credentials.

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
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.8-flash
REASONER_PROVIDER=groq
REASONER_MODEL=openai/gpt-oss-20b
GROQ_API_KEY=...
```

`LIVEPEER_CREATIVE_MCP_URL` may override the default Creative MCP endpoint; it is optional. Do not configure the historical `LIVEPEER_MCP_BEARER` or `LIVEPEER_MCP_URL` for this rehearsal path. The configured model comes from `GEMINI_MODEL`; generic rehearsal verification does not hardcode a Gemini model.

Current provider flow:

```text
walkthrough video
      ↓
SiteThread FFmpeg derivatives
      ↓
Livepeer Creative MCP — bounded transcription
      ↓
Google Gemini — visual semantics
      ↓
Groq — structured ObservationReasoner (`openai/gpt-oss-20b`)
      ↓
SiteThread validation / evidence / provenance
      ↓
human Confirm / Edit / Dismiss
      ↓
report
```

Marlin visual analysis and raw-MCP `gemini-text` reasoning are historical/superseded paths, not part of the active runtime.

Run the full two-run rehearsal only after the separate COD-177 visual and COD-178 reasoner live-acceptance checks pass:

```text
pnpm rehearse:live
```

The command FFprobes the reference, then runs two sequential fresh walkthrough uploads. Each run must reach `REPORT_READY`, produce at least three findings, save Confirm/Edit/Dismiss decisions, generate a report with two eligible findings, inspect source evidence, verify Print / Save PDF is present, and confirm the final walkthrough is read-only. The second run always uses a new walkthrough and upload intent.

The read-only verifier checks successful provider/capability provenance on each verified processing run: `livepeer` / `creative/transcribe`, `google-gemini` / `gemini-video-understanding`, and `groq` / `observation-reasoning`. It also requires the reasoner's recorded configured and served model to be `openai/gpt-oss-20b`. It binds transcript segments to their current-run source windows, rejects fixture, stale, cross-run, Marlin, raw `gemini-text`, wrong-provider, and model-substitution provenance, checks evidence ranges and walkthrough identity, verifies one logical report per run, and rejects duplicate logical ranges or sequences. It never mutates the database and is not exposed as an API route.

## Artifacts and failure policy

Sanitized records and local PDFs are written under ignored `.rehearsal/`. They contain IDs, fingerprints, timings, provider mode, counts, and safe statuses only. They must not contain media paths, signed URLs, credentials, bearer tokens, prompts, transcript contents, finding text, or raw provider responses.

Fixture mode is an explicit local/demo mode only. Any required provider failure is a failed live rehearsal; the harness never switches provider, model, or mode and never fabricates successful provenance. A previous successful run may be shown during an outage only when identified as a prior run.

The live proof remains incomplete until two real rehearsals pass with the selected reference media and configured deployment. Authentication and project authorization remain a separate controlled-private-MVP limitation; COD-22 does not add them.
