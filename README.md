# Relay

Relay is an Android-first Expo application for preserving student-organization leadership knowledge and handing it safely to the next person in a role.

The core product loop is:

**Capture → Structure → Preflight → Resolve → Publish → Ask → Learn**

## Current state

Relay now has a working secure P0 path from capture through grounded recipient questions and plan enforcement. The implemented foundation includes:

- authenticated organization creation
- optional private organization logos
- roles within an organization
- service-period handoffs that begin as private drafts
- membership-scoped Supabase row-level security
- organization, role, and handoff history screens
- voice, typed, document, and manual capture
- human-reviewed structured knowledge with provenance
- evidence-backed Preflight and resolution
- exact recipient Preview
- revocable unguessable links, QR sharing, and a no-login recipient page
- permission-filtered Ask Relay answers with immutable citations and explicit unsupported responses
- organization-scoped annual Relay Pro backed by RevenueCat, restore purchases, contextual paywalls, and server-enforced free limits

See [progress.md](./progress.md) for verified status and the remaining deployment/store configuration.

## Local setup

Copy `.env.example` to `.env.local` and provide only client-safe values: Supabase URL/publishable key, deployed Relay web origin, EAS project ID, and RevenueCat platform public SDK keys. Never place the service-role key or provider secrets in an Expo environment variable.

Copy `supabase/.env.example` to the ignored `supabase/.env.local` for local Edge Functions. Ask Relay uses the existing Astra/Groq configuration. Purchase verification additionally requires the RevenueCat secret API key, entitlement identifier, and a private webhook authorization value.

Start the local Supabase stack, apply migrations, then run Expo:

```bash
npm install
npm run db:start
npm run android
```

RevenueCat can load safely in Expo Go preview mode, but real Test Store purchases and restoration must be tested in an Expo development build. Configure the current offering with one annual package and use the stable Supabase user UUID as RevenueCat's purchaser App User ID. Relay associates that active purchaser entitlement with one selected Organization in Supabase.

If no Android device or emulator is available:

```bash
npm run web
```

## Verification

```bash
npm run typecheck
npm test
npm run test:db
npm run build:web
npx expo export --platform android
```

Browser UI checks should run headlessly unless a visible browser is explicitly requested.
