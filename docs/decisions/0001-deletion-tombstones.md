# 0001. Use GCS tombstones to coordinate deletes with reconciliation

- **Status:** Accepted
- **Date:** 2026-05-15
- **Deciders:** Upload Function maintainer

## Context

The Upload Function now has `DELETE /v1/objects/<objectKey>` (spec §2.3.6). A delete must remove the canonical object from both GCS and R2.

The Reconciliation Function (spec §4) lists GCS objects modified in the last 48 hours, HEADs each in R2, and copies GCS → R2 to repair drift. It treats any missing R2 object as a replication gap to fix.

Without a marker for intentional deletes, the reconciler can race with a delete that runs in the order "R2 then GCS": between the two steps, the reconciler sees GCS present but R2 missing and **backfills R2 from GCS**, undoing the in-progress delete. Even with the safer order ("GCS then R2"), any future expansion of reconciliation to iterate R2 reintroduces the same problem.

The Function deliberately has no database (spec §2.7), so we cannot persist deletion intent in a row.

## Decision

Persist a **tombstone** in GCS at `tombstones/<objectKey>.json` as the first step of every delete. Tombstones are immutable JSON markers containing `objectKey`, `deletedAt`, `deletedBy`, and `requestId`.

The Reconciliation Function (stage 8) **must** consult `tombstones/<objectKey>.json` before backfilling R2 from GCS, and skip backfill when a tombstone exists. This contract is documented in spec §2.12 and referenced in §4.

Tombstones expire via a GCS lifecycle policy on the `tombstones/` prefix after **7 days** — well past the reconciler's 48-hour modified-objects window. The Function does not delete tombstones from code.

## Consequences

**Positive:**

- Delete becomes idempotent at the application layer: a retry rewrites the same tombstone, then re-attempts R2 and GCS deletes (both 404-safe).
- Reconciler keeps its simple GCS-iteration model; tombstone is one extra HEAD per missing-R2 object.
- No database dependency, preserving spec §2.7.
- Tombstone payload doubles as an audit record (who deleted, when, request ID).

**Negative / accepted trade-offs:**

- The reconciler now has an `if-tombstone-exists` branch it must respect; stage 8 cannot ship without honoring this contract.
- Tombstones for very high delete volume could clutter the GCS namespace (mitigated by the 7-day lifecycle).
- A racy edge case still exists if a delete's R2 step succeeds, GCS step fails, and the caller never retries — the GCS object lingers indefinitely. The next reconciler pass will not repair this (it iterates GCS, sees the object, sees R2 missing, sees tombstone exists, skips). Operators get a stuck object that needs manual cleanup. Acceptable since the alternative (delete-from-R2 worker) is far more complex.
- One additional GCS write per delete request.

## Alternatives considered

- **Soft delete with database row.** Rejected — violates spec §2.7's "no DB" rule and pulls the Function out of pure-storage scope.
- **GCS object retention/hold + side-channel signal.** Object holds don't survive delete and offer no read-side signal.
- **Pin delete order to GCS-first, accept the race.** Works only as long as the reconciler iterates GCS-only. Any future expansion (e.g., detecting R2 orphans) re-introduces the race with no in-band signal.
- **Per-object metadata flag.** GCS object metadata vanishes when the object is deleted, so the reconciler can't read it after the fact.

## Related

- Spec section: `docs/spec.md` §2.3.6 (delete endpoint), §2.12 (tombstone contract), §4 (reconciliation must honor tombstones).
- Code: `src/storage/upload-storage.ts` (`buildTombstonePath`, `writeTombstone`, `tombstoneExists`); `src/storage/gcs-storage.ts` implementation; delete handler in `src/app.ts`.
