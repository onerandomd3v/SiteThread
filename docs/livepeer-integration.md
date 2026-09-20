# SiteThread — Livepeer integration validation (COD-14 and COD-32)

> **Track:** Livepeer Agent Builder, Track 1
>
> **Validation dates:** 2026-09-17 UTC (COD-14); 2026-09-17 UTC / 2026-09-18 local (COD-32)
>
> **Status:** COD-32 selects deterministic FFmpeg-windowed transcription and synchronous short-clip visual analysis. Production bearer ownership, signed-R2 fetches, and construction-domain quality remain deployment validation gates.
>
> **Scope:** Integration decision and validation findings. No COD-17 pipeline implementation.

## Final integration decision

Use **Livepeer raw MCP over Streamable HTTP**, at the path-pinned `https://agent.livepeer.org/api/mcp/raw`, behind the SiteThread-owned `MediaIntelligenceProvider` in the Trigger.dev worker. Keep capability discovery, transport, authentication, result validation, and error classification inside `src/lib/livepeer/`.

COD-32 freezes two narrow media contracts for COD-17. Transcription uses exact six-second FFmpeg source windows and synchronous `nemotron-asr`; SiteThread supplies the trustworthy window start/end because raw MCP did not preserve native ASR timestamps. Visual analysis uses bounded six-second H.264/AAC clips and synchronous `marlin-video`; the complete clip range is the durable evidence range, while model-proposed subranges remain untrusted hints. Direct image analysis is not selected. Marlin's async text-job wrapper failed in all three current probes, so COD-17 must not use that polling route for visual results.

**COD-17 is implementation-safe** under the explicit contract in this document. That statement authorizes provider implementation, fixtures, orchestration, and normalization; it is not a production-readiness claim. An issued Livepeer bearer, a live signed-R2 fetch, representative owned construction media, and the resulting latency/cost rehearsal must pass before the live demo or production mode is considered ready.

Direct Livepeer HTTP is a real alternative: its public registry, OpenAPI, and the underlying result of our MCP-submitted job were reachable. It remains useful for diagnosis and reconsideration if MCP cannot preserve the required results. Direct inference submission, authenticated production behavior, and equivalent idempotency were not validated. Do not silently add an SDK fallback or call unrelated model vendors.

The earlier blanket rejection of MCP as a production runtime was unsupported. MCP can be called deterministically from application code; it does not require a human chat session. The workshop demonstrates this application pattern. Trigger.dev still owns the durable workflow. [Get Started][get-started] · [Workshop adapter][workshop-adapter]

## COD-32 runtime validation

The COD-32 probes used the live service with generated speech, a generated image, and generated short clips. They used no fixture responses, project secrets, or construction media. Full responses, media, and probe scripts remained outside the repository. Single-call timings are observations, not benchmarks.

### Current raw surface and authentication behavior

- `https://agent.livepeer.org/api/mcp/raw` accepted JSON-RPC `initialize` at protocol `2024-11-05`, `notifications/initialized`, and `tools/list`. It identified `livepeer-agent-raw`, version `1.0.0`, returned 23 tools, and did not issue an `Mcp-Session-Id`; subsequent tool calls in each initialized exchange succeeded without one. The bare `/api/mcp` path resolved to the same raw server in this test, but COD-17 must use the named `/raw` path.
- `list_capabilities` still returned 207 capabilities. `nemotron-asr`, `whisper-word`, `wizper`, `nemotron-omni`, and `marlin-video` were present; `wizper` was experimental and `nemotron-vision` was not registered.
- Without an Authorization header, `me` returned `key_class: "demo"`. A deliberately invalid bearer was accepted as a different `key_class: "opaque"` principal instead of proving or rejecting account ownership. Therefore a successful initialize or `me` response is not a production credential check. Production mode must require an issued server-side bearer and complete an account/credit smoke test in the deployment environment. Keyless and arbitrary-bearer access are validation-only. The existing optional `LIVEPEER_MCP_BEARER` field remains the correct configuration: it may be absent in fixture or explicitly enabled keyless-development mode, but COD-17 must reject live production startup when it is absent. No additional authentication field is justified by current evidence.

### Timestamp-grounded transcription

Raw MCP returned transcript text but no native timing chunks from all three tested ASR candidates:

| Capability | Runtime result | Selection |
|---|---|---|
| `nemotron-asr` | Correct or near-correct text; result contained only `text` and `model_id` | Selected with deterministic SiteThread windows |
| `whisper-word` with `chunk_level: "segment"` | Async job reached `done` and returned text correctly, but no chunks or timestamps | Not selected |
| `wizper` | Text only despite the upstream timestamp-bearing schema; registry marked it experimental and unregistered | Not selected |

The tested fallback was an 18-second synthetic walkthrough assembled from three phrases. FFmpeg split the source into exact six-second, 16 kHz mono PCM WAV windows of approximately 191–193 KB before upload. Each window was sent synchronously to `nemotron-asr` with `language: "en-US"`:

| Source range | Transcript returned | Tool latency | Estimate |
|---|---|---:|---:|
| `[0, 6)` seconds | `Level two corridor walk through begins now.` | 4.450 s | $0.0007 |
| `[6, 12)` seconds | `A blue safety barrier stands beside the doorway.` | 5.090 s | $0.0007 |
| `[12, 18)` seconds | `Beside supervisor must review this visible condition.` | 4.154 s | $0.0007 |

The third phrase was a minor recognition error for “The site supervisor must review this visible condition.” The test establishes coherent coarse source grounding, not perfect transcription. The window boundary is the evidence time; SiteThread must not invent word timing inside it. Empty windows may be omitted from later reasoning, but the persisted transcript retains every nonempty window's exact `[startSeconds, endSeconds)` and text.

For a 60–120 second walkthrough, six-second windows imply 10–20 ASR calls. At the returned estimate, transcription is approximately $0.007–$0.014 before retries. Calls may run with bounded concurrency, but source ordering must be restored before persistence.

Windows are six seconds except for the final window. If the media duration is not divisible by six, shorten the final window to the exact remaining duration and persist its true half-open range without exceeding the media duration. Send a nonempty final partial window to ASR; an empty or silent result may be omitted from later reasoning under the existing empty-window rule. Do not pad the final window or invent timing. For example, a 62-second walkthrough ends with `[60, 62)`, never `[60, 66)`.

### Visual route decision

The controlled PNG sent to `nemotron-omni` again produced `image_accessible: false`; current discovery did not expose `nemotron-vision`. Frame/image analysis is rejected for COD-17's initial live provider.

The video probe was a six-second, 640 × 360 H.264/AAC clip of 35,676 bytes. A blue rectangle and red circle exchanged left/right positions at three seconds. Three `marlin-video` async jobs, including a fresh-key retry and a clip with an ordinary audio track, reached `failed` through `get_create_media` with “returned no media” even though the jobs declared `output_kind: "text"`. Their session cost report attributed $0.0474 to three failed jobs. This reproduces a text-result/media-wrapper mismatch for Marlin; the async result is not an acceptable COD-17 contract.

The same audio-video input sent with `async: false` succeeded in 177.982 seconds. Its text correctly described both layouts and returned `<0.0 - 3.0>` and `<3.0 - 6.0>` event ranges. The estimated cost was $0.0158. A same-key replay returned the identical result in 0.723 seconds with `idempotency_replay: true`.

COD-17 must therefore use **synchronous `marlin-video` inside Trigger.dev**, with a 260-second provider timeout and a 300-second HTTP deadline. The authoritative success value is the synchronous `structuredContent` where `ok === true`, `output_kind === "text"`, and `result.text` is nonempty. A provider event range is a candidate only when its start and end are finite, `start <= end`, and the entire range is contained within the actual input clip duration. Reject or ignore an out-of-bounds range; never clamp an unsupported provider event into trusted evidence. The full SiteThread-owned source clip range remains the durable evidence fallback whenever event parsing fails or a candidate is rejected.

Do not analyze every source window. For the MVP, partition the walkthrough into 20-second buckets and select at most one six-second clip per bucket, preferring a nonempty transcript window nearest the bucket center and otherwise taking a periodic sample. Clamp each clip to the media duration, deduplicate overlapping selections, and cap one walkthrough at six visual calls. This yields at most three calls for a 60-second walkthrough and six for a 120-second walkthrough. At the observed estimate, visual inference is at most $0.0474–$0.0948; the combined ASR plus visual estimate is approximately $0.0544–$0.1088 before retries, storage, or price changes.

### Jobs, errors, replay, and source access

- HTTP 200 is only transport success. Parse JSON-RPC errors, MCP `isError`, `structuredContent.ok`, and job `status` before reading output.
- The selected ASR and visual calls are synchronous. The successful synchronous payload is authoritative. `get_create_media` remains usable for explicitly async, nonselected capabilities; `status: "failed"` is terminal even on HTTP 200.
- Identical ASR and Marlin requests with the same key replayed the cached result with `idempotency_replay: true`; async replay returned the same job ID. The live tool schema states a 24-hour, per-bearer cache. SiteThread still owns durable `walkthroughId + pipelineVersion` deduplication.
- Retry an uncertain transport outcome with the same idempotency key. Do not retry invalid input, missing media, auth, schema, or unavailable-capability errors unchanged. A terminal cached failure needs a recorded, policy-approved new attempt key; allow at most one fresh attempt for a classified transient provider failure because failed Marlin submissions can still be billed.
- An inaccessible ASR URL returned nested upstream HTTP 502 details, `code: "upstream_error"`, `retryable: false`, and `billing_note: "likely_billed_upstream"`. Treat the explicit retry flag and error class as authoritative over the nested status code.
- MCP `upload` returned `ephemeral: false`, and an unauthenticated HEAD request retrieved the uploaded clip with HTTP 200. Those hosted URLs are public handoff artifacts and are prohibited for private construction media in production.

No R2 credentials were available, so a realistic signed-R2 GET was not runtime-verified. COD-17 may implement the private-media contract by creating a signed GET URL immediately before each dispatch, with at least 15 minutes of validity, never persisting or logging it, and regenerating it for a fresh retry. The URL must refer to the bounded audio window or short clip, not the full walkthrough. A deployment smoke test must prove Livepeer can fetch that URL before live demo readiness; MCP public upload is not an acceptable fallback for construction media.

No owned construction walkthrough was present locally or in the repository. **Construction-domain performance remains unvalidated.** The successful visual result proves a generic synthetic event transition only.

### COD-17 request and normalization contract

After `initialize` and `notifications/initialized`, discover the exact names and fail if either selected capability is unavailable. Do not select by alias or model family. The tested requests, with sensitive values represented as placeholders, are:

```json
{
  "name": "run_capability",
  "arguments": {
    "capability": "nemotron-asr",
    "source_url": "<signed six-second WAV URL>",
    "inputs": {
      "audio_url": "<same URL>",
      "language": "en-US"
    },
    "async": false,
    "timeout": 60,
    "persist": false,
    "session_id": "<run attribution ID>",
    "idempotency_key": "<provider-safe logical window key>"
  }
}
```

```json
{
  "name": "run_capability",
  "arguments": {
    "capability": "marlin-video",
    "prompt": "Describe visible conditions and list time-ranged events. Do not make safety, code-compliance, completion, or approval claims.",
    "inputs": {
      "video_url": "<signed six-second MP4 URL>",
      "do_sample": false,
      "max_tokens": 250
    },
    "async": false,
    "timeout": 260,
    "persist": false,
    "session_id": "<run attribution ID>",
    "idempotency_key": "<provider-safe logical clip key>"
  }
}
```

For both calls, require HTTP success, no JSON-RPC error, no MCP `isError`, `structuredContent.ok === true`, the requested capability name, `output_kind === "text"`, and nonempty `structuredContent.result.text`. Treat every other shape as a provider failure. Parse responses as `unknown`; ignore extra fields after recording safe diagnostic metadata. Never persist `source_url`, `inputs.audio_url`, `inputs.video_url`, or the bearer.

The transcription orchestrator attaches the deterministic source range to the returned text; the provider response is not the source of timing truth. The visual orchestrator attaches `VisualAnalysisInput.sourceStartSeconds` and `sourceEndSeconds` to the whole result. Provider event subranges may be normalized only when their finite start and end satisfy `start <= end` and the full range is contained within the actual input clip duration, then offset by the clip's source start. Reject or ignore out-of-bounds event ranges instead of clamping unsupported claims into trusted evidence.

If a nonselected async capability is ever used, `run_capability` returns `status: "submitted"`, a `job_id`, and `poll_with: "get_create_media"`. Poll with that `job_id`; `submitted` or `running` is nonterminal, `done` requires a valid `run_output`, and `failed` is terminal even on HTTP 200. Persist the provider job ID before polling. COD-17's selected ASR and Marlin calls do not use this path.

Map the selected synchronous lifecycle into existing processing states as follows:

| Livepeer / worker condition | SiteThread processing state |
|---|---|
| Durable processing run created; work not started | `QUEUED` |
| FFmpeg audio windowing or any selected ASR call in progress | `TRANSCRIBING` |
| Clip selection, FFmpeg clip extraction, or any selected Marlin call in progress | `ANALYZING_MEDIA` |
| All required normalized transcripts and visual candidates persisted; observation reasoning is ready | `EXTRACTING_OBSERVATIONS` |
| Run-scoped draft observations and evidence links atomically persisted | `NEEDS_REVIEW` |
| Retryable transport/provider failure while attempts remain | Keep the current stage and increment `retryCount` |
| Nonretryable failure, invalid result, exhausted attempts, or whole-stage deadline | `PROCESSING_FAILED` with `failedStep`, stable error code, safe message, and retry count |

The COD-17 adapter contract is therefore: raw MCP `/api/mcp/raw`; protocol `2024-11-05` initialization as currently accepted; optional transport session support but no assumed session header; issued bearer required in production; six-second WAV windows to synchronous `nemotron-asr`; up to six six-second H.264/AAC clips to synchronous `marlin-video`; SiteThread-owned source ranges; result-text validation; same-key recovery for uncertain delivery; and no public upload or provider substitution.

## COD-14 runtime baseline

This section preserves the earlier COD-14 observations for auditability. Where behavior or decisions differ, the COD-32 runtime section and contract above are current. In particular, COD-32 did not reproduce the Whisper retrieval failure, did reproduce the text-job mismatch on Marlin async, and selected synchronous Marlin instead.

All inference tests used the real Livepeer service with **no Authorization header**, using the keyless demo. No fixtures or mocks were substituted. No project credential was needed or tested.

### Connection and discovery

- `GET /api/mcp` identified `livepeer-agent-raw`, version `1.0.0`, Streamable HTTP.
- JSON-RPC `initialize` accepted protocol `2024-11-05`; the probe then sent `notifications/initialized` and `tools/list`.
- The GET identity advertised 18 tools, but the actual `tools/list` response contained **23**. Use the live list, not the advertised count.
- The tested responses used JSON and did not issue an `Mcp-Session-Id` header. Session expiry/reinitialization and SSE responses were not exercised.
- `list_capabilities` returned **207 capabilities: 173 AI and 34 tools**. Direct `GET https://sdk.daydream.monster/capabilities` also returned 207.
- `describe_capability` supplied identity, availability, model ID, price/SLA metadata, and invocation examples. Several examples were generic and did **not** supply a complete modality-specific input schema.
- `get_pricing` was inspected before inference. Available prices were often tagged `static-registry` or `static_fallback`; they are displayed estimates, not verified settlement prices.

The actual raw tool list was:

```text
list_capabilities, describe_capability, run_capability, get_pricing,
get_cost_report, get_create_media, cancel_job, get_recent_assets,
forget_assets, search_assets, spend_cap, upload_image, upload,
create_upload_url, request_upload, get_upload, demo_register,
request_activation, activate, me, me_usage, signup, signup_confirm
```

Only discovery, description, pricing, upload, execution, job retrieval, and cost reporting were exercised. Tool presence does not prove every tool works.

### Test media and measurement

Only locally generated media was used:

- A 5.319-second, mono, 22,050 Hz, 16-bit PCM WAV with synthetic narration about two colored shapes.
- A 640 × 360 PNG containing a blue square on the left and a red circle on the right.
- A 5.32-second, 640 × 360, 10 fps H.264/AAC MP4 combining that image and narration.

These are capability probes, not construction footage. The vision prompts did not reveal the image's colors or shapes. WAV (234,602 bytes), PNG (2,037 bytes), and MP4 (51,049 bytes) were uploaded using MCP `upload` with base64 bytes and explicit MIME types. Livepeer returned hosted HTTPS media references and `ephemeral: false`. The references, generated files, full responses, and temporary tools are deliberately not committed.

Client timings below measure the individual tool call, excluding MCP initialization. They are single observations, not performance benchmarks.

| Test | Observed result | Latency | Reported cost |
|---|---|---:|---|
| WAV upload | Accepted as audio | 2.580 s | No price returned |
| PNG upload | Accepted as image | 0.655 s | No price returned |
| MP4 upload | Accepted as video | 1.906 s | No price returned |
| `nemotron-asr`, corrected audio request | Correct synthetic transcript; no timestamps | 3.921 s | Estimated $0.0007; 5 second units |
| Identical ASR request and idempotency key | Cached result with `idempotency_replay: true` | 0.671 s | Repeated original estimate; not evidence of a second charge |
| `whisper-word`, segment chunks requested, async | Submission accepted; underlying SDK completed with text only; MCP later reported failure | 3.807 s submission; SDK reported 0.956 s execution | Price and final charge unavailable |
| Identical Whisper request and idempotency key | Same job ID; `idempotency_replay: true` | 0.702 s | No new cost established |
| `gemini-text`, workshop-style image request | Text response said image unavailable | 4.257 s | Estimated $0.0001 |
| `nemotron-omni`, explicit image URL | Text response said image unavailable | 3.675 s | Estimated $0.0105 |
| `marlin-video`, generated MP4 | Correct scene description and static event interval; async polling completed | 3.495 s submission; SDK reported 100.192 s execution; MCP reported 109.795 s elapsed | Estimated $0.0158; final paid amount null |

The direct image requests did not describe the image. Marlin's video response correctly identified the white background, left/right arrangement, flat shapes and static scene, including a 0.0–5.3 second event interval. Narration disclosed the shapes and colors but not the background or arrangement, so this is a limited synthetic-video check rather than a controlled benchmark. It does not validate direct PNG input or construction-scene accuracy.

Displayed rates before execution were $0.00014/second for Nemotron ASR, $0.0000788/1,000 tokens for Gemini text, $0.0105/call for Nemotron Omni, and $0.01575/1,000 tokens for Marlin. Whisper's rate was null. Its one small request used the keyless demo, with the unknown price recorded explicitly. Displayed prices and rounded per-call estimates must not be treated as settled charges.

### Exact capability contracts observed

| Requirement / candidate | Discovered model ID | Inputs tested | Result and decision |
|---|---|---|---|
| Transcription: `nemotron-asr` | `nvidia/nemotron-asr-multilingual/asr` | `source_url` plus `inputs.audio_url`, `language: "en-US"` | `structuredContent.result` contained `text` and `model_id`. No segments, words, speakers, or language metadata. Verified transcription, insufficient for SiteThread's timing requirement. |
| Timestamp candidate: `whisper-word` | `fal-ai/whisper` | `inputs.audio_url`, `task: "transcribe"`, `language: "en"`, `chunk_level: "segment"`, `diarize: false` | Underlying SDK `result.data` contained only `text` and `model_id`. No chunks or timestamps despite the request. Not selected as a validated timestamp provider. |
| Image candidate: `gemini-text` | `fal-ai/any-llm` | Prompt and `source_url`; `max_tokens: 200`, `temperature: 0` | Returned a Markdown-fenced JSON string reporting unavailable image access. The workshop's request pattern did not establish vision in this test. |
| Image candidate: `nemotron-omni` | `nvidia/nemotron-3-nano-omni` | Prompt, `source_url`, `inputs.image_url`, `reasoning_mode: "no_think"`, `max_tokens: 200`, `temperature: 0` | Returned a JSON string reporting unavailable image access. The registered base model must not be assumed to use the separate upstream vision route. |
| Video candidate: `marlin-video` | `fal-ai/marlin` | `inputs.video_url`, documented spatial/event prompt, `max_tokens: 200`, `do_sample: false` | `get_create_media` returned `status: "done"` and `run_output.result: { text, model_id }`. Text contained scene prose and time-ranged events. Verified video-understanding candidate; direct image/frame contract remains unselected. |

COD-18 uses the discovered `gemini-text` capability only as a text reasoning step after media candidates are persisted. The current registry describes it as available text output through `run_capability` with model ID `fal-ai/any-llm`; the reasoner sends normalized transcript and visual-candidate descriptions labeled with SiteThread-owned references and no media URLs. The earlier image request that reported unavailable image access remains evidence that `gemini-text` is not a selected visual route.

The synchronous ASR/Gemini/Omni probes used `async: false` and `timeout: 60`. Whisper used `async: true` and `timeout: 120`; Marlin used `async: true` and `timeout: 260`. All used `persist: false`, an application `session_id`, and a unique `idempotency_key` per logical request. The temporary client had a separate 90-second HTTP deadline, which was not reached; asynchronous inference continued independently of its submission request.

Neither `openai:audio-transcriptions` nor `florence-2` was present in the inspected Agent registry. This does not prove their absence from every Livepeer deployment; it rejects treating older ecosystem reports as verified access through this endpoint.

### Asynchronous jobs and idempotency

`run_capability` with `async: true` returned `status: "submitted"`, `job_id`, `poll_with: "get_create_media"`, ETA fields, and cost estimates where available. Submission is not completion.

For the Whisper test:

1. Replaying the exact request with the same `idempotency_key` returned the original job ID.
2. `get_create_media({job_id})` eventually returned `status: "failed"`, `run_output: null`, and an error saying the render returned no media.
3. That response also exposed an `sdk_job_id`. A read of the corresponding `GET /inference/jobs/{job_id}` returned `status: "done"`, a successful text result, and execution timing.
4. The SDK result still lacked timestamp chunks. Reading it directly did not satisfy the transcription contract.

This is an observed status/result mismatch for a text capability, not proof all asynchronous jobs fail. Its exact cause is unresolved. Do not equate a missing media URL with failure for text/JSON output, and do not automatically resubmit a job merely because the MCP wrapper reports no media.

Marlin provided the successful control: polling moved from `running` to `done`, with `url: null` and the text payload in `run_output.result`. Its SDK job was also `done`. The upstream schema describes structured `scene` and `events` fields, but the observed Livepeer result exposed prose in `text`; any event parser would need separate validation. Those visual event ranges are not speech-transcript timestamps.

The same-job replay returned its cached original `submitted` envelope even after failure was visible through polling. Always poll after an async replay; the replay envelope is not current job status.

### Errors and cost limitations

Two schema mistakes produced HTTP 200 MCP responses with `ok: false`, `code: "param_reject"`, `retryable: false`, and `billing_note: "likely_billed_upstream"`:

- ASR `language: "en"` was rejected; the corrected `"en-US"` request succeeded.
- Omni `reasoning_mode: "off"` was rejected; the corrected `"no_think"` request succeeded as text execution.

Both contained nested SDK/runner HTTP 502 errors. Therefore a nested 502 does not by itself justify retrying identical inputs. Corrected payloads used new logical idempotency keys. No identical malformed request was retried.

For the initial ASR, Gemini, and Whisper session, `get_cost_report` returned zero ledger total, one missing-cost record, and a failed job despite the successful calls' nonzero estimates. **Zero in this report does not establish free execution.** After Marlin, the report returned $0.0158 from job records, one missing-cost record, and zero ledger total; it still did not reconcile all synchronous estimates. Marlin's job marked cost disposition as spent, but `cost_paid_usd` was null. The successful-call estimates sum to $0.0271, excluding replays, unpriced Whisper and possible charges for rejected inputs. This is not a verified total charge. Actual settlement and complete demo-budget accounting remain unresolved.

No rate limit, exhausted-credit condition, cancelled inference, network timeout recovery, or production bearer rejection was deliberately induced.

## Verified from current documentation and schemas

These are documented contracts or upstream schemas, not additional successful SiteThread tests.

### COD-32 primary-source refresh (documentation only, 2026-09-18)

This subsection records what current first-party pages, public endpoint schemas, and upstream model-owner schemas say. It involved no inference calls and does **not** replace the live COD-32 probes. A documented field is a candidate contract until the selected raw-MCP route returns it in a controlled test.

#### Raw MCP surface, protocol, and authentication

- Livepeer now publishes a path-pinned raw endpoint at `https://agent.livepeer.org/api/mcp/raw`. Its read-only identity describes a deterministic `raw` Streamable HTTP surface with no planner or model substitution. The official [MCP onboarding skill][agent-mcp-skill] likewise describes `run_capability` for exact dispatch and `get_create_media` / `cancel_job` for job control. Prefer the named path when freezing the COD-17 configuration; Livepeer's own onboarding material warns that the bare `/api/mcp` profile can change. At this review, the [named raw identity][raw-mcp-identity] and [bare endpoint identity][mcp-root-identity] both reported `raw`, while the [Get Started page][get-started] still configured the bare path. This documentation drift makes runtime initialization and `tools/list` authoritative. Do not pin a documented tool count.
- The public endpoint identity says `streamable-http`, but it does not declare a negotiated MCP protocol revision or session policy. MCP session behavior is revision-dependent: the 2025-era lifecycle begins with `initialize`, and a client must return a server-issued `Mcp-Session-Id`; the final 2026-07-28 revision removed both the handshake and protocol-level session header. COD-17 must implement the lifecycle actually accepted by Livepeer during COD-32 rather than assuming either behavior from the transport name. [MCP 2025 lifecycle][mcp-2025-lifecycle] · [MCP 2025 transport][mcp-2025-transport] · [MCP 2026 session change][mcp-2026-session-change]
- Livepeer's current setup page documents `Authorization: Bearer <key>` for account access and conditional keyless demo access when the server enables it. This supports retaining the server-only `LIVEPEER_MCP_BEARER` setting, but it is not evidence that a SiteThread production credential, account limits, or OAuth flow have been validated. The page's keyless credit wording is operational guidance, not a production authorization guarantee.

#### Media handoff and private-source implications

- Livepeer's [upload handoff][agent-upload-handoff] accepts image, video, or audio and advertises a public URL for files up to 50 MB. The first-party [Storyboard introduction][agent-storyboard-intro] says URL-based upload requires a publicly accessible HTTPS URL, describes inline image base64 as suitable only below roughly 1 MB, and says auth-walled private object URLs do not work. The public SDK OpenAPI separately defines `POST /upload` as base64 input returning a publicly accessible URL. These are Livepeer-hosted handoff contracts; they do not define SiteThread's durable evidence storage.
- None of those sources promises when an asynchronous capability fetches its input, how many times it may refetch, or what signed-URL lifetime is sufficient. A valid R2 presigned URL may be anonymously fetchable while unexpired, but its suitability and minimum expiry remain a live-validation question. COD-16/COD-17 must not persist a temporary signed URL or a Livepeer handoff URL as the durable evidence reference.
- The SDK OpenAPI's direct `InferenceRequest` has optional base64 `image_data`, a generic `params` object, and no corresponding generic audio/video byte field. This is the direct SDK service contract, not proof of the raw-MCP media envelope. The selected MCP capability still needs a tested `source_url` or uploaded-media mapping.

#### Job retrieval and idempotency documentation

- The [SDK OpenAPI][sdk-openapi] documents `POST /inference/submit` returning `job_id`, `status`, `capability`, and `poll_url`. `GET /inference/jobs/{job_id}` returns `status`, optional `result`, `error`, and `error_status`; it explicitly says a failed job is HTTP 200 with `status: "failed"`, while an unknown job ID is 404. This supports status-first parsing, but the raw-MCP `get_create_media` wrapper and its authoritative ID/result fields still require runtime confirmation.
- Neither the public Agent onboarding pages nor the inspected SDK OpenAPI define an idempotency field, cache duration, cross-request scope, or exactly-once billing guarantee. Any raw-MCP idempotency rule used by COD-17 must come from the current live tool schema plus a replay probe. The COD-14 24-hour/per-bearer observation should not be promoted to a current guarantee without that revalidation.

#### Transcription candidates and timing fields

| Source contract | Documented input/output | What it establishes for SiteThread |
|---|---|---|
| Livepeer native [audio-to-text pipeline][livepeer-audio-to-text] and pinned [AI Runner OpenAPI][ai-runner-openapi] | Multipart audio; `return_timestamps` supports sentence, word, or false; response text plus chunks whose `timestamp` is an array | Livepeer's broader AI stack has a timestamp-bearing ASR contract. It does not establish that the Agent registry exposes this pipeline or preserves this response through raw MCP. |
| Upstream [Wizper schema][wizper-schema] | `audio_url`; segment chunks by default; output `text`, required `chunks`, and per-chunk start/end timestamp | `wizper` is a strong current timestamp candidate if raw MCP exposes the exact upstream result. Runtime must prove the chunks survive normalization. |
| Upstream [Whisper schema][whisper-schema] | `audio_url`, `chunk_level` of none/segment/word; output text and timestamp chunks | Confirms the model-owner contract, but COD-14 already showed that the Livepeer wrapper can omit these fields. Documentation alone does not clear the gate. |
| Upstream [Nemotron ASR schema][asr-schema] | `audio_url`, language and acceleration; output transcription text and optional partial flag | No segment or word timestamps are documented, so it cannot satisfy source timing by itself. Deterministic SiteThread time-window segmentation remains a possible fallback to validate live. |

The public capability registry is discovery metadata, not an invocation schema: its declared item requires only `name` and permits extra fields such as `model_id`, capacity, and source. Therefore a registry match is insufficient for parser design. COD-32 must record the selected capability's actual raw-MCP request and returned result shape.

#### Image and video candidates

- Livepeer's separate [image-to-text API][livepeer-image-to-text] accepts a multipart image plus prompt and returns text. That proves a Livepeer AI gateway pipeline exists, but the current Agent documentation does not map it to a raw-MCP capability. It is not permission to switch COD-17 to the direct gateway silently.
- The upstream Nemotron Omni [vision route][omni-vision] is a distinct endpoint ending in `/vision`; it requires `image_url` and returns `output`, `finish_reason`, and usage. The registered base model name and text route do not imply this vision contract. A raw-MCP frame choice is valid only if current discovery exposes the vision route and a controlled image test proves that the image reaches it.
- The upstream [Marlin schema][marlin-schema] accepts `video_url` for clips of approximately two minutes and documents `scene`, `events`, and full `text`; each event has numeric start/end seconds. These event times can map a short clip result back to the walkthrough by adding the clip's deterministic source offset. They are visual event ranges, not speech timestamps, and raw MCP must prove whether it preserves the structured fields or only prose.

**Documentation-only conclusion:** primary sources support live testing of `wizper` and `whisper-word` for timestamped transcription, the exact Nemotron vision route for frames if it is actually registered, and `marlin-video` for source-offset short clips. They do not choose a winner, establish signed-R2 expiry, validate production bearer access, or prove construction-domain quality. Those decisions must be based on COD-32 runtime evidence.

### MCP setup, profiles, authentication, and limits

The current [Get Started page][get-started] recommends a lean tool profile and advertises approximately $10 of keyless demo credit per network address over seven days, conditional on server-side demo configuration. It also describes full access with a Daydream bearer key. The demo was operational in our tests; its remaining balance and exact reset behavior were not established.

The page's 9-tool lean / approximately 99-tool full description differs from the live dedicated raw surface. Its printed profile header contains a space in the header name (`X-Livepeer Agent-Tool-Profile`), so it cannot be copied literally as a standards-compliant HTTP header. The tested client used the dedicated raw endpoint without that header. Confirm any current profile override spelling with Livepeer rather than inventing it.

The live identity also advertises `/api/mcp/creative` and `/api/mcp/full`. SiteThread needs exact dispatch, so it should use raw rather than the creative planner. These sibling surfaces were not tested. The identity's `/docs/mcp` link returned 404.

The discovered tool schemas state:

- `run_capability.inputs` carries capability-specific fields; `timeout` is in seconds.
- Slow jobs can default to async, based on latency metadata; callers can set `async` explicitly.
- Idempotency keys are scoped per bearer, cached for 24 hours, and match `[A-Za-z0-9_-]{1,128}`. Same-session sync/async replay was observed; cross-account isolation, concurrent duplication, and expiry were not tested.
- `session_id` is an application cost-attribution tag, distinct from transport `Mcp-Session-Id`.
- `upload` warns of inline transport limits around 3 MB. `create_upload_url` advertises signed PUT uploads up to 50 MB. Large upload paths were not tested.
- `persist: true` can add a storage copy/cost. All inference tests used `persist: false`; upload hosting is a separate operation.
- `cancel_job` does not guarantee cancellation or refund of work already executing upstream.

For future server/worker configuration, use:

```text
LIVEPEER_MCP_URL=https://agent.livepeer.org/api/mcp/raw
LIVEPEER_MCP_BEARER=<secret supplied through the runtime environment>
MEDIA_PROVIDER_MODE=live
```

These are proposed SiteThread environment names, matching the workshop's endpoint/bearer convention. The probe omitted the bearer entirely. Use `Authorization: Bearer <key>` for authenticated HTTP requests; never expose it through `NEXT_PUBLIC_*`. Keep fixture mode explicitly separate, with no automatic switch after a live failure. Production credentials and their account-specific limits must be validated before the demo deployment.

### Direct HTTP contract

The current public [SDK OpenAPI][sdk-openapi] declares:

```text
GET  /capabilities
POST /inference
POST /inference/submit
GET  /inference/jobs/{job_id}
POST /llm/chat

InferenceRequest:
  capability: string              required
  prompt: string                  default ""
  image_data?: string             base64 JPEG/PNG
  params?: object                 extra payload parameters
  timeout: integer                seconds; default 300
  orchestrator?: string           guarded override; not needed by SiteThread

InferenceResponse:
  status, capability, image_url?, video_url?, audio_url?,
  data, balance?, orchestrator?, elapsed_ms
```

This replaces the earlier assumed `{capability, input}` / `{output}` envelope. The SDK documents async submission and polling; a failed job can return HTTP 200 with a failed status. The registry documents a 60-second cache. Discovery, schema retrieval, and retrieval of our existing job were runtime-verified; direct submission was not.

The inspected inference schema has no explicit idempotency field or security declaration. Neither absence proves missing authentication or safe retry behavior at runtime. The `/llm/chat` description mentions OpenAI-compatible messages and Gemini routing, but image support, pricing, and execution through that route remain untested.

A currently installable official Agent SDK package/version was not established. The historical `livepeer/storyboard` GitHub API lookup and `@livepeer/agent` npm metadata lookup returned 404. Do not make the production decision depend on cached historical SDK examples.

### Upstream model schemas

Livepeer's discovered model IDs point to these upstream contracts. They explain candidate behavior but are **not authorization to bypass Livepeer**:

- [Nemotron ASR][asr-schema] documents `audio_url`, language and acceleration options, and text output. It does not document segment timestamps.
- [Whisper][whisper-schema] documents segment/word chunks, optional diarization, and language information. Timestamp entries can be null in its [OpenAPI][whisper-openapi]. None of those timing fields survived in the tested Livepeer result; do not claim the upstream schema is the Livepeer response.
- [Nemotron Omni base][omni-base] is a text-input route. Its separate [vision route][omni-vision] requires `image_url`; Livepeer's discovered model ID did not include that route.
- [Any LLM][gemini-schema] documents text inputs and labels its upstream endpoint deprecated. Livepeer's `gemini-text` still executed text successfully, so that label alone does not establish Livepeer availability or vision support.
- [Marlin][marlin-schema] documents a `video_url`, approximately two-minute input support, and spatial/event output. These upstream limits are not a verified Livepeer service guarantee.

### Workshop findings

Reference inspected at commit `406c845aedac53ab1df4e9bdb3fe644006e31bdb`:

- Its [server adapter][workshop-adapter] initializes MCP, optionally sends a bearer, retains a transport session header, and invokes `run_capability` from application code. No local model execution is required.
- It supplies deterministic keys per logical stage, application session tags, explicit timeout/async settings, and `persist: false`.
- Async video polls `get_create_media` every five seconds. Its wall-clock deadline does not bound an individual fetch because the reference omits an AbortSignal.
- It does not implement capability discovery, an initialized notification, SSE decoding, or session recovery. Do not copy it as a complete transport.
- The [judge][workshop-judge] passes a media URL as `source_url` to `gemini-text`. This demonstrates intended use, not verified image perception; our controlled test did not pass.
- Real/mock selection is explicit in its adapter factory and [environment example][workshop-env]. SiteThread must retain that distinction. OriginTrail DKG is unrelated to this Track 1 spike.

## Runtime comparison for SiteThread

| Concern | Raw MCP | Direct Livepeer HTTP |
|---|---|---|
| Background execution | COD-14 historically verified async video submission/polling; COD-32 selected synchronous `nemotron-asr` and synchronous `marlin-video` because current Marlin async retrieval failed | Documented HTTP contract; direct submission not tested |
| Trigger.dev fit | Ordinary Node HTTP/MCP client inside durable jobs; compatibility inferred, not deployed | Ordinary Node HTTP client; compatibility inferred, not deployed |
| Async jobs | Whisper text retrieval passed in COD-32; Marlin text retrieval failed three current probes and is not selected | Submit/poll documented; direct submission remains untested |
| Retries | Structured error fields observed; input rejects must not be retried unchanged | Status/error envelope documented; production failure classification untested |
| Idempotency | Sync cached result and same async job observed; 24h/per-bearer scope documented | No explicit field in inspected request schema; equivalent guarantee unverified |
| Structured results | MCP wrapper plus capability payload; HTTP success can contain tool/job failure | Untyped `data`; known text result also lacked timestamp chunks |
| Authentication | Keyless demo inference verified; bearer documented, untested | Public discovery/job read verified; inference auth untested |
| Discovery | Registry, describe cards, pricing and SLA tools verified | Registry verified; narrower metadata, not a complete model schema |
| Observability | Job IDs, estimated cost, session tags; incomplete cost receipt observed | SDK job/result and elapsed time visible; accounting unverified |
| Stability | Current dedicated raw endpoint; setup-page drift and wrapper defect found | Current OpenAPI; historical request envelope differs |
| Complexity | MCP framing and normalization, with useful discovery/idempotency built in | Simpler HTTP framing, but more policy and retry behavior to establish |

Select raw MCP behind the existing provider boundary with the COD-32 windowed-ASR and synchronous-short-clip constraints. There is no evidence that a wholesale move to direct HTTP alone restores timestamps or image perception. Revisit the transport choice if Livepeer exposes a stable native timestamp result or a reliable direct frame route.

## SiteThread contract and responsibility boundary

The internal contract remains:

```ts
interface MediaIntelligenceProvider {
  discoverCapabilities(): Promise<MediaCapabilities>;
  transcribe(input: TranscriptionInput): Promise<Transcript>;
  analyzeVisual(input: VisualAnalysisInput): Promise<VisionResult>;
}
```

Resolve semantic requirements `TRANSCRIPTION` and `VISION` from the live registry plus **validated input/output contracts**. Availability and an appealing model name are insufficient. Cache a bounded discovery snapshot, record the selected capability/model and schema version per run, and refresh on missing-capability failures. Do not fuzzy-match or silently substitute a core provider.

At the boundary, parse provider output as `unknown` with Zod. Check JSON-RPC errors, tool `isError`, `ok`, job status, and the actual result payload. A successful transcript must have finite, nonnegative, ordered source timestamps and nonempty segment text. Never fabricate segment timing from audio duration or narration guesses. Preserve unknown/missing times as a failed requirement.

Vision text may contain Markdown fences or malformed JSON. Validate any extracted structured content rather than accepting it as trusted project information. An "image unavailable" answer fails visual analysis even when the transport says `ok: true`. Only observed image content should become evidence-style descriptions; engineering acceptance and compliance remain human decisions.

| Owner | Responsibility |
|---|---|
| SiteThread / R2 | Private source media, short-lived processor access, evidence identity and review states |
| FFmpeg | Metadata probing, audio extraction, deterministic frame extraction, thumbnails and evidence clips |
| Livepeer | Text inference for bounded audio windows and short video clips under the selected COD-32 contracts |
| Trigger.dev | Durable orchestration, bounded polling, retry policy and job history |
| SiteThread normalization/reasoning | Validate results, join narration with visual evidence, prepare draft observations |

The generated probe uploads were publicly readable hosted media, **not a validation of private R2 signed URLs**. Keep construction media private by default. COD-17 must use dispatch-time signed GET URLs for bounded derivatives and must never persist or log them. The live deployment still needs the signed-R2 smoke test described above.

The minimum intended golden path remains:

```text
Private walkthrough upload
→ probe / extract audio as needed
→ FFmpeg six-second audio windows
→ Livepeer transcript text mapped to each exact source window
→ narration-prioritized periodic clip selection, deduplicated
→ FFmpeg six-second evidence clips
→ synchronous Livepeer descriptive visual evidence
→ validated evidence candidates and draft observations
→ Confirm / Edit / Dismiss
→ report containing only confirmed or edited findings
```

Remote FFmpeg/tool capabilities exist, but local deterministic preprocessing remains appropriate. A remotely advertised finishing tool is not a reason to move simple extraction out of SiteThread.

Use a durable `walkthroughId + pipelineVersion` key for application idempotency. Derive a provider-safe stage key (for example, a hash including source identity, stage, selected model and relevant input version); colons are not accepted by the observed provider key regex. Reuse the key for the same logical operation, persist returned job IDs, and poll after uncertain delivery. A provider's 24-hour cache cannot replace durable application deduplication.

Keep request deadlines and whole-job deadlines separate. Size inference timeouts from verified capability latency and input duration, not a universal short timeout. Network/429/capacity failures may merit bounded backoff; auth/schema/missing-capability errors need correction. A timed-out client does not establish cancellation or refund.

## Rejected assumptions

- MCP is inherently unsuitable for deterministic production background work.
- A project API key is required for every live validation request.
- Every Livepeer ecosystem capability is exposed through the Agent registry.
- A discovered "multimodal" name proves image inputs reach the model.
- Upstream Whisper timestamp support proves the Livepeer response contains timestamps.
- A missing media URL proves a text job failed.
- Every async media-job wrapper can retrieve a text result correctly.
- HTTP 200 proves tool success, or a nested 502 proves a retryable outage.
- A zero/incomplete cost report proves the calls were free.
- The old direct SDK request envelope and package availability are settled facts.

## Residual gates before live demo or production readiness

These items do not require COD-17 to guess an implementation shape, but they must pass before enabling the live provider for the demo or production:

1. **Issued production bearer:** provision the intended Livepeer credential and verify its `me`/usage identity, available credit, and account limits. Keyless demo and an arbitrary opaque bearer do not establish account ownership or production authorization.
2. **Signed private input:** prove Livepeer can fetch a newly issued R2 signed GET URL for a bounded audio window and H.264/AAC clip with the selected synchronous calls. Verify expiry and retry regeneration. Never fall back to the public MCP upload for construction media.
3. **Representative construction media:** run an owned/consented 60–120 second walkthrough with aligned narration and visible conditions. Measure transcript usefulness, visual grounding, processing latency, and false or unsupported findings. Construction-domain performance remains unvalidated.
4. **Operational envelope:** reconcile actual account charges, rate/concurrency limits, retention, and the six-clip maximum. The current per-call prices are estimates, and three failed async Marlin jobs were still attributed $0.0474.
5. **Marlin async repair, optional:** do not use Marlin async polling in COD-17. A future switch requires a controlled text-result probe to pass; the synchronous route remains the frozen MVP contract until then.

**COD-17 is implementation-safe.** The provider implementation must fail clearly if the exact capabilities are unavailable, keep fixture mode explicit, and expose production readiness as failed until gates 1–4 pass. It must not introduce direct HTTP fallback, frame inference, public media upload, or another provider silently.

Only durable findings and the minimal implementation contract belong in this change. Validation for this spike consists of real provider probes, primary-source checks, repository checks, and complete diff/secret-scope inspection.

## Sources

[get-started]: https://agent.livepeer.org/get-started.html
[raw-mcp-identity]: https://agent.livepeer.org/api/mcp/raw
[mcp-root-identity]: https://agent.livepeer.org/api/mcp
[agent-mcp-skill]: https://agent.livepeer.org/skills/get-started-mcp.md
[agent-storyboard-intro]: https://agent.livepeer.org/skills/storyboard-intro.md
[agent-upload-handoff]: https://agent.livepeer.org/upload-handoff
[mcp-2025-lifecycle]: https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle
[mcp-2025-transport]: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
[mcp-2026-session-change]: https://blog.modelcontextprotocol.io/posts/2026-07-28/
[sdk-openapi]: https://sdk.daydream.monster/openapi.json
[ai-runner-openapi]: https://github.com/livepeer/ai-runner/blob/8c46d0185148e1e830fe6d4fcd2a48516c28358c/gateway.openapi.yaml
[livepeer-audio-to-text]: https://docs.livepeer.org/ai/pipelines/audio-to-text
[livepeer-image-to-text]: https://docs.livepeer.org/ai/api-reference/image-to-text
[workshop-adapter]: https://github.com/its-DeFine/livepeer-dkg-iteration-lab/blob/406c845aedac53ab1df4e9bdb3fe644006e31bdb/server/adapters/livepeer.ts
[workshop-judge]: https://github.com/its-DeFine/livepeer-dkg-iteration-lab/blob/406c845aedac53ab1df4e9bdb3fe644006e31bdb/server/adapters/judge.ts
[workshop-env]: https://github.com/its-DeFine/livepeer-dkg-iteration-lab/blob/406c845aedac53ab1df4e9bdb3fe644006e31bdb/.env.example
[asr-schema]: https://fal.ai/models/nvidia/nemotron-asr-multilingual/asr/api
[wizper-schema]: https://fal.ai/models/fal-ai/wizper/api
[whisper-schema]: https://fal.ai/models/fal-ai/whisper/api
[whisper-openapi]: https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/whisper
[omni-base]: https://fal.ai/models/nvidia/nemotron-3-nano-omni/api
[omni-vision]: https://fal.ai/models/nvidia/nemotron-3-nano-omni/vision/api
[gemini-schema]: https://fal.ai/models/fal-ai/any-llm/api
[marlin-schema]: https://fal.ai/models/fal-ai/marlin/api

Runtime evidence came from the live [path-pinned raw MCP endpoint](https://agent.livepeer.org/api/mcp/raw), [capability registry](https://sdk.daydream.monster/capabilities), and our own job results. These surfaces are dynamic; the observations above are dated snapshots, not a promise of future availability. Temporary full responses remain outside version control.
