# Mallet

Mallet is a clone-style Apple Wallet pass generator modeled after WalletWallet's landing page + pass creation flow.

## What was replicated

- Single-page product layout with a pass generation form.
- In-browser barcode intake (camera, image upload, or manual entry).
- Pass options from WalletWallet docs: `barcodeValue`, `barcodeFormat`, `title`, optional `label`, `value`, `colorPreset`, `expirationDays`.
- `.pkpass` download flow.

## Architecture

- Frontend: static HTML/CSS/JS in `public/`.
- Backend: local Node proxy (`server.js`) exposing `POST /api/pkpass`.
- Upstream pass API: defaults to `https://api.walletwallet.dev/api/pkpass`.

The proxy keeps your API key server-side and avoids exposing it in the browser.

## Setup

1. Copy env values:

```bash
cp .env.example .env
```

2. Fill in `MALLET_API_KEY` in your shell or `.env` loader.

3. Run:

```bash
npm run start
```

4. Open:

`http://127.0.0.1:3000`

## Notes

- Camera/image scanning uses `BarcodeDetector`. If unavailable in the browser, manual entry still works.
- In this sandbox, opening local listening ports is blocked (`EPERM`), so runtime had to be validated outside the sandbox.
