# metadata-tagger

Client-side library + CLI that embeds artwork-cataloging and attribution
metadata into image bytes **before upload**, so the Upload Function stays pure
storage (it only ever stores already-tagged bytes). Callers pass artwork fields
at upload time via `tagAndUpload`.

## Requirements

- Node 22, npm.
- **`exiftool` on PATH** — required to write metadata; JS-native libraries can't
  reliably write the IPTC Extension artwork struct. Install:
  - Arch: `pacman -S perl-image-exiftool`
  - macOS: `brew install exiftool`
  - Debian/Ubuntu: `apt install libimage-exiftool-perl`
  - No system package / no root (e.g. CI): exiftool is a self-contained Perl
    script, so clone it and add it to PATH (needs `perl`):

    ```bash
    git clone --depth 1 https://github.com/exiftool/exiftool.git /tmp/exiftool
    chmod +x /tmp/exiftool/exiftool
    PATH="/tmp/exiftool:$PATH" npm test
    ```

Scope: **server-side callers** (S3-ingest prep, harness backend, scripts).
Browser direct-upload tagging is deferred (browsers can't run exiftool).

## Two layers (never conflated)

- **Artwork(s) depicted** → IPTC Extension "Artwork or Object in the Image"
  (`XMP-iptcExt:ArtworkOrObject`), a list — one image may depict several artworks.
- **The photograph** → its own byline / copyright / capture date (IPTC +
  `XMP-dc` + `XMP-plus`). A public-domain painting can carry a copyrighted repro
  photo, so the two copyrights stay separate.

## CLI

```bash
npm install && npm run build
node dist/cli.js --image ./painting.jpg --metadata ./meta.json --out ./painting.tagged.jpg
```

`meta.json`:

```json
{
  "artworks": [
    { "title": "Mona Lisa", "creator": ["Leonardo da Vinci"],
      "physicalDescription": "Oil on poplar, 77 × 53 cm",
      "copyrightNotice": "Public domain" }
  ],
  "photograph": { "creator": ["Jane Photographer"], "copyrightNotice": "© 2026 Studio" }
}
```

The CLI prints the two layers + a verify verdict and exits non-zero if any
requested field is missing from the read-back.

## Library

```ts
import { embed, tagAndUpload, parseMetadataDocument } from '@artnet/metadata-tagger';

// Embed only:
const { bytes, verification } = await embed(imageBuffer, doc);

// Embed + upload through the normal presign -> PUT -> finalize flow:
const result = await tagAndUpload({
  endpoint: 'https://…run.app',
  image: imageBuffer,
  metadata: doc,
  presignFields: { kind: 'auction-lot', auctionHouseId: '425939177', auctionDate: '20260310', lotId: '638775', imageId: '195', imageVariantSuffix: null },
  gatewayHeaders: { 'X-Artnet-Product-Id': 'artnet-auctions', 'X-Artnet-Auction-House-Id': '425939177' },
});
```

`tagAndUpload` embeds first, then presigns with the **tagged** byte length (the
signed PUT pins exact content length), PUTs the tagged bytes, and finalizes.

## WebP note

WebP carries XMP/EXIF but not legacy IPTC IIM. The artwork fields are XMP and
embed fine; for the photograph the XMP forms (`XMP-dc` / `XMP-plus`) are what
survive in WebP.

## Privacy strip (default on)

While embedding, the tagger also **strips GPS location and device serial
numbers** (`GPS:all`, EXIF/XMP GPS, `*SerialNumber`). This is on by default so
the stored original carries no location/device data. Opt out with the library
option `stripPrivacy: false` or the CLI flag `--keep-privacy`. Capture date is
**not** stripped — it is part of the photograph attribution layer.

## Surviving delivery (Cloudflare)

Embedding only gets metadata into the original. **Cloudflare Images strips
metadata by default** during the variant transform, so the Variant Worker sets
`metadata: 'keep'` on its transform to preserve attribution to the delivered
image. `keep` also preserves GPS/device EXIF — which is safe here precisely
*because* the tagger removes those fields by default (Cloudflare's three modes
can't keep cataloging while dropping GPS; the field-level decision lives
upstream, in this tool). If you upload with `--keep-privacy`, switch the Worker
to `copyright` or accept the leak.

## Tests

```bash
npm test
```

The mapping and schema tests run anywhere. The exiftool round-trip test
(`embed.integration.test.ts`) **skips** when exiftool is not installed.
