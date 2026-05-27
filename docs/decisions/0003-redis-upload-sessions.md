# 0003. Use Redis for shared upload sessions

- **Status:** Accepted
- **Date:** 2026-05-22
- **Deciders:** Upload Function maintainer

## Context

The Upload Function direct-upload flow creates short-lived session state during
`POST /v1/uploads/presign` and consumes it during
`POST /v1/uploads/:uploadId/finalize`. The session records the canonical object
key, private staging object key, expected size/content type, authorization
context, and expiry.

In-process memory only works when presign and finalize hit the same Cloud Run
instance. It also loses all sessions on every deploy or process restart and
forces single-instance deployment settings. That conflicts with the target
deployment shape where the Function may scale horizontally.

Artnet already operates a Redis cluster. Local development can use
`redis:7-alpine` in Docker, and deployed environments can use Memorystore
through a Serverless VPC Connector. Both environments use the same `REDIS_URL`
contract.

## Decision

Store upload sessions in Redis using `ioredis`. Each session is stored as JSON
at:

```text
upload-session:<uploadId>
```

The Redis TTL matches the signed upload URL TTL and is set using Redis expiry
on write. The function still validates the `expiresAt` field after reading the
record, so correctness does not depend only on Redis expiry timing.

Runtime selection is controlled by:

```text
SESSION_STORE=redis | memory
```

`SESSION_STORE=redis` is the normal local and deployed mode. `SESSION_STORE` may
be set to `memory` for tests or local development without Docker. When unset,
the application defaults to `memory` under Vitest/test execution and `redis`
otherwise.

The Redis client connects lazily on first use. Startup must not fail merely
because Redis is temporarily unavailable. If Redis is unavailable during a
request, the Function returns `503 session_store_unavailable` and logs
`eventCode=session_store_unavailable`.

## Consequences

**Positive:**

- Presign and finalize can land on different Cloud Run instances.
- Deploys and instance restarts no longer invalidate all active direct-upload
  sessions.
- The existing API contract does not change.
- Session TTL behavior maps directly to Redis expiry.
- `ioredis` leaves room for future Redis cluster or sentinel deployment without
  changing the Upload Function interface.

**Negative / accepted trade-offs:**

- The Upload Function now depends on Redis availability for direct uploads.
- `/v1/health` includes Redis, so Redis outages affect service health.
- Local development normally needs `docker compose up -d` before `npm run dev`.
- Deployed environments must provide Redis network path, TLS/auth settings when
  required, Secret Manager wiring for `REDIS_URL`, and a Serverless VPC
  Connector for Memorystore.

## Alternatives considered

- **Keep in-process memory and cap max instances to 1.** Rejected. Simple, but
  fragile on process restarts and incompatible with horizontal scale.
- **Firestore TTL documents.** Rejected. It would work, but adds a persistence
  service for data that is naturally TTL-based and already fits existing Redis
  operations.
- **Stateless signed finalize token.** Rejected. Avoids storage, but changes the
  API shape and introduces signing-key rotation concerns.

## Related

- Spec section: `docs/spec.md` §2.3.1
- Code: `upload-function/src/upload-session-store-redis.ts`;
  `upload-function/src/upload-session-store-factory.ts`;
  `upload-function/src/upload-session-store.ts`
