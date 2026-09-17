# SiteThread — Livepeer integration validation (COD-14)

> **Track:** Livepeer Agent Builder, Track 1
>
> **Validation date:** 2026-09-17 UTC
>
> **Status:** Real transcription and video understanding verified; transcript timestamps and direct image/frame understanding remain unresolved.
>
> **Scope:** Integration decision and validation findings. No COD-17 pipeline implementation.

## Final integration decision

Use **Livepeer raw MCP over Streamable HTTP**, at `https://agent.livepeer.org/api/mcp`, behind the SiteThread-owned `MediaIntelligenceProvider` in future Trigger.dev workers. Keep capability discovery, transport, authentication, result validation, and error classification inside `src/lib/livepeer/`.

This selects the runtime direction; it does **not** declare the required media contracts ready. Raw MCP successfully executed real transcription and video understanding, accepted media uploads, exposed current capability/pricing metadata, and replayed idempotency keys. One text job showed a polling defect; another completed correctly. Timestamped transcription and direct image/frame understanding have not passed the tests below. Resolve these gates before implementing COD-17's provider-specific golden path.

Direct Livepeer HTTP is a real alternative: its public registry, OpenAPI, and the underlying result of our MCP-submitted job were reachable. It remains useful for diagnosis and reconsideration if MCP cannot preserve the required results. Direct inference submission, authenticated production behavior, and equivalent idempotency were not validated. Do not silently add an SDK fallback or call unrelated model vendors.

The earlier blanket rejection of MCP as a production runtime was unsupported. MCP can be called deterministically from application code; it does not require a human chat session. The workshop demonstrates this application pattern. Trigger.dev still owns the durable workflow. [Get Started][get-started] · [Workshop adapter][workshop-adapter]

## Verified at runtime

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
LIVEPEER_MCP_URL=https://agent.livepeer.org/api/mcp
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
| Background execution | Real sync transcription and async video analysis verified; callable by a worker | Documented HTTP contract; direct submission not tested |
| Trigger.dev fit | Ordinary Node HTTP/MCP client inside durable jobs; compatibility inferred, not deployed | Ordinary Node HTTP client; compatibility inferred, not deployed |
| Async jobs | Marlin completed with text payload; Whisper had a status defect; replay verified | Submit/poll documented; both existing underlying jobs retrieved successfully |
| Retries | Structured error fields observed; input rejects must not be retried unchanged | Status/error envelope documented; production failure classification untested |
| Idempotency | Sync cached result and same async job observed; 24h/per-bearer scope documented | No explicit field in inspected request schema; equivalent guarantee unverified |
| Structured results | MCP wrapper plus capability payload; HTTP success can contain tool/job failure | Untyped `data`; known text result also lacked timestamp chunks |
| Authentication | Keyless demo inference verified; bearer documented, untested | Public discovery/job read verified; inference auth untested |
| Discovery | Registry, describe cards, pricing and SLA tools verified | Registry verified; narrower metadata, not a complete model schema |
| Observability | Job IDs, estimated cost, session tags; incomplete cost receipt observed | SDK job/result and elapsed time visible; accounting unverified |
| Stability | Current dedicated raw endpoint; setup-page drift and wrapper defect found | Current OpenAPI; historical request envelope differs |
| Complexity | MCP framing and normalization, with useful discovery/idempotency built in | Simpler HTTP framing, but more policy and retry behavior to establish |

Select raw MCP behind the existing provider boundary, conditional on resolving the media/output blockers. There is no evidence that a wholesale move to direct HTTP alone restores timestamps or image perception. Revisit the transport choice if Livepeer confirms a direct path that preserves the required data.

## SiteThread contract and responsibility boundary

The internal contract remains:

```ts
interface MediaIntelligenceProvider {
  discoverCapabilities(): Promise<MediaCapabilities>;
  transcribe(input: TranscriptionInput): Promise<Transcript>;
  analyzeImage(input: VisionInput): Promise<VisionResult>;
}
```

Resolve semantic requirements `TRANSCRIPTION` and `VISION` from the live registry plus **validated input/output contracts**. Availability and an appealing model name are insufficient. Cache a bounded discovery snapshot, record the selected capability/model and schema version per run, and refresh on missing-capability failures. Do not fuzzy-match or silently substitute a core provider.

At the boundary, parse provider output as `unknown` with Zod. Check JSON-RPC errors, tool `isError`, `ok`, job status, and the actual result payload. A successful transcript must have finite, nonnegative, ordered source timestamps and nonempty segment text. Never fabricate segment timing from audio duration or narration guesses. Preserve unknown/missing times as a failed requirement.

Vision text may contain Markdown fences or malformed JSON. Validate any extracted structured content rather than accepting it as trusted project information. An "image unavailable" answer fails visual analysis even when the transport says `ok: true`. Only observed image content should become evidence-style descriptions; engineering acceptance and compliance remain human decisions.

| Owner | Responsibility |
|---|---|
| SiteThread / R2 | Private source media, short-lived processor access, evidence identity and review states |
| FFmpeg | Metadata probing, audio extraction, deterministic frame extraction, thumbnails and evidence clips |
| Livepeer | Verified speech/visual inference once required capability contracts pass |
| Trigger.dev | Durable orchestration, bounded polling, retry policy and job history |
| SiteThread normalization/reasoning | Validate results, join narration with visual evidence, prepare draft observations |

The small demo uploads were hosted media, **not a validation of private R2 signed URLs**. Keep construction media private by default. Before using signed URLs, verify server fetch behavior, expiry across queue/retry windows, retention, and result access controls. Do not log secret-bearing media URLs.

The minimum intended golden path remains:

```text
Private walkthrough upload
→ probe / extract audio as needed
→ Livepeer transcript WITH source timestamps
→ narration timestamps + periodic samples, deduplicated
→ FFmpeg frames
→ Livepeer descriptive visual evidence
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
- HTTP 200 proves tool success, or a nested 502 proves a retryable outage.
- A zero/incomplete cost report proves the calls were free.
- The old direct SDK request envelope and package availability are settled facts.

## Not yet verified / gates before COD-17

1. **Timestamped transcription:** obtain a supported Livepeer path that returns real segment start/end times. Ask Livepeer whether the runner/SDK can preserve Whisper chunks or expose another supported timed-transcription capability. Word times, diarization and language metadata remain optional and unverified.
2. **Visual understanding:** Marlin passed the small video test; obtain a supported image/frame route and pass a controlled image test. If Livepeer recommends short clips instead, explicitly review that interface/sampling change and its measured latency before choosing it for COD-17. Do not silently convert every frame into a video inference call.
3. **Text-job retrieval:** confirm the supported polling contract or a fix for MCP reporting a completed text job as failed. Do not build a permanent workaround around an undocumented assumption.
4. **Operational access and costs:** validate the intended deployment's bearer credential, credits, price for timestamped transcription, cost reconciliation, retention and rate/media limits. Demo execution is not production access validation.
5. **Representative media:** run an owned/consented construction walkthrough with aligned narration and frames, including signed R2 access. Measure accuracy, latency and total cost; no construction-media success is claimed here.
6. **Implementation contract:** select exact successful transcription and image mappings before freezing provider parsers. Complete COD-14 review/merge before proceeding with COD-17.

**Validation status:** capability-level execution was verified for discovery, media upload, text transcription, video understanding and idempotency. Required timestamped transcription and direct image/frame understanding remain unresolved. SiteThread-specific construction-media validation is pending.

Only durable findings and the minimal architecture clarification belong in this change. The repository currently contains no application package or test runner, so lint/typecheck/Vitest/Prisma/build commands cannot be run. Validation for this documentation spike consists of real provider probes, source checks, and complete diff/secret-scope inspection.

## Sources

[get-started]: https://agent.livepeer.org/get-started.html
[sdk-openapi]: https://sdk.daydream.monster/openapi.json
[workshop-adapter]: https://github.com/its-DeFine/livepeer-dkg-iteration-lab/blob/406c845aedac53ab1df4e9bdb3fe644006e31bdb/server/adapters/livepeer.ts
[workshop-judge]: https://github.com/its-DeFine/livepeer-dkg-iteration-lab/blob/406c845aedac53ab1df4e9bdb3fe644006e31bdb/server/adapters/judge.ts
[workshop-env]: https://github.com/its-DeFine/livepeer-dkg-iteration-lab/blob/406c845aedac53ab1df4e9bdb3fe644006e31bdb/.env.example
[asr-schema]: https://fal.ai/models/nvidia/nemotron-asr-multilingual/asr/api
[whisper-schema]: https://fal.ai/models/fal-ai/whisper/api
[whisper-openapi]: https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/whisper
[omni-base]: https://fal.ai/models/nvidia/nemotron-3-nano-omni/api
[omni-vision]: https://fal.ai/models/nvidia/nemotron-3-nano-omni/vision/api
[gemini-schema]: https://fal.ai/models/fal-ai/any-llm/api
[marlin-schema]: https://fal.ai/models/fal-ai/marlin/api

Runtime evidence came from the live [raw MCP endpoint](https://agent.livepeer.org/api/mcp), [capability registry](https://sdk.daydream.monster/capabilities), and our own job's SDK retrieval. These surfaces are dynamic; the observations above are dated snapshots, not a promise of future availability. Temporary full responses remain outside version control.
