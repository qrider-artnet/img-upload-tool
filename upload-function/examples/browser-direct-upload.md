# Browser Direct Upload

Use this flow from the future upload widget or another browser UI.

The browser does not upload image bytes through the Upload Function. It asks for a signed GCS URL, uploads the file directly to GCS, then finalizes with the Upload Function.

The running implementation lives in:

- [browser-direct-upload.ts](./browser-direct-upload.ts)
- [browser-direct-upload.html](./browser-direct-upload.html)

Build and open it:

```bash
npm run examples:build
```

Note: browsers cannot manually set the `Content-Length` request header. The browser sets it from the `File` body. Server-side callers can set it explicitly.

## Metadata tagging (optional)

Browsers cannot run `exiftool`, so the page tags through a small **tag server**
from the `metadata-tagger` component. When you fill the metadata fields and a tag
server URL, the page sends the image + fields to the tag server, gets the tagged
bytes back, and then runs the normal presign → PUT → finalize with those bytes
(the upload stays browser-direct to GCS). Tagging applies to JPEG/WebP only.

Start the tag server (needs `exiftool` — see `metadata-tagger/README.md`):

```bash
cd ../../metadata-tagger
npm install
npm run serve            # POST /tag on http://localhost:8090
```

Then in the page set **Tag server URL** to `http://localhost:8090`, fill the
artwork/photographer fields, and upload. The GPS/device privacy strip runs by
default, so attribution survives the Variant Worker's `metadata: keep` without
leaking location data.
