# Astral Anti-Cheat Platform — PUN 2 / PlayFab / Cloudflare starter

This repository is a **starter implementation**, not a production-certified anti-cheat. It provides a Cloudflare Worker API, D1 schema, dashboard UI, PlayFab ticket verification, short-lived signed Astral tokens, Photon PUN 2 Custom Authentication endpoint, and Unity C# integration scripts in the `AstralAuthentication` namespace.

## Included

- Developer username/password login (PBKDF2 password hashing, HttpOnly/Secure/SameSite cookie)
- First-owner setup protected by a one-time `BOOTSTRAP_TOKEN`
- Add game: name, PlayFab Title ID, Photon App ID, PlayFab developer secret
- AES-GCM encryption of PlayFab secret at rest in D1
- Dashboard: player IDs, deterministic Astral IDs, security events, future-connection blocks
- `/v1/auth/issue`: verifies PlayFab SessionTicket server-to-server and issues a short-lived AstralAuthenticationToken
- `/photon/authenticate`: validates the token and block status for Photon Custom Authentication
- Unity scripts in namespace `AstralAuthentication`
- Local folder detection for `persistentDataPath/MelonLoader` and `persistentDataPath/lemonloader`

## Important limitations / security notes

1. A Unity client is controlled by the player. A local folder check can be patched out or bypassed. The Worker rechecks token, PlayFab identity, and block status, but cannot independently prove that a folder does not exist on the device.
2. The Photon endpoint must be configured in the Photon Dashboard as the PUN Custom Authentication URL. Confirm the exact request/response contract against your Photon product/region/account before production use.
3. This starter blocks **future** Photon authentication. It does not forcibly disconnect an already-connected PUN 2 player. To kick active players, add a trusted room host/server enforcement channel or Photon Server Plugin / supported server-side integration. A client-only kick command is not secure.
4. The dashboard's block button permanently blocks future auth until you add an unblock route. It does not mean a device-wide hardware ban.
5. The `Photon App ID` is configuration metadata for the developer dashboard; it is not a secret. Do not ship PlayFab Developer Secret Key, `TOKEN_SIGNING_SECRET`, `ENCRYPTION_KEY`, or bootstrap token in Unity.
6. Use HTTPS, rate limiting/WAF, backups, audit logging, account recovery, MFA, CSRF protections, and a tested Photon auth response before production.
7. The Unity example expects your game to obtain a PlayFab SessionTicket using the PlayFab Unity SDK. It deliberately does not contain PlayFab title secrets.
8. Voice and room gameplay events are not automatically monitored merely because Photon Voice/PUN are installed. Add trusted gameplay validation and event reporting in your game/server.

## Requirements

- Node.js 20+
- Cloudflare account with Workers and D1
- PlayFab title and server API secret
- Photon PUN 2 App ID and Custom Authentication configuration
- Unity project with PUN 2 and PlayFab Unity SDK

## Local setup

```bash
npm install
npx wrangler login
npx wrangler d1 create astral-db
```

Copy the generated database ID into `wrangler.toml`, then:

```bash
npx wrangler d1 migrations apply astral-db --local
```

Create `.dev.vars` in the project root:

```dotenv
BOOTSTRAP_TOKEN="a-long-random-one-time-setup-token"
TOKEN_SIGNING_SECRET="a-long-random-secret-at-least-32-characters"
ENCRYPTION_KEY="BASE64_ENCODED_32_BYTE_KEY"
```

Generate an encryption key with Node:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Run:

```bash
npm run dev
```

## Create the first developer account

Send one POST request to `/api/setup` with JSON:

```json
{
  "bootstrapToken": "YOUR_BOOTSTRAP_TOKEN",
  "username": "owner",
  "password": "use-a-long-unique-password"
}
```

After creating the first account, rotate or remove `BOOTSTRAP_TOKEN` so setup cannot be reused. Sign in at the local Worker URL.

## Production deployment

```bash
npx wrangler d1 migrations apply astral-db --remote
npx wrangler secret put BOOTSTRAP_TOKEN
npx wrangler secret put TOKEN_SIGNING_SECRET
npx wrangler secret put ENCRYPTION_KEY
npx wrangler deploy
```

Create the owner account once, then remove/rotate the bootstrap secret.

## Add a game

In the dashboard, enter:
- Game name
- PlayFab Title ID
- Photon App ID
- PlayFab Developer Secret Key

The PlayFab secret is encrypted with AES-GCM using `ENCRYPTION_KEY` before it is stored in D1. The secret is never returned to the browser after save.

## Configure Photon PUN 2

1. In Photon Dashboard, open your PUN application.
2. Enable Custom Authentication and set the custom auth URL to `https://YOUR-ASTRAL-DOMAIN/photon/authenticate`.
3. Configure the client to send the custom auth parameter `token`.
4. In Unity, use `AstralPun2ConnectExample` or adapt its sequence:
   - Log in with PlayFab.
   - Obtain the PlayFab SessionTicket.
   - Call `AstralAuthenticationClient.Authenticate(ticket, callback)`.
   - Only if successful, set `PhotonNetwork.AuthValues` from `AstralPun2Authenticator`.
   - Call `PhotonNetwork.ConnectUsingSettings()`.

Photon's exact custom-auth settings and response expectations should be validated with your Photon account and PUN 2 version. Test in a separate Photon application first.

## Unity install

Copy `unity/Runtime/` into your Unity project's `Assets/AstralAuthentication/Runtime/`.

Create an `AstralAuthenticationSettings` asset (Assets > Create > Astral > Authentication Settings), set:
- Game ID from Astral dashboard (returned when adding game)
- Astral API URL

Add `AstralAuthenticationClient` and `AstralPun2Authenticator` to your bootstrap object. Wire references in Inspector. Obtain a PlayFab SessionTicket through the PlayFab SDK and pass it to `BeginConnect`.

## API overview

- `GET /api/health`
- `POST /api/setup` (one-time bootstrap)
- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`
- `GET/POST /api/games`
- `GET /api/games/:id/events`
- `GET /api/games/:id/players`
- `POST /api/games/:id/blocks`
- `POST /v1/auth/issue`
- `POST /v1/events`
- `GET|POST /photon/authenticate`

## Test status

This package was generated as a starter scaffold. No live Cloudflare deployment, real PlayFab title, Photon application, Quest device, or Photon Custom Authentication callback has been available in this session. Run `npm install` and `npm run typecheck`, then test the Photon callback and PlayFab ticket verification in a private test title before using it with real players.
