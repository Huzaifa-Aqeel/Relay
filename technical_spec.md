# Relay Technical Specification

This document records implementation-level decisions that should not be duplicated in the functional requirements.

## Document retrieval configuration

| Concern | Selected configuration |
|---|---|
| Document transformation | Unstructured Transform API |
| Embedding owner | Astra DB Vectorize integration |
| Embedding provider/model | Astra-hosted NVIDIA `nvidia/nv-embedqa-e5-v5` |
| Vector dimensions | `1024` |
| Astra collection | `relay_handoff_chunks` |
| Astra similarity metric | `cosine` |
| Default Astra keyspace | `default_keyspace` |

### Embedding contract

- Unstructured parses documents and returns typed elements with page metadata, but does not generate embeddings.
- Relay writes chunk text to Astra through the collection's `$vectorize` field. Astra generates and stores the document embedding.
- Ask Relay sends query text through Astra vector search using `$vectorize`. Astra generates the query embedding with the same collection-level provider and model.
- The Astra collection is created with Vectorize enabled, dimension `1024`, and metric `cosine`.
- Relay validates the collection definition before ingestion and fails clearly if Vectorize, dimensions, or metric do not match this contract.
- Every stored chunk must retain organization, handoff, source, and page/section metadata needed for authorization and citations.
- The Vectorize provider and model are configured once on the Astra collection and are not duplicated as Relay environment variables.
- Relay does not receive an embedding-provider API key. An external provider credential, if used, is attached inside Astra; an Astra-hosted provider requires no separate provider credential.
- Because Astra collection Vectorize settings cannot be added or changed after collection creation, an incompatible pre-existing collection must be replaced deliberately rather than silently reused.

### Document processing contract

- PDF, DOCX, PPTX, JPEG, PNG, BMP, HEIC, and TIFF documents use the Unstructured Transform API with elements output so Relay retains element type and page metadata.
- TXT, Markdown, and CSV uploads are decoded directly. XLSX is parsed directly with SheetJS because the configured Transform endpoint does not accept it.
- Unstructured embeddings are disabled. Parsed element text is sent to Astra `$vectorize` in bounded segments.
- Processing is asynchronous. An atomic `pending`/`failed` → `processing` claim prevents two ordinary requests from processing and indexing one Source concurrently. The source remains private and records `processing`, `ready`, or a plain-language `failed` state while the original upload is retained.
- Unstructured job IDs are stored only as resumable provider references after a parse job is created; they are not credentials or required configuration. A slow job may resume for at most three bounded processing attempts rather than restarting the provider job.

### Server-only configuration

- `UNSTRUCTURED_API_URL`
- `UNSTRUCTURED_API_KEY`
- `ASTRA_DB_API_ENDPOINT`
- `ASTRA_DB_APPLICATION_TOKEN`
- `ASTRA_DB_KEYSPACE`
- `ASTRA_DB_COLLECTION`
- `ASTRA_DB_VECTOR_DIMENSIONS`
- `ASTRA_DB_VECTOR_METRIC`

Provider secrets are stored only in Supabase Edge Function secrets or an ignored local server environment file. They must never be exposed through an `EXPO_PUBLIC_*` variable.

Google Drive attachment import was removed (2026-09-27) as unnecessary complexity relative to the core handoff problem — direct file upload, voice, and typed text remain the supported Capture evidence paths. See `progress.md` for the removal record.

## Groq transcription and reasoning

| Concern | Selected configuration |
|---|---|
| API base URL | `https://api.groq.com/openai/v1` |
| Voice transcription model | `whisper-large-v3-turbo` |
| Structured-reasoning model | `openai/gpt-oss-120b` |
| Proposal response mode | Strict JSON Schema |

- The same server-only `GROQ_API_KEY` is used by separate Supabase Edge Functions for transcription and reasoning.
- Stopped voice audio remains temporary on the device and is sent as the authenticated Edge Function request body directly to Groq; it is never written to Supabase Storage or `sources`.
- On successful transcription, the client shows the full editable transcript. Only explicit **Continue** confirmation places the reviewed transcript into Capture text; no audio object is uploaded or retained.
- On transcription failure, Relay offers **Record again** and the existing typed-note capture through **Write instead**. It creates no failed voice Source, persistent audio object, retry queue, or saved-source reprocessing state.
- AI structuring accepts only the five broad categories `process`, `contact`, `rule_deadline`, `access_resource`, and `warning_lesson` for new suggestions. Existing legacy category values remain readable so immutable published history is preserved. Each proposal must include an exact source excerpt, pass server-side validation, and enter Relay as `proposed` rather than approved.
- Organize extracts grounded facts, groups them into independently useful operational units, incorporates dependent steps, task-specific contacts, rules, warnings, rationale, examples, and historical context, and only then assigns one primary category. A final boundary-and-coverage audit removes cross-category duplication without dropping useful grounded guidance. Independently useful or separately evidenced workflows remain separate for retrieval and provenance integrity.
- Provider output never writes directly to published or approved knowledge.

### Organize execution contract

- Save never calls document processing or Groq. `request_capture_organize` records a short-lived intent only when the Role Holder explicitly chooses **Organize**.
- A document shared by several Captures may continue Organize only for linked Captures with that explicit pending intent. Completing the Source never organizes every linked Capture.
- The Source and Capture model-call claims are atomic. Starting generation clears the pending intent, so duplicate clicks or concurrent Source completions cannot queue a second model call behind the first.
- Capture evidence is split into stable numbered spans. The model cites one ordered contiguous span run from one Source; Relay resolves the exact Source substring server-side and never asks the model to reproduce provenance text.
- The active model uses non-reasoning/instruct mode for extraction and a 1,000-token completion ceiling, matching the configured provider tier. Retryable provider/schema failures receive one bounded server retry; rate limits are never automatically retried.
- At most 100 approved items enter the prompt. When a Handoff has more, deterministic evidence-token overlap selects the most relevant items with stable ordering rather than blindly taking the first 100.
- Individual unsupported suggestions are omitted and counted while valid suggestions from the same response may proceed to Review. A response containing only unverifiable suggestions fails closed. More than 30 returned suggestions fails explicitly rather than being silently truncated.
- A ten-minute stale sweep runs during normal Capture loading and before generation. It turns abandoned Source/Capture processing into a retryable failed state and clears obsolete Organize intent without polling.

## Processing-state delivery

- The client performs one ordinary Supabase query for initial source state.
- While a Handoff or source screen is mounted, it subscribes only to matching `captures` and `sources` updates through Supabase Realtime Postgres Changes and invalidates the relevant local query cache when an event arrives.
- Relay does not use fixed-interval Postgres/PostgREST polling for processing or structuring state.
- The document Edge Function may poll the external Unstructured job endpoint within a bounded processing attempt because that provider operation is asynchronous; this does not poll Supabase.
- Groq transcription returns the candidate transcript within its originating Edge Function request without mutating a Source. Proposal generation still updates only an already-confirmed Source.

## Review-to-Preview contract

- Review can advance only after every proposal has been decided and at least one Knowledge Item is approved.
- The active Role Holder explicitly opens exact Preview. There is no Handoff Check/Preflight run, finding queue, AI readiness score, critical acknowledgement, or separate resolution phase.
- Any insert, deletion, or edit to Knowledge Items, or any insert, deletion, or text edit to a Source, returns a draft in Preview to Review. The Role Holder must inspect the current approved knowledge and open Preview again.
- The database enforces Role-assignment authorization and rechecks the proposal and approved-item gates when advancing to Preview.
- Astra working-document chunks remain available to Organize. Removing Handoff Check does not remove document indexing or Ask Relay's separate publication-scoped Astra retrieval.

## Preview, publication, and recipient access

### Snapshot boundary

- Draft Preview and the recipient page use the same `HandoffDocument` renderer and the same fixed section order.
- Publishing is a database transaction that locks the draft and rechecks Preview stage, proposal decisions, and the presence of approved knowledge.
- The transaction copies only Approved Knowledge Items into publication snapshot rows and then marks the Handoff Published. Sources, transcripts, uploads, private provenance, proposals, and authorization IDs are excluded from the public JSON contract.
- Material changes already return a draft to Review, so the server rejects publication when the owner's displayed Preview is stale. After publication, RLS freezes the original Handoff, Knowledge Items, source records, provenance, and source-file mutations.
- The recipient renderer reads snapshot data and has no dependency on Groq, Unstructured, Astra, or another AI provider.

### Access links

- Each publication has one cryptographically unguessable 64-hex-character access token. Publication tables remain hidden from anonymous users and ordinary organization members.
- Anonymous access is available only through `get_shared_handoff(token)`, a narrow security-definer RPC that returns the allow-listed snapshot JSON or `null`. Invalid, unknown, revoked, and replaced tokens are indistinguishable to the client.
- Revoking a link changes access state without deleting the Handoff or snapshot. Replacing a link rotates the token in place, immediately invalidating the old URL.
- v1 intentionally has no expiry rules, passwords, analytics, view counts, or permissions dashboard.
- QR is only a local encoding of the same browser URL; it creates no additional access scope. Copy and native sharing use that same URL.
- Web builds derive the recipient origin from the browser. Native builds require client-safe `EXPO_PUBLIC_RELAY_WEB_ORIGIN` so links open the deployed web recipient route rather than the Expo app scheme.

### Client libraries

- `expo-clipboard` provides local copy behavior and `react-native-qrcode-svg` renders QR codes through Expo-compatible `react-native-svg`.
- The installed versions are compatible with Expo SDK 57 and require neither a custom config plugin nor manual native configuration. Normal Expo native builds include the modules through autolinking.

### Role assignment invite links

- Assignment sharing uses the configured Expo app scheme: `relay://assignment/{64-hex-token}`. Opening the link launches the installed Relay app directly at the public invitation route; published recipient links remain ordinary HTTPS browser links.
- The assignment token reveals no private workspace and grants no membership or edit access. The invitee must authenticate, inspect the preselected Organization/Role/service period, and explicitly accept before the atomic server transaction activates membership and the Role Assignment.
- Email-confirmation callbacks may return only to a strictly validated `/assignment/{64-hex-token}` path. Arbitrary post-auth redirects are rejected.
- Invite authority is checked at creation, authenticated preview, and acceptance. The current Owner remains authorized across all Roles; otherwise only the latest active holder of that same Role may invite a future holder or replace themselves in the current service period.
- Each invite is bound to the exact outgoing assignment. Acceptance locks and rechecks that assignment, ends the Role's prior active assignments, activates the successor, and opens the workspace in one transaction; any workspace/entitlement failure rolls the assignment changes back. A same-period replacement receives the existing workspace, while a new-period successor receives a distinct workspace populated by the existing publication carry-forward logic.

### Server-only configuration

- `GROQ_API_KEY`
- `GROQ_API_URL`
- `GROQ_TRANSCRIPTION_MODEL`
- `GROQ_REASONING_MODEL`

## Ask Relay

### Permission and evidence boundary

- A valid active 64-hex publication token is the only public capability accepted by the `ask-relay` Edge Function. Publication and snapshot tables remain inaccessible directly.
- The server resolves the immutable publication snapshot first. Each snapshot item's normalized `title + content` is stored as an Astra Vectorize record with an exact `publication_id` and `record_kind=published_knowledge` boundary. Category is metadata only.
- Ask runs semantic search only inside that exact publication, ranks the same Supabase snapshot rows with BM25F, then combines the two ranked lists with reciprocal-rank fusion using `k=60`. BM25F uses `k1=1.2`, title weight `1.0`, content weight `1.15`, and `b=0.75` for both fields.
- Only Supabase `handoff_publication_items` become answer evidence. Raw Astra document chunks, private source text, transcripts, rejected proposals, and unpublished knowledge are never included in the Ask prompt or response. If Astra is unavailable, BM25F remains the complete fallback.
- Publication invokes authenticated snapshot indexing after the database publication transaction. Ask lazily repairs a missing index for older publications without changing their immutable snapshot.
- Citation labels and locators are copied into `handoff_publication_items.citation_sources` during publication. Ask therefore returns immutable citation metadata rather than reading mutable private source metadata at request time.

### Answer contract

- Groq receives only the recipient question and a bounded set of published snapshot items. The question and evidence are both treated as untrusted data.
- The model must return strict JSON with `answered`, `unsupported`, or `conflict`, a bounded answer, and up to five valid evidence references. The Edge Function validates exact keys, reference membership, uniqueness, citation presence, and the requirement that a conflict cite at least two relevant items before returning a factual answer.
- An unsupported response is normalized server-side to: `This handoff does not contain a reliable answer to that question.` It has no citations.
- Ask is read-only. It has no database path that writes approved knowledge, source material, or publication content.
- Usage is claimed atomically before provider work. Defaults are 10 requests per published Handoff per UTC day for Free and 100 for Pro; both are server-configurable and Pro remains bounded to protect shared links from abuse.
- Raw questions, source content, and generated answers are not logged by the function.

### Server-only configuration

- `ASK_RELAY_FREE_DAILY_LIMIT`
- `ASK_RELAY_PRO_DAILY_LIMIT`

Ask also uses the existing Astra and Groq server configuration listed above.

## Organization Memory

### Scope and immutable inputs

- The authenticated comparison resolves one requested Role, rechecks `can_view_role_history`, and separately checks the Organization plan. Owner and active Role Holder behavior therefore remains enforced by the existing Role-history authorization boundary.
- The default pair is the latest two structurally ordered published service periods for that exact Organization + Role. Publications from another Role or Organization cannot enter the pair.
- Comparison reads only `handoff_publication_items`, which are immutable snapshots of approved Knowledge Items. It never reads raw Captures, Sources, document chunks, working Knowledge Items, or Handoff-check state.

### Matching and materiality

- Preserved carry-forward `knowledge_lineage_id` is the normal matching path. One prior and one current item with the same lineage form a Changed candidate; a current lineage with no predecessor is an Added candidate; and a prior lineage absent from current truth is a Retired candidate.
- A deterministic normalization pass hides punctuation, formatting, word-order, and common grammatical-only rewrites before model review. Groq receives only the remaining server-approved candidates and may omit broader meaning-equivalent rewrites or non-material differences.
- `strong_semantic` remains an internal legacy storage value only. The fallback can form a pair only when both immutable publication rows lack lineage, their broad knowledge types agree, and they are an unambiguous mutual-best match. Ambiguous legacy candidates are omitted rather than labeled Added/Retired or forced into a relationship.
- Provider output cannot choose its own match basis or pair arbitrary references. Server validation maps output back to the precomputed candidate plan. Comparison writes only `role_memory_comparisons` and `role_memory_changes`; it never repairs or mutates canonical or published lineage.

### Optional reason

- A material change does not require a reason category. The provider may return one short `reason_statement` plus an approved publication evidence reference only when that evidence explicitly states a causal link. Server validation rejects unsupported statements and chronology-only explanations, producing `Reason not documented.` in the UI.
- Safe citation labels/locators from the before, after, and accepted reason-evidence publication items are deduplicated into displayed provenance. Internal match basis, confidence, lineage IDs, and publication IDs are not part of the normal UI.
- `202609270042_thin_organization_memory.sql` adds the optional evidence-backed `reason_statement` and permits missing lineage only for imported publication snapshots. `202609270043_remove_legacy_memory_reasons.sql` removes the obsolete reason-category columns, manual confirmation RPCs, and Warning/Lesson-to-Process relationship table.

## RevenueCat entitlement contract

- `react-native-purchases` is configured once per native process with the platform public SDK key and the authenticated Supabase UUID as RevenueCat App User ID.
- RevenueCat is the billing-entitlement source of truth. The Expo client cannot write plan state. An authenticated Edge Function fetches the purchaser's subscriber record from RevenueCat using a secret server key; Supabase stores the separate purchaser-to-Organization association in `organization_subscriptions`.
- A RevenueCat webhook validates a private Authorization value, re-fetches the subscriber rather than trusting event fields, and refreshes the active/inactive state of an existing association. It never guesses an Organization. App foreground, purchase, and restore also trigger reconciliation; no database polling is used.
- Purchase and restore accept an explicit current Organization only after server-side admin authorization. An active unbound entitlement may be associated with that Organization; an entitlement already associated elsewhere is not silently reassigned. The unique RevenueCat-app-user/entitlement key makes reconciliation idempotent.
- Organization plan reads use the authenticated `get_organization_plan` RPC. Database creation RPCs enforce one owned organization per Free purchaser account, then one active role and one non-archived Handoff per Free Organization. Direct Role/Handoff inserts have no client policy, so guarded RPCs cannot be bypassed.
- Relay Pro enables additional records only for its associated Organization. A downgrade changes subscription status only: existing organizations, roles, Handoffs, sources, approved knowledge, publications, and recipient access are retained.
- The paywall reads the annual package from RevenueCat's current offering and requires an Organization context. Relay Pro is annual-only and framed around preserving the Organization's knowledge for the academic year. Restore Purchases is available from the same surface.
- Recipient routes are outside subscription gates. Opening, reading, and asking within the configured public allowance never requires an account or app installation.
- Expo Go can exercise RevenueCat's preview behavior, but real RevenueCat Test Store purchase validation requires an Expo development build and a configured Test Store annual product.

### Client-safe configuration

- `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`
- `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`
- `EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID`

### Server-only configuration

- `REVENUECAT_SECRET_API_KEY`
- `REVENUECAT_ENTITLEMENT_ID`
- `REVENUECAT_WEBHOOK_AUTHORIZATION`
