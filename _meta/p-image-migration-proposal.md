# p-image Migration Proposal

**Author:** Quentin Rider
**Date:** May 2026
**Status:** Draft for review

## Summary

The `p-image` VM (Windows Server 2012, GCP project `p-artnetapps`, zone `us-east4-a`) holds the bulk of Artnet's lot image storage on a single 65 TB dynamic disk (`s-image-disk1`). The OS is end-of-life, the disk uses legacy Windows LDM dynamic disk volumes, and the image processing pipeline is a fragile .NET application producing low-quality variants.

This document proposes a two-phase migration:

- **Phase 1 (this proposal):** Migrate all image data from the existing volumes into Google Cloud Storage. Decommission `p-image`.
- **Phase 2 (later):** Stand up Cloudflare R2 as the primary serving and write target, with GCS as a durable secondary replica. Build a modern variant-generation pipeline. Cut over URLs.

The end-state architecture is **R2 primary, GCS secondary**. R2 is the user-facing read and write path; GCS is the durable backup, system-of-record for compliance/audit, and escape hatch if Artnet ever needs to rebuild R2 or migrate off Cloudflare.

Phase 2 is intentionally out of scope for execution in this document, but the steady-state design is sketched here so that Phase 1 decisions are made with the end state in mind. The benefit of separating the phases is that Phase 1 can proceed independently and immediately reduces risk (legacy OS, single-VM dependency), without being blocked by Phase 2 implementation work.

## Current state

### Hardware and OS

- VM: `p-image` in `p-artnetapps`, zone `us-east4-a`
- OS: **Microsoft Windows Server 2012 Standard** (general support ended Oct 2023; ESU paid coverage available but limited)
- Patch status: stale; last visible Windows updates from 2022
- Boot disk: small (separate from data disk)
- Data disk: `s-image-disk1`, 65 TB Standard Persistent Disk, single GPT partition containing a Windows LDM dynamic disk with four spanned/simple NTFS volumes
- Daily snapshot schedule (`daily-schedule-2`) is active and producing two snapshots per day

### Volume layout

Investigation via snapshot mount on a Linux VM (LDM volumes assembled with `dmsetup`, mounted read-only via `ntfs-3g`):

| Drive Letter | Size | Used | Purpose (inferred) |
|---|---|---|---|
| N: | 6.8 TB | 4.8 TB | Production lot images (`WWW`, `lot_images_COPYRIGHT`, `lot_images_CopyRight3`, `temp`) |
| L: | 2.8 TB | 141 GB | Archive (`LOTS-IMG-ARCHIVE` — two ad-hoc 2019 export jobs) |
| X: | 8.2 TB | 2.5 TB | Secondary `www` content |
| W: | 42 TB | 22 TB | Primary image pipeline + content (`www\artnet.com\wwwroot\lot_images`) |
| **Total** | **~60 TB** | **~29.4 TB** | |

The disk is provisioned at 65 TB but only ~30 TB is actually in use. The migration target is therefore ~30 TB, not 65 TB.

### Pipeline and image format

The .NET image processing pipeline lives on W: (`LotImageParser.exe`, `ThumbnailImageResizer.exe`, `FileWatch.exe`, `CorrupatedImageDetector`, plus `.asp` URL handlers).

The active configuration in `LotImageParser.exe.config` shows:

```xml
<add key="imagePath" value="W:\www\artnet.com\wwwroot\lot_images"/>
```

The directory structure is `lot_images\<auction_house_id>\<YYYYMMDD>\<lot_id>\`, with files named `<image_id>.jpg`, `<image_id>i.jpg`, `<image_id>o.jpg` — three variants per image. Multi-image lots use `_1`, `_2`, etc. suffixes (e.g. `1.jpg`, `1_1.jpg`, `1_2.jpg`).

Sizes observed across both old (2010) and recent (2026) lots:

- `<id>.jpg` — small/medium variant, ~10–80 KB
- `<id>i.jpg` — thumbnail, ~1–10 KB
- `<id>o.jpg` — largest variant, ~150 KB to 1.2 MB

**There are no high-resolution masters on disk.** Even the largest `o` files are web-resolution JPEGs. This is the highest quality currently available for existing content. New auction-house submissions may include higher-resolution sources, but those would be a forward-looking concern (Phase 2 / new pipeline), not a Phase 1 migration question.

### Database integration

`LotImageParser` writes a SQL update file (`C:\updateLotTable.csv`), strongly suggesting that image paths are referenced from a `LotTable` in the application database. URL cutover in Phase 2 will likely involve either updating that table or fronting the existing URLs with a Cloudflare Worker that rewrites paths transparently.

### Open questions for the PDB / image pipeline owners

These should be answered before the migration starts but do not block initial planning:

1. Do auction houses currently submit images at higher resolution than what is stored, and if so, where (if anywhere) do those originals live?
2. What is the purpose of `lot_images_COPYRIGHT` and `lot_images_CopyRight3` on N:? They are sparse subsets — possibly watermarked variants for specific auction houses?
3. What is on the X: drive's `www` folder — different brand, sub-site, or legacy content?
4. What are the small numeric folders (`6`, `467`, `554`, `_delme`) under `lot_images`? Test data, system entries, or live content?
5. What does `LotImageParser`'s runtime model look like — watch folder triggered, batch job, or scheduled? Anything currently writing to the disk needs to be identified for the cutover sync window.
6. Are there other systems (cron jobs, scheduled tasks, monitoring, downstream batch processes) that depend on the existing paths or the .NET binaries on the VM?
7. **Authoritative URL → path mapping logic** lives in `WebServices/Picture.aspx` and its associated `web.config`, in a separate GitHub repo (link to be obtained from the image pipeline owner). This needs to be reviewed before finalizing the cutover strategy — it determines whether URLs map 1:1 to file paths or whether there is database-driven indirection. The legacy `.asp` handlers (`picture.asp`, `resize.asp`, etc.) appear to be superseded by `Picture.aspx`.

## Phase 1 goals

1. Move ~30 TB of image data from `p-image`'s four NTFS volumes into Google Cloud Storage.
2. Preserve the directory structure and filename conventions exactly, so application URL paths can later be mapped to GCS (and R2) paths with a deterministic rewrite rule.
3. Achieve a clean cutover where the application reads from GCS (directly or via CDN) instead of from `p-image`'s local disks.
4. Decommission `p-image` once cutover is verified and a verification window has passed.
5. Position GCS to serve two future roles after Phase 2: (a) the source for the one-time bulk-populate of R2, and (b) the steady-state durable replica behind R2.

## Architecture (Phase 1)

```
┌──────────────────────────────────────────┐
│ p-image VM (decommissioned post-cutover) │
│  - W: 22 TB                              │
│  - N: 4.8 TB                             │
│  - X: 2.5 TB                             │
│  - L: 141 GB                             │
└──────────────────┬───────────────────────┘
                   │  (initial bulk + delta sync via gcloud storage rsync)
                   ▼
        ┌───────────────────────┐
        │  Google Cloud Storage │
        │  Bucket(s)            │
        └──────────┬────────────┘
                   │
                   ▼
        Application reads from GCS
        (direct, or via CDN front)
```

### Bucket design

**Recommendation:** one bucket per logical volume, mirroring the source structure. This keeps blast radius small, simplifies IAM, and makes incremental sync per-volume rather than monolithic.

| Bucket | Source | Storage class | Notes |
|---|---|---|---|
| `artnet-images-w` | W: drive contents | Standard | Hot — main production content |
| `artnet-images-n` | N: drive contents | Standard | Hot — production content |
| `artnet-images-x` | X: drive contents | Standard | Standard initially, evaluate Nearline post-cutover |
| `artnet-images-l` | L: drive contents | Nearline or Coldline | Archive content — cold from day one |

- **Region:** `us-east4` (matches source VM zone for fast bulk transfer with no egress cost).
- **Versioning:** enable on all buckets. Cheap and saves us from accidents.
- **Object lifecycle:** none initially. Add later per-bucket if storage class transitions are wanted (e.g. age out unused content to Nearline after 365 days).
- **Public access:** **disabled.** Phase 2 introduces controlled public access via CDN/R2.
- **Uniform bucket-level access:** enabled. Don't use ACLs.
- **Object key strategy:** preserve the relative path from the volume root verbatim. Example: `W:\www\artnet.com\wwwroot\lot_images\425939177\20260310\638775\195o.jpg` → `gs://artnet-images-w/www/artnet.com/wwwroot/lot_images/425939177/20260310/638775/195o.jpg`.

### What to exclude

Some content on the volumes is junk and should not be migrated:

- `$RECYCLE.BIN`, `RECYCLER`, `Recycled`, `System Volume Information`, `found.000`, `Thumbs.db` — Windows internals
- `_delme` folder — explicitly marked for deletion by a previous admin
- The `temp*` files at the root of `www\artnet.com\` — hundreds of orphaned uploads accumulated over a decade
- The .NET binaries (`LotImageParser.exe`, `FileWatch.exe`, `ThumbnailImageResizer.exe`, etc.) — these are part of the legacy pipeline being replaced; preserve a copy elsewhere for reference but do not migrate to image buckets
- `oops.rar`, `corruptedImages.txt`, `eqlAccessTest.txt`, `move.bat` — operational debris

This filtering is straightforward to express as `--exclude` patterns to `gcloud storage rsync` or as a deny list in a custom transfer script.

### Transfer mechanics

**Recommended approach:** dedicated Linux transfer VM in `p-artnetapps`, snapshot-mounted source data, `gcloud storage rsync` to GCS.

#### Why a snapshot, not the live VM

- Avoids any risk to the live production VM during transfer.
- Provides a consistent point-in-time view; no concern about files changing mid-transfer.
- Linux + `dmsetup` + `ntfs-3g` mounting works (validated during investigation phase — see Appendix A).
- Same-region (`us-east4`) snapshot read and GCS upload means transfer happens entirely on Google's internal network with no egress cost.

#### Why not the live VM directly via gcloud-on-Windows

- `gcloud storage` on Windows is workable but slower for parallel uploads.
- Running a multi-day large transfer on the production VM consumes CPU and IOPS that PDB users may need.
- Any subtle file-locking or in-flight-write issues during transfer would be hard to diagnose.

#### Transfer VM specs

- Machine type: `n2-standard-16` or larger, in zone `us-east4-a`
- Network egress: at this size, ~32 Gbps available within-region — more than enough; the bottleneck will be PD read throughput from the snapshot, not network
- Boot disk: 50 GB
- No data disk needed beyond mounting the investigation disk

#### Sync command pattern

For each volume:

```bash
# Mount source volume read-only at e.g. /mnt/p-image-w
# Then:

gcloud storage rsync \
  /mnt/p-image-w/ \
  gs://artnet-images-w/ \
  --recursive \
  --exclude='\$RECYCLE\.BIN' \
  --exclude='System Volume Information' \
  --exclude='Thumbs\.db' \
  --exclude='RECYCLER' \
  --exclude='Recycled' \
  --exclude='found\.000' \
  --exclude='_delme' \
  --checksum \
  --no-clobber-after-time=...
```

Use `tmux` or `screen` to survive SSH disconnects. Log to a file. Plan multiple parallel runs (one per volume) on the same VM — the per-bucket `gcloud storage rsync` processes will not contend much for CPU but will saturate disk read; tune by experiment.

#### Estimated transfer time

Rough estimate: in-region GCS uploads from a snapshot-backed PD typically achieve 200–400 MB/s sustained per process, with multiple parallel processes possible. For 30 TB:

- Single-stream, conservative (200 MB/s): ~42 hours
- Parallel across 4 volumes, optimistic (4 × 300 MB/s = 1.2 GB/s aggregate): ~7 hours

Realistic plan: budget **2–3 days of wall-clock time** for the initial bulk transfer, then incremental delta syncs are fast (minutes to a couple of hours) since `rsync` only re-checks file metadata.

### Sync strategy: bulk + delta + cutover

Because the live VM is still receiving writes (new auction-house images uploaded to `p-image`), the migration must handle the gap between "initial copy" and "applications switched to GCS."

**Phase 1a — Initial bulk transfer.** From a recent snapshot, copy everything to GCS. Wall-clock: 2–3 days. Source: snapshot, not live disk.

**Phase 1b — Delta sync(s).** Take a fresh snapshot every day or two and run `gcloud storage rsync` against it to pick up new files. Each delta should take an hour or two — it only transfers what's new. Repeat until cutover.

**Phase 1c — Cutover window.** Coordinate with PDB:
1. Pause the upload pipeline (or have new uploads buffer to a temp location).
2. Take a final snapshot of `s-image-disk1`.
3. Run a final `gcloud storage rsync` from the final snapshot.
4. Verify counts and a sampled set of checksums between source and GCS.
5. Repoint the application to read from GCS.
6. Resume the upload pipeline writing to GCS (or a queue feeding GCS).

The cutover window itself should be measured in hours, not days, because the bulk of the data is already in GCS by this point.

**Phase 1d — Verification window.** Keep `p-image` running but with no new writes for ~7–14 days. Monitor for any issues (broken URLs, missing images, application errors) that imply data didn't actually make it to GCS or paths are wrong. If the verification window passes cleanly, decommission.

**Phase 1e — Decommission.** Stop and delete `p-image`. Retain the most recent snapshot of `s-image-disk1` for at least 6 months as a safety backup. Delete after that.

## Cost estimate

Order-of-magnitude only.

### One-time

- GCS upload: $0 (in-region, no egress charge from PD or snapshot to GCS)
- Transfer VM (~3 days @ `n2-standard-16`): ~$60
- Investigation/snapshot disk (already in use, factored into operational): ~$200 if kept around for the full migration window

### Ongoing

- GCS Standard storage in `us-east4`: ~$0.020/GB/month
- 30 TB at Standard: ~$600/month
- Splitting L: to Nearline (~141 GB) or Coldline saves negligible amounts; not worth complicating the design for that volume's size

### Savings vs. current state

The current 65 TB Standard PD costs ~$2,600/month even though only 30 TB is used. **Phase 1 alone saves roughly $2,000/month in storage costs** by getting off PD and onto right-sized GCS, before any further savings from the eventual move to R2.

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Application has hard-coded paths to `p-image` shares we don't know about | Medium | High | Inventory all systems referencing image paths before cutover; grep DB and code for `W:\\`, `\\\\10.4.1.75\\`, `picture.asp`, etc. |
| Image upload pipeline writes during cutover window | Medium | Medium | Pause uploads or buffer to temp; final delta sync after pause |
| Filename encoding issues (non-ASCII filenames in source) | Low | Medium | gcloud handles UTF-8 paths; spot-check non-ASCII files post-transfer |
| Files in use / locked during snapshot | Very Low | Low | Snapshot is point-in-time; no live-disk read involved |
| GCS bucket name conflict | Low | Low | Use `artnet-images-*` naming; check availability before creation |
| Missed dependencies on .NET binaries (`LotImageParser`, `FileWatch`) | Medium | Medium | Preserve a copy of W:\ root binaries to a separate "legacy-pipeline-archive" location before decommission |
| 2012 OS goes EOL hard during migration | Low | High | Migration itself eliminates this risk; until then, maintain the daily snapshots already in place |

## Phase 2: Steady-state architecture (sketch)

This section describes the end-state Phase 2 will deliver. It is captured here so Phase 1 decisions (bucket structure, object keys, IAM, network) align with what comes next.

### End-state architecture

```
                  ┌──────────────────────┐
   Auction house  │  Upload service      │
   user uploads ──▶  (Cloudflare Worker  │
                  │   or upload API)     │
                  └──────────┬───────────┘
                             │ write
                             ▼
                       ┌──────────┐
                       │    R2    │  ◀── reads ──── End users (via CDN)
                       │ (primary)│
                       └─────┬────┘
                             │ event notification
                             ▼
                  ┌────────────────────┐
                  │ Replication Worker │
                  │  / Queue consumer  │
                  └──────────┬─────────┘
                             │ async copy
                             ▼
                       ┌──────────┐
                       │   GCS    │  (durable backup, audit, escape hatch)
                       │(secondary)│
                       └──────────┘
```

Key properties:

- **R2 is the primary read path.** All user-facing image requests are served by R2 (with Cloudflare CDN in front). R2 has zero egress fees; this is the architectural reason to use it.
- **R2 is the primary write path.** New uploads land in R2 first. The upload endpoint returns success only after R2 confirms the write.
- **GCS is asynchronously kept in sync.** R2 events trigger replication to GCS via a Worker or Queue consumer. GCS is never on the user-facing read path.
- **Variant generation is on-the-fly.** A Cloudflare Worker (or Cloudflare Image Resizing) generates resized/format-converted variants on demand from the R2 original, with results cached at the CDN edge. This replaces the static `<id>.jpg / i / o` triplets and the .NET pipeline that produces them.

### Why R2 first for new uploads

The decision to write new uploads to R2 first (rather than GCS first with R2 replication) is driven by **user-perceived latency**, not aggregate throughput.

PDB users already complain about platform slowness. Auction-house staff who upload an image and immediately verify their work (by refreshing the page or opening the lot record) need the image to be visible without delay. With GCS-first, there is a window — typically seconds, occasionally longer — between "image exists in GCS" and "image is replicated to R2 and servable." During that window, the user sees a missing thumbnail or a 404. They don't perceive this as eventual consistency; they perceive it as broken.

R2-first eliminates that window. Upload completes → image is immediately in the same store the website reads from → next request serves it. The replication to GCS happens asynchronously and is invisible to the user.

The tradeoffs accepted with R2-first:

- **R2 is now load-bearing for the write path.** If R2 has an incident, uploads fail. With GCS-first, uploads would still succeed and replication would catch up later. R2's track record is good, but this should be tracked.
- **R2 wins on conflicts.** If a user re-uploads (replacing an image), R2 has the new version first; GCS catches up via replication. The replication consumer must be idempotent and handle "newer object overwrites older" semantics correctly.
- **GCS is a backup, not a redundant primary.** This is a real shift from a "two equal copies" model. Defining recovery procedures (RTO, RPO, restore-from-GCS-to-R2 runbook) becomes important even if never exercised.
- **Replication failures must be monitored.** If the R2 → GCS pipeline silently breaks, redundancy quietly stops being redundant. Alert on queue depth, age of last successful replication, and run periodic reconciliation sweeps.

### Why GCS first for the migration

The migration is a one-time bulk operation, not an ongoing user-facing path. The right answer for migration is the opposite of the right answer for steady-state uploads:

- The source data lives in GCP (snapshot of `s-image-disk1`). Writing to GCS in the same region is **free** (no egress fee, internal Google network).
- Writing 30 TB directly to R2 from a GCP VM would require GCP egress (~$0.12/GB ≈ $3,600 in egress fees alone), and would be bottlenecked by external network bandwidth.
- Once data is in GCS, it can be moved into R2 cheaply via Cloudflare's R2 Super Slurper, which pulls from GCS source buckets natively. Cloudflare absorbs the transfer mechanics, and migration ingress to R2 has historically been free or heavily discounted.
- This means the bulk transfer happens twice (legacy VM → GCS → R2), but the second hop is cheap and run on Cloudflare's terms.

So Phase 1 populates GCS; a Phase 2 task populates R2 from GCS. After that initial R2 population, ongoing writes go to R2 first.

### Replication pattern (R2 → GCS)

Recommended pattern, all standard Cloudflare/GCS building blocks:

1. Upload service writes to R2; returns success on R2 confirmation.
2. R2 emits an event notification (R2 event notifications → Cloudflare Queue).
3. A Worker consumes the queue, fetches the object from R2, writes it to GCS via the GCS JSON API using a service account credential stored in Worker secrets.
4. On replication failure, the queue retries with exponential backoff. Persistent failures land in a dead-letter queue with alerting (Cloudflare Notifications → Slack/email).
5. A daily reconciliation job lists R2 and GCS for each bucket, diffs the object sets, and re-replicates anything in R2 that's missing or stale in GCS. Catches anything that slipped through the event pipeline.

Anti-pattern to avoid: synchronous dual-write from the upload service to both R2 and GCS in the same request. This makes uploads only as fast as the slower of the two clouds, doubles the failure surface, and complicates retry semantics. The async event-driven pattern is strictly better.

### Phase 2 work breakdown (out of scope for this proposal)

The actual Phase 2 implementation will need its own design document, but the rough work items are:

1. **Bulk-populate R2 from GCS** via R2 Super Slurper (one-time per bucket).
2. **Build the upload service** (Cloudflare Worker + R2 binding, or a small upload API). Replaces `LotImageParser.exe`.
3. **Build the variant pipeline** (Cloudflare Worker fronting R2, using Cloudflare Image Resizing or equivalent to generate `<id>.jpg`, `<id>i.jpg`, `<id>o.jpg` equivalents on the fly). Replaces the `.asp`/`Picture.aspx` handlers.
4. **Build R2 → GCS replication** (event notifications + queue consumer + reconciliation job).
5. **URL cutover** at the application/database level, or transparently via Cloudflare Worker rules. The Worker approach is lower-risk; database-level rewrite can follow.
6. **Monitoring, alerting, runbooks** for the new architecture.

## Recommended next steps

1. **Loop in PDB and image pipeline owners** with the open questions list above.
2. **Validate access** to all source paths from a Linux mount (already done during investigation; documented in Appendix A).
3. **Inventory all consumers** of `p-image` paths — application code, database tables, scheduled jobs, downstream batch processes. This is the single most important pre-migration task.
4. **Provision GCS buckets** with the structure above. Empty buckets first; populating them is the migration itself.
5. **Provision the transfer VM** (`n2-standard-16` in `p-artnetapps`, `us-east4-a`).
6. **Run the initial bulk sync** from a snapshot, log everything, time it accurately. This number drives the cutover plan.
7. **Iterate delta syncs** until cutover-ready.
8. **Schedule cutover** with PDB.
9. **Cut over, verify, decommission.**

## Appendix A — Investigation notes (snapshot mount procedure)

The source data is on Windows LDM dynamic disk volumes, which require manual reconstruction on Linux. Process is documented for reproducibility:

1. Take or identify a recent snapshot of `s-image-disk1`.
2. Create a disk in `qa-artnetapps-7e9a` from the snapshot (cross-project; requires a one-time IAM grant on the snapshot for the qa project's Compute SA).
3. Attach the disk to a Linux VM in `qa-artnetapps-7e9a` in **read-write mode** (`dmsetup` cannot create mappings on a read-only-attached disk; filesystem-level read-only protection is enforced at mount time instead).
4. Use `ldmtool scan` to identify the disk group and `ldmtool show partition` to get partition starts/sizes.
5. Partition `start` values are relative to the LDM data area (`data-start = 262178`), not absolute disk sectors. Add `262178` to each `start` value to get the absolute offset.
6. Build `dmsetup` linear tables manually for each volume, concatenating partitions in the correct order. For spanned volumes, the correct partition order may differ from `ldmtool show volume` output — verify by checking that the first 512 bytes of each assembled volume show the NTFS signature (`353 R 220 N T F S` in `od -c`).
7. Mount each `/dev/mapper/ldm_volume*` device with `ntfs-3g -o ro`.

Volume layout discovered (Disk Group `S-IMAGE-Dg0`, GUID `dd061ece-4c03-11ea-9544-b098e49af290`):

- Volume2 (N:): spanned across Disk1-02, Disk1-01, Disk1-06
- Volume3 (L:): spanned across Disk1-03, Disk1-05
- Volume4 (X:): spanned across Disk1-04, Disk1-07 *(note: order swapped from ldmtool report — verified empirically)*
- Volume5 (W:): simple, single partition Disk1-09

Cleanup procedure:

```bash
sudo umount /mnt/p-image-{n,l,x,w}
sudo dmsetup remove ldm_volume2 ldm_volume3 ldm_volume4 ldm_volume5
# detach disk and delete via gcloud
```

---

*End of proposal.*
