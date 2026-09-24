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

- PDF, DOCX, PPTX, JPEG, PNG, BMP, and HEIC documents use the Unstructured Transform API with elements output so Relay retains element type and page metadata.
- TXT, Markdown, and CSV uploads are decoded directly because the Transform v2 endpoint does not accept those extensions and they require no OCR or layout parsing.
- Unstructured embeddings are disabled. Parsed element text is sent to Astra `$vectorize` in bounded segments.
- Processing is asynchronous. The source remains private and records `processing`, `ready`, or a plain-language `failed` state while the original upload is retained.
- Unstructured job IDs are stored only as resumable provider references after a parse job is created; they are not credentials or required configuration.

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

## Google Drive attachment import

- Relay uses Google Picker through the system browser with the single `https://www.googleapis.com/auth/drive.file` scope and multiple selection enabled.
- For every selection, the Expo client asks the authenticated `google-drive-import` Edge Function for a signed authorization URL. Google returns the one-use authorization code and selected file IDs to the hosted callback. The OAuth client secret and access token never enter Expo.
- OAuth state is HMAC-signed, expires after ten minutes, binds the Relay user/Organization/Handoff/Capture/return URL, and is followed by a fresh active-membership and exact Role Assignment authorization check at callback time.
- The authorization request uses `access_type=online`, the Google-required `prompt=consent`, `trigger_onepick=true`, and `allow_multiple=true`. Relay does not persist access or refresh tokens. The callback iterates over every validated ID from `picked_file_ids` and imports each file independently.
- The server downloads ordinary Drive files with `files.get?alt=media`; Google Docs, Sheets, and Slides use `files.export` to DOCX, XLSX, and PPTX.
- Imported bytes must match the local upload allow-list, remain at or below 25 MB, and receive a SHA-256 hash before Storage/Source insertion. Exact duplicates in the Handoff are skipped.
- Successful imports are ordinary private `pending` document Sources attached to the existing Capture. Import and Save never invoke Unstructured, Astra, or Groq; explicit Organize retains sole responsibility for processing/indexing and proposal generation.
- The browser callback is `https://hygwsszjajrqqdxwzqya.supabase.co/functions/v1/google-drive-import/callback`; the Edge Function then returns to the validated web `/drive-import` route or installed `relay://drive-import` route.

### Server-only Google Drive configuration

- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_STATE_SECRET`
- `GOOGLE_DRIVE_CALLBACK_URL`
- `GOOGLE_DRIVE_ALLOWED_WEB_ORIGINS`

The OAuth client is a Google **Web application** because Google returns to the HTTPS Edge Function. The installed Android APK still completes through Relay's custom app scheme; the Web client secret is never packaged in the APK.

## Groq transcription and reasoning

| Concern | Selected configuration |
|---|---|
| API base URL | `https://api.groq.com/openai/v1` |
| Voice transcription model | `whisper-large-v3-turbo` |
| Structured-reasoning model | `openai/gpt-oss-120b` |
| Proposal response mode | Strict JSON Schema |

- The same server-only `GROQ_API_KEY` is used by separate Supabase Edge Functions for transcription and reasoning.
- Stopped voice audio remains temporary on the device and is sent as the authenticated Edge Function request body directly to Groq; it is never written to Supabase Storage or `sources`.
- On successful transcription, the client shows the full editable transcript. Only explicit **Continue** confirmation inserts a Ready voice Source containing the reviewed transcript and Groq provenance reference; no audio object is uploaded or retained.
- On transcription failure, Relay offers **Record again** and the existing typed-note capture through **Write instead**. It creates no failed voice Source, persistent audio object, retry queue, or saved-source reprocessing state.
- AI structuring accepts only the five broad categories `process`, `contact`, `rule_deadline`, `access_resource`, and `warning_lesson` for new suggestions. Existing legacy category values remain readable so immutable published history is preserved. Each proposal must include an exact source excerpt, pass server-side validation, and enter Relay as `proposed` rather than approved.
- Organize extracts grounded facts, groups them into independently useful operational units, incorporates dependent steps, task-specific contacts, rules, warnings, rationale, examples, and historical context, and only then assigns one primary category. A final boundary-and-coverage audit removes cross-category duplication without dropping useful grounded guidance. Independently useful or separately evidenced workflows remain separate for retrieval and provenance integrity.
- Provider output never writes directly to published or approved knowledge.

## Processing-state delivery

- The client performs one ordinary Supabase query for initial source state.
- While a Handoff or source screen is mounted, it subscribes only to matching `sources` updates through Supabase Realtime Postgres Changes and invalidates the relevant local query cache when an event arrives.
- Relay does not use fixed-interval Postgres/PostgREST polling for processing or structuring state.
- The document Edge Function may poll the external Unstructured job endpoint within a bounded processing attempt because that provider operation is asynchronous; this does not poll Supabase.
- Groq transcription returns the candidate transcript within its originating Edge Function request without mutating a Source. Proposal generation still updates only an already-confirmed Source.

## Preflight contract

### Evidence and reasoning

- Preflight can start only for a draft in Review/Preflight, after every proposal has been decided and at least one Knowledge Item is approved.
- The server evaluates approved Knowledge Items, saved provenance excerpts, and permission-filtered Astra document chunks for the same organization and Handoff.
- Astra retrieval filters on both `organization_id` and `handoff_id`; source material from another Handoff cannot enter the prompt or a stored finding.
- Groq `openai/gpt-oss-120b` returns strict-schema findings limited to missing, ambiguous, incomplete, or contradictory information. Each finding is Critical or Optional and cites one to six authorized evidence references; contradictions require at least two.
- Provider output is validated again by the Edge Function and by the database transaction. IDs must belong to the active Handoff, evidence is stored as an exact snapshot, and an invalid batch rolls back without partial findings.
- Preflight asks a human question and explains why it matters. It does not invent an answer or present an arbitrary completeness percentage.

### Lifecycle and concurrency

- A Handoff can have only one Processing Preflight run at a time. An abandoned Processing run becomes Failed after ten minutes when an admin retries.
- A completed run is Ready and stores its finding count. Provider or validation errors become Failed with bounded, plain-language copy.
- Any insert, deletion, or material edit to Knowledge Items or source text makes Ready runs Stale, clears critical acknowledgement, and returns a draft in Preflight/Preview to Review.
- If material knowledge changes while a run is Processing, that run becomes Failed rather than being allowed to complete against an outdated snapshot.
- Resolving a finding atomically creates approved manual knowledge or edits the selected approved Knowledge Item. Because that is a material change, Preflight must then rerun.
- Skip and Unknown are explicit unresolved decisions. Optional unresolved findings can continue to Preview. Critical unresolved, skipped, or unknown findings require a recorded admin acknowledgement before Preview.
- Publication must recheck the latest Ready run and the critical acknowledgement contract; reaching Preview alone does not publish or expose data.

### Client state delivery

- The client queries the current run once, subscribes to matching `preflight_runs` changes, and refreshes its scoped cache when the run changes.
- Finding decision updates use a separate subscription scoped to the active run.
- Preflight uses no fixed-interval database/PostgREST polling. External reasoning remains a bounded Edge Function request, and reconnecting triggers one cache refresh.

## Preview, publication, and recipient access

### Snapshot boundary

- Draft Preview and the recipient page use the same `HandoffDocument` renderer and the same fixed section order.
- Publishing is a database transaction that locks the draft, rechecks Preview stage, proposal decisions, the latest Ready Preflight, and any required critical acknowledgement.
- The transaction copies only Approved Knowledge Items into publication snapshot rows and then marks the Handoff Published. Sources, transcripts, uploads, provenance, proposals, Preflight findings, and authorization IDs are excluded from the public JSON contract.
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
