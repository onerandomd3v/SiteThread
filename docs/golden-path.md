# SiteThread golden path and demo acceptance criteria

**Scope:** [COD-13 — Lock the SiteThread golden path and demo acceptance criteria](https://linear.app/codeddevs/issue/COD-13/lock-the-sitethread-golden-path-and-demo-acceptance-criteria).

This is the product acceptance contract for SiteThread's first usable release. SiteThread is an ongoing construction product; the Livepeer Agent Hackathon is the delivery milestone for this journey. Requirements below describe what must work, not functionality already implemented or validated.

Use this document for product scope and acceptance. Use [architecture.md](architecture.md) for engineering boundaries and [livepeer-integration.md](livepeer-integration.md) for the dated capability evidence and unresolved provider contracts. Later engineering issues should reference the acceptance IDs below rather than copy this contract.

## Primary user and outcome

The primary user is a construction professional responsible for a site walk and its record, such as a site supervisor or project engineer. The same person captures or uploads the walkthrough, reviews the findings, and prepares the report in this MVP.

Their job is to turn what they saw and said on site into a concise project record that another professional can inspect. Success means less reconstruction of scattered media while retaining source context and human authority. The product should be understandable through **Project → Walkthrough → Findings → Evidence → Report** on a phone-sized screen.

**AI prepares. Human confirms.** A reviewed record documents observations; it does not certify the underlying construction work.

## Golden path

```text
Open SiteThread
→ create a named project or select an existing project
→ upload a narrated site walkthrough recorded on a phone
→ see upload completion and processing stages
→ process transcript and selected visual evidence through Livepeer
→ see structured draft observations with source references
→ inspect evidence and Confirm / Edit / Dismiss each finding
→ generate a report from confirmed and edited findings
→ inspect the report's underlying evidence
→ print or save the report as PDF
```

One project, one walkthrough, one reviewer, and one resulting report are sufficient for the demonstration. Project creation requires only a name; selecting a seeded project is allowed for the live presentation, but the empty-project state and creation path must work in acceptance testing.

Recording with the phone's camera and then selecting that file satisfies capture. A custom in-app recorder is not required. Do not display a nonfunctional recording or sharing control.

## Minimum input and operating assumptions

- The required reference walkthrough is **60–120 seconds**, a playable **MP4 with H.264 video and AAC audio**, recorded upright or landscape on a phone. Support this reference input end to end before widening the input matrix.
- Use owned or consented construction footage, with no confidential documents or unnecessary identifying details in view. Synthetic shapes and fixture responses do not satisfy the construction demo.
- Use one clearly audible English-speaking narrator, adequate lighting, and a slow walk. The narrator identifies the area and describes observable conditions while the camera shows the relevant area. Multi-speaker identification, translation, and poor-audio recovery are not required.
- Choose footage with at least three distinct, evidence-supported observations so the presentation can show Confirm, Edit, and Dismiss. No unsafe condition needs to be staged. A normal progress observation, a visible condition, and a narrated follow-up are sufficient.
- A connected phone or desktop browser and an authorized reviewer session are assumed. Offline capture synchronization, interrupted-upload resumption, account onboarding, and team administration are outside this journey.
- The upload UI must state the actually supported formats, duration, and size limits and reject unsupported input clearly. The architecture's earlier suggestions of MOV, roughly ten minutes, and roughly 250 MB are expansion targets, not validated release promises. The selected reference file's actual size, codecs, duration, and processing cost must pass the deployment rehearsal before demo readiness is claimed.

These assumptions define the minimum supported journey, not an assertion that current Livepeer contracts can process it. A silent clip, unreadable video, or missing speech timing must not be presented as successful completion of this narrated walkthrough path.

## Required screens and states

These are user-visible surfaces; several may share a page. Route structure and components remain engineering decisions.

| Surface | Required content and states | Completion condition |
|---|---|---|
| Project entry | Product purpose, existing projects, empty state, create-by-name, selected project context; loading and load/create failure with a recoverable action | User knows which project will own the walkthrough |
| Walkthrough upload | Selected file, project, capture guidance, input limits, validation errors, upload progress, upload failure and retry | Durable upload succeeds before processing is shown as queued |
| Processing | Queued, transcribing, analyzing visual evidence, preparing findings, ready for review; active/completed/failed stage and useful waiting message | Required transcript and visual processing succeed and valid drafts are available |
| Findings review | Draft cards, observation type, description, available location/trade, source basis, evidence entry point, Confirm / Edit / Dismiss, saved decisions and remaining review count | Every draft has a saved decision; at least one eligible finding remains |
| Evidence viewer | Source walkthrough identity, source-relative time or range, relevant transcript text when cited, frame/clip or source playback at that time; loading, unavailable and retry states | Reviewer can inspect the cited source and return to the same finding or report |
| Report | Project and walkthrough context, reviewed findings and evidence references, reviewer/time metadata, generating/ready/failure, print/save-as-PDF action | Generated report passes the report rules below and exported output is readable |

### Waiting, failure, and empty results

- Upload progress may show measured bytes. Processing shows real stage status; do not invent completion percentages or an ETA. The user must be able to leave and reopen the walkthrough without losing its run or saved review decisions.
- A failure names the failed stage, explains its effect in plain language, and gives the applicable next action: retry a temporary failure, replace unsupported media, or explain that a service/configuration issue needs resolution. Do not expose raw provider errors, credentials, or media access tokens.
- Repeated clicks, page refreshes, and retries must not create duplicate findings, evidence, or reports for the same logical run. A pending provider job must not be displayed as completed.
- If required transcription, speech timing, visual analysis, or result validation fails, show an incomplete/failed run. Do not silently use fixtures, substitute another provider, or call a transcript-only result the completed multimodal journey.
- If processing completes but produces no valid findings, show an honest empty result with guidance to provide a clearer walkthrough. Do not manufacture observations. If the user dismisses everything, show “No findings selected for report” and keep final report generation unavailable.
- A failed review save leaves the decision visibly unsaved and offers retry. A failed report generation preserves review decisions. A missing evidence asset is explicitly unavailable; it must not be represented by an unrelated image or empty successful viewer.

## What counts as a valid observation

A finding is one specific, reviewable statement about the walkthrough. It must have:

1. A type: **progress**, **potential issue**, **action**, or **note**.
2. A nonempty description supported by identifiable source content.
3. A source basis: **reported in narration**, **visually observed**, or **both**. Narration alone must not be described as visual confirmation.
4. A stable link to its source walkthrough and the relevant evidence, with a correct source-relative timestamp or range.
5. A `DRAFT` review state before any human decision.

Location and trade are optional; omit or show “Not specified” when the source does not establish them. Do not invent rooms, quantities, causes, severity, responsible people, deadlines, or completion percentages. An action can be a clearly labeled proposal for professional follow-up, grounded in a cited condition or narrated request; it is not an assigned commitment.

For example, “The narrator reports water near Room 204 at 00:42” is different from “Standing water is visible near the doorway at 00:42.” Both may be useful if their stated source supports them. “The waterproofing has failed” is not justified by either statement alone.

Malformed output or a claim with no supporting evidence is not a valid draft. Model confidence does not replace evidence. A disagreement between narration and imagery should remain explicit for review, not be resolved by inventing certainty.

## Evidence traceability

- Every final report claim must trace through its reviewed observation to the original walkthrough and at least one supporting source item. Project metadata is user-supplied context, not an inferred construction claim.
- A narration-based finding cites the relevant transcript segment and its true source time range, with playback at that range. A visual finding cites a source frame and its extraction time, or a clip and its source range. A finding claiming both kinds of support cites both.
- Evidence detail shows the original source context, not just a generated caption. The transcript is presented as machine-generated and inspectable against the audio; extracted evidence retains its source identity. Editing a finding must not overwrite the original transcript or media.
- Times are offsets from the start of the original walkthrough, within its duration and ordered correctly. Any extracted audio/clip offsets must map back to that same timeline. Check alignment by playing the referenced interval; a plausible time label alone does not pass.
- Speech timing must come from a verified timing/alignment contract. Do not guess segment boundaries from text length, spread text across a video's duration, or reuse visual event intervals as speech timestamps.
- Evidence identity must survive page reloads and renewed media access. Temporary signed URLs are access mechanisms, not report citations. Use durable application evidence references; construction media stays private by default.
- A standalone downloadable clip is optional when the user can inspect a frame and seek the original source to the correct interval. The precise visual inference route remains subject to the COD-32 gate below.

## Human review and report rules

### Review

- **Confirm** records the reviewer's acceptance of the draft wording and its supporting evidence.
- **Edit** opens the finding for correction. Only an explicit successful save changes it to `EDITED`; opening the editor or cancelling does not. Preserve the original draft, revised text, reviewer, review time, and evidence links.
- **Dismiss** excludes the finding from the report while retaining its disposition in the review record. It does not delete the source evidence.
- Each finding requires an individual decision. No automatic confirmation, default acceptance, or bulk “approve everything” is required or allowed for this minimum journey.
- Edits must remain grounded in the cited evidence. The edit flow must keep that evidence accessible and ask the reviewer to confirm the revised wording is supported. Human review is not permission for the application to turn unsupported wording into a verified fact.
- Generate report becomes available only after all drafts have a saved disposition and at least one confirmed or edited finding has valid evidence. Review decisions and the remaining count must survive refresh.

### Report

The report must contain the project name, walkthrough identity/date, report generation time, reviewer identity and review times, and the final wording of eligible observations. Group findings by their types where useful; omit empty sections without inventing filler.

Only `CONFIRMED` and `EDITED` findings enter the report. `DRAFT` and `DISMISSED` findings must never appear, including through an automatically written summary or action list. Do not add new factual claims during report rendering. Use the saved edited text, not the original AI draft.

Each finding includes its evidence label, source time/range, and an application link to inspect the corresponding evidence. Include a representative frame where the finding has visual evidence and relevant transcript text where narration is cited. The reviewer must be able to follow the link back to the correct source from the report.

The generated report represents the saved review decisions at generation time. If those decisions change later, require regeneration before exporting an up-to-date report; do not silently change a previously generated report. A report is a reviewed site record, not a safety certificate or inspection approval.

The required export is **Print → Save as PDF**, as described in the architecture. The PDF must retain readable findings, review metadata, evidence labels, time references, visual evidence where applicable, and links to the authorized application evidence view. It must not depend on an expiring raw media URL. Playback remains in the application; recipients need authorized access to inspect private media. Manually sending the PDF satisfies the issue's export/share scope; public share links, email delivery, and embedded video in PDF are not required.

## Acceptance checks and visible demo proof

These are pass/fail checks for the future implementation. **None is claimed passed by this documentation change.** Fixture-based checks can exercise product behavior, but the live checks below require actual Livepeer execution.

| ID | Check | Required proof |
|---|---|---|
| GP-01 | Product value within 30 seconds | An unfamiliar reviewer can explain that SiteThread turns a site walkthrough into findings they review and an evidence-backed report. Show the construction project, a finding with evidence, and the human decision before explaining provider internals. A saved example used for orientation is labeled as a prior run. |
| GP-02 | Project context and capture | Starting with no projects, create a named project through the UI; reopen and select it. Upload the reference video from a phone-sized layout. Verify unsupported input and upload failure have clear, usable recovery states. A seeded project may be used during the presentation. |
| GP-03 | Real processing | A fresh upload reaches findings through visible processing stages using real Livepeer transcript and visual processing. Show the resulting transcript and visual evidence. Retain a sanitized run reference and stage outcomes for verification; do not expose secrets or rely only on a “Live” badge. |
| GP-04 | Grounded drafts | At least three distinct valid findings from the reference walkthrough appear as drafts. Inspect their source basis and trace each to the relevant narration and/or imagery. Do not require identical model wording across runs. Unsupported claims must not become accepted output. |
| GP-05 | Three review decisions | Confirm one finding, edit and save another, and dismiss a third. Refresh and verify persistence. Verify unsaved edits and failed saves do not count as approval. Leave a draft unresolved and verify report generation remains blocked. |
| GP-06 | Report inclusion and export | After completing review, generate the report. It contains the confirmed wording and saved edited wording, excludes dismissed/draft content everywhere, and includes review metadata. Save as PDF and inspect the readable output and its evidence references. |
| GP-07 | Inspectable evidence | Open evidence from every report finding, compare transcript claims against audio and visual claims against source imagery, and verify timeline alignment. Reopen after media access renewal. A missing asset shows an explicit failure instead of false evidence. |
| GP-08 | Failures, empty results, and recovery | Exercise an input failure, a processing failure, and a failed save/report operation. Show actionable states and successful recovery without duplicate records or loss of saved decisions. Verify zero valid findings and all-dismissed findings cannot produce a misleading final report. Controlled failures may use clearly labeled fixtures. |
| GP-09 | Repeatable end-to-end run | Complete **two consecutive fresh live runs** of the approved reference walkthrough through upload, review, report, and evidence inspection, with no manual database edits, injected provider results, or temporary probe scripts in the product path. Each run is a deliberate new walkthrough; retries within one run do not duplicate records. Record duration, processing mode, input identity, and measured/unknown cost for each rehearsal. |
| GP-10 | Professional and private by default | Phone-sized upload, review, evidence inspection, and report views are usable. No autonomous safety/compliance conclusions or unsupported claims enter the report. Source media and evidence require authorized access; exported links contain no credentials or expiring media tokens. |

The live presentation must visibly show project selection, the reference upload, real processing states, transcript and visual evidence, all three review actions, the resulting inclusion/exclusion in the report, evidence navigation, and export. An edited recording may compress waiting time if that is disclosed. A prerecorded successful run can illustrate the product, but cannot replace the two live acceptance rehearsals. A provider outage must be reported honestly; a labeled fixture demonstration does not pass GP-03 or GP-09.

**End-to-end success:** all GP checks pass, a professional can inspect and trust the provenance of every included finding, and the second live run reproduces the workflow without operator repair. This is workflow acceptance on representative media, not a claim of broad construction accuracy or production readiness. The rehearsal record should identify the build, date, reference input, check outcomes, measured wait times, and remaining limitations without publishing private media or provider credentials.

## Intentional exclusions and guardrails

- No autonomous structural-safety judgment, code-compliance certification, inspection approval, engineering acceptance, exact completion percentage, or financial entitlement. Prefer “visible condition,” “reported by the narrator,” “potential issue,” and “requires professional review.”
- No comprehensive defect detection, inference of hidden conditions, automatic task assignment, or claim that an unflagged area is safe. Reports cover only the recorded and reviewed evidence.
- No team collaboration workflow, multi-reviewer approval, scheduling, cost management, BIM, enterprise integrations, long-term search/analytics, chatbot-first interface, or OriginTrail/DKG in this release contract.
- No live-stream monitoring, offline synchronization, custom recorder, bulk media library, multi-walkthrough report aggregation, public media sharing, dedicated PDF service, or automatic email delivery.
- No real credentials, temporary probe outputs, generated test media, or local machine paths in durable product documentation or the demo report. Fixture mode remains explicit and separate from live execution.

## Unresolved readiness gates and product decisions

COD-14 selected **raw Livepeer MCP** behind the SiteThread provider boundary. It verified text transcription and limited synthetic-video understanding. It did **not** establish timestamped transcription, a working direct image/frame input route, or representative construction-media success. This product contract does not upgrade those results.

[COD-32 — Resolve Livepeer media-contract gates before COD-17](https://linear.app/codeddevs/issue/COD-32/resolve-livepeer-media-contract-gates-before-cod-17) owns the follow-up. Its technical details and evidence belong in [the integration validation](livepeer-integration.md#not-yet-verified--gates-before-cod-17), including reliable text-job retrieval, deployment credentials, and signed-media access.

The remaining decisions before claiming demo readiness are:

1. **Evidence timing and visual route:** verify the required speech alignment and frame/image path. If a clip/video alternative is necessary, explicitly approve and document how it preserves this product's evidence inspection and timing requirements before COD-17. Missing timing is a failed requirement, not a license to invent timestamps or weaken traceability silently.
2. **Reference media and supported input envelope:** select the consented construction walkthrough and validate its exact format/size and private access end to end. Broader upload limits must follow evidence rather than the earlier architectural estimates.
3. **Acceptable wait and per-run budget:** measure the full reference workflow with the chosen contracts and agree the operational limits before the demo. COD-14's short synthetic probes do not establish a production latency SLA, a demo wait-time promise, or a settled cost ceiling.

The journey, individual review requirement, report inclusion rules, and PDF export scope are fixed by this contract. Provider choices and operational limits remain explicit gates; this issue does not implement COD-17 or declare those gates resolved.
