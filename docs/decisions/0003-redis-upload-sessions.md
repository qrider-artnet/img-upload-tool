# 0003. Use Redis for shared upload sessions

- **Status:** Accepted
- **Date:** 2026-05-20
- **Deciders:** Upload Function maintainer

## Context

The Upload Function direct-upload flow creates short-lived session state during
`POST /v1/uploads/presign` and consumes it during
`POST /v1/uploads/:uploadId/finalize`. The session records the canonical object
key, expected size/content type, authorization context, and expiry.

The initial implementation used in-process memory, which only works when presign
and finalize hit the same Cloud Run instance. That conflicts with the target
deployment shape where the Function may scale horizontally.

Artnet already operates a Redis cluster, so adding a new managed datastore just
for 15-minute upload sessions is unnecessary.

## Decision

Store upload sessions in Redis for deployed environments. Each session is stored
as JSON at:

```text
upload-session:<uploadId>
```

The Redis TTL matches the signed upload URL TTL. The function still validates
the `expiresAt` field after reading the record, so correctness does not depend
only on Redis expiry timing.

Local development may omit `REDIS_URL`; in that case the Function falls back to
the in-memory session store. Horizontally scaled deployments must provide
`REDIS_URL`.

## Consequences

**Positive:**

- Presign and finalize can land on different Cloud Run instances.
- The existing API contract does not change.
- Session TTL behavior maps directly to Redis expiry.
- No extra database or document store is introduced.

**Negative / accepted trade-offs:**

- The Upload Function now depends on Redis availability for direct uploads.
- `/v1/health` must include Redis so operators catch session-store outages.
- Deployment must provide network path, TLS/auth settings, and `REDIS_URL`.

## Alternatives considered

- **Keep in-process memory and cap max instances to 1.** Simple but fragile on
  process restarts and incompatible with horizontal scale.
- **Firestore TTL documents.** Good fit if Redis did not already exist, but it
  adds a second persistence service for data that is naturally TTL-based.
- **Stateless signed finalize token.** Avoids storage, but changes the API shape
  and introduces signing-key rotation concerns.

## Related

- Spec section: `docs/spec.md` §2.3.1
- Code: `upload-function/src/redis-upload-session-store.ts`;
  `upload-function/src/upload-session-store.ts`
