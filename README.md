# book8-core-api

API core for Book8 application.

## Environment — Infobip (WhatsApp, MENA)

See `docs/INFOBIP_SETUP.md`. Summary:

- `INFOBIP_API_KEY` — Infobip API key (`Authorization: App …`).
- `INFOBIP_BASE_URL` — e.g. `https://xxxxx.api.infobip.com`.
- `INFOBIP_SENDER` — Default outbound WhatsApp sender (digits) when `business.whatsappSenderNumber` is unset (typically your registered production sender).

Partial Infobip configuration (only one of key/base URL) causes startup failure.

