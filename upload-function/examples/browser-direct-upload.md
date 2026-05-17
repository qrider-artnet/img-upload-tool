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
