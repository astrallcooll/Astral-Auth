interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  BOOTSTRAP_TOKEN: string;
  TOKEN_SIGNING_SECRET: string;
  ENCRYPTION_KEY: string;
  APP_ORIGIN: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function passwordHash(password: string, salt = crypto.randomUUID()) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 210000, hash: "SHA-256" }, material, 256);
  return `${salt}.${btoa(String.fromCharCode(...new Uint8Array(bits)))}`;
}
async function verifyPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(".");
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 210000, hash: "SHA-256" }, material, 256);
  const actual = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return actual === expected;
}
async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function encrypt(plain: string, secret: string) {
  const raw = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(cipher)))}`;
}
async function decrypt(value: string, secret: string) {
  const [ivText, cipherText] = value.split(".");
  const raw = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Uint8Array.from(atob(ivText), c => c.charCodeAt(0)) }, key, Uint8Array.from(atob(cipherText), c => c.charCodeAt(0)));
  return new TextDecoder().decode(plain);
}
function b64url(value: string) { return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
async function signToken(payload: Record<string, unknown>, secret: string) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${await hmac(secret, body)}`;
}
async function validToken(token: string, secret: string) {
  const [body, sig] = token.split(".");
  if (!body || !sig || await hmac(secret, body) !== sig) return null;
  try { return JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>; } catch { return null; }
}
function getCookie(request: Request, name: string) {
  return request.headers.get("Cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);
}
async function requireUser(request: Request, env: Env) {
  const session = getCookie(request, "astral_session");
  if (!session) return null;
  const payload = await validToken(decodeURIComponent(session), env.TOKEN_SIGNING_SECRET);
  if (!payload || payload.kind !== "dashboard" || Number(payload.exp) < Date.now() / 1000) return null;
  return String(payload.sub);
}
async function body(request: Request) { try { return await request.json() as Record<string, any>; } catch { return {}; } }
function cookie(value: string, maxAge: number) {
  return `astral_session=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}
async function playFabVerify(titleId: string, secret: string, ticket: string) {
  const response = await fetch(`https://${titleId}.playfabapi.com/Server/AuthenticateSessionTicket`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-SecretKey": secret },
    body: JSON.stringify({ SessionTicket: ticket })
  });
  if (!response.ok) throw new Error("PlayFab rejected the session ticket");
  const result = await response.json() as any;
  const playFabId = result?.data?.UserInfo?.PlayFabId;
  if (!playFabId) throw new Error("PlayFab response did not contain a player ID");
  return playFabId as string;
}
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/health") return json({ ok: true, service: "Astral", time: now() });

  // First-owner bootstrap. Keep BOOTSTRAP_TOKEN secret; remove/rotate it after creating the owner.
  if (path === "/api/setup" && method === "POST") {
    const input = await body(request);
    if (!env.BOOTSTRAP_TOKEN || input.bootstrapToken !== env.BOOTSTRAP_TOKEN) return json({ error: "Setup not authorised" }, 401);
    const username = String(input.username || "").trim();
    const password = String(input.password || "");
    if (username.length < 3 || password.length < 12) return json({ error: "Username must be 3+ characters and password 12+ characters" }, 400);
    const exists = await env.DB.prepare("SELECT id FROM users LIMIT 1").first();
    if (exists) return json({ error: "Initial account already exists" }, 409);
    const userId = id("usr");
    await env.DB.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .bind(userId, username, await passwordHash(password), now()).run();
    return json({ ok: true, message: "Owner account created. Sign in now." });
  }

  if (path === "/api/login" && method === "POST") {
    const input = await body(request);
    const user = await env.DB.prepare("SELECT id, password_hash FROM users WHERE username = ?").bind(String(input.username || "")).first<any>();
    if (!user || !(await verifyPassword(String(input.password || ""), user.password_hash))) return json({ error: "Invalid username or password" }, 401);
    const token = await signToken({ kind: "dashboard", sub: user.id, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 }, env.TOKEN_SIGNING_SECRET);
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "set-cookie": cookie(token, 43200), "cache-control": "no-store" } });
  }
  if (path === "/api/logout" && method === "POST") return new Response("{}", { headers: { "content-type": "application/json", "set-cookie": cookie("", 0) } });

  // Unity SDK asks Astral to validate the PlayFab ticket. Secrets stay on the Worker.
  if (path === "/v1/auth/issue" && method === "POST") {
    const input = await body(request);
    const gameId = String(input.gameId || "");
    const ticket = String(input.playFabSessionTicket || "");
    const localChecks = input.localChecks as Record<string, unknown> || {};
    if (!gameId || !ticket) return json({ error: "gameId and PlayFab session ticket are required" }, 400);
    const game = await env.DB.prepare("SELECT id, playfab_title_id, playfab_secret_cipher FROM games WHERE id = ?").bind(gameId).first<any>();
    if (!game) return json({ error: "Unknown game" }, 404);
    if (localChecks.melonLoader === true || localChecks.lemonLoader === true) {
      await env.DB.prepare("INSERT INTO security_events (id, game_id, event_type, severity, details, created_at) VALUES (?, ?, 'LOADER_DETECTED', 'high', ?, ?)")
        .bind(id("evt"), gameId, JSON.stringify({ melonLoader: !!localChecks.melonLoader, lemonLoader: !!localChecks.lemonLoader }), now()).run();
      return json({ error: "ASTRAL-001: local integrity check failed" }, 403);
    }
    try {
      const secret = await decrypt(game.playfab_secret_cipher, env.ENCRYPTION_KEY);
      const playFabId = await playFabVerify(game.playfab_title_id, secret, ticket);
      const blocked = await env.DB.prepare("SELECT playfab_id FROM player_blocks WHERE game_id = ? AND playfab_id = ?").bind(gameId, playFabId).first();
      const astralId = `AST-${(await sha256(`${gameId}:${playFabId}`)).slice(0, 16).toUpperCase()}`;
      await env.DB.prepare("INSERT INTO player_links (game_id, playfab_id, astral_id, first_seen, last_seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT(game_id, playfab_id) DO UPDATE SET last_seen=excluded.last_seen")
        .bind(gameId, playFabId, astralId, now(), now()).run();
      if (blocked) {
        await env.DB.prepare("INSERT INTO security_events (id, game_id, playfab_id, astral_id, event_type, severity, details, created_at) VALUES (?, ?, ?, ?, 'BLOCKED_LOGIN_ATTEMPT', 'high', 'Player attempted to connect while blocked', ?)")
          .bind(id("evt"), gameId, playFabId, astralId, now()).run();
        return json({ error: "ASTRAL-002: player is blocked", astralId }, 403);
      }
      const exp = Math.floor(Date.now() / 1000) + 180;
      const tokenId = id("tok");
      await env.DB.prepare("INSERT INTO auth_tokens (token_id, game_id, playfab_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(tokenId, gameId, playFabId, exp, now()).run();
      const token = await signToken({ kind: "astral_auth", jti: tokenId, gameId, playFabId, astralId, exp }, env.TOKEN_SIGNING_SECRET);
      return json({ ok: true, token, astralId, playFabId, expiresAt: exp, verdict: "TRUSTED" });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Authentication failed" }, 401);
    }
  }

  // Configure this URL as the Photon PUN Custom Authentication URL.
  if (path === "/photon/authenticate" && (method === "GET" || method === "POST")) {
    const form = method === "GET" ? Object.fromEntries(url.searchParams) : Object.fromEntries(new URLSearchParams(await request.text()));
    const token = String(form["token"] || form["authToken"] || "");
    const payload = await validToken(token, env.TOKEN_SIGNING_SECRET);
    if (!payload || payload.kind !== "astral_auth" || Number(payload.exp) < Date.now() / 1000) {
      return json({ ResultCode: 1, Message: "Astral authentication failed" }, 200);
    }
    const blocked = await env.DB.prepare("SELECT playfab_id FROM player_blocks WHERE game_id = ? AND playfab_id = ?").bind(String(payload.gameId), String(payload.playFabId)).first();
    if (blocked) return json({ ResultCode: 1, Message: "Player blocked by game developer" }, 200);
    const tokenRow = await env.DB.prepare("SELECT token_id FROM auth_tokens WHERE token_id = ? AND game_id = ? AND playfab_id = ? AND expires_at >= ?")
      .bind(String(payload.jti), String(payload.gameId), String(payload.playFabId), Math.floor(Date.now()/1000)).first();
    if (!tokenRow) return json({ ResultCode: 1, Message: "Astral token expired or revoked" }, 200);
    return json({ ResultCode: 0, UserId: String(payload.playFabId), NickName: String(payload.astralId), AuthCookie: { astralId: payload.astralId, gameId: payload.gameId } }, 200);
  }

  if (path === "/v1/events" && method === "POST") {
    const input = await body(request);
    const gameId = String(input.gameId || "");
    const game = await env.DB.prepare("SELECT id FROM games WHERE id = ?").bind(gameId).first();
    if (!game) return json({ error: "Unknown game" }, 404);
    await env.DB.prepare("INSERT INTO security_events (id, game_id, playfab_id, astral_id, event_type, severity, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id("evt"), gameId, input.playFabId || null, input.astralId || null, String(input.eventType || "CLIENT_EVENT"), String(input.severity || "medium"), JSON.stringify(input.details || {}), now()).run();
    return json({ ok: true });
  }


  const userId = await requireUser(request, env);
  if (!userId) {
    if (path.startsWith("/api/")) return json({ error: "Sign in required" }, 401);
    return env.ASSETS.fetch(request);
  }

  if (path === "/api/me") {
    const user = await env.DB.prepare("SELECT id, username FROM users WHERE id = ?").bind(userId).first();
    return json({ user });
  }

  if (path === "/api/games" && method === "GET") {
    const result = await env.DB.prepare("SELECT id, name, playfab_title_id, photon_app_id, created_at FROM games WHERE owner_user_id = ? ORDER BY created_at DESC").bind(userId).all();
    return json({ games: result.results });
  }
  if (path === "/api/games" && method === "POST") {
    const input = await body(request);
    const name = String(input.name || "").trim();
    const titleId = String(input.playFabTitleId || "").trim();
    const photonId = String(input.photonAppId || "").trim();
    const secret = String(input.playFabSecretKey || "");
    if (!name || !titleId || !photonId || secret.length < 10) return json({ error: "Complete all game fields" }, 400);
    const gameId = id("game");
    const encrypted = await encrypt(secret, env.ENCRYPTION_KEY);
    await env.DB.prepare("INSERT INTO games (id, owner_user_id, name, playfab_title_id, photon_app_id, playfab_secret_cipher, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(gameId, userId, name, titleId, photonId, encrypted, now()).run();
    return json({ ok: true, gameId });
  }

  const gameMatch = path.match(/^\/api\/games\/([^/]+)\/(events|players|blocks)$/);
  if (gameMatch) {
    const gameId = gameMatch[1], action = gameMatch[2];
    const game = await env.DB.prepare("SELECT id FROM games WHERE id = ? AND owner_user_id = ?").bind(gameId, userId).first();
    if (!game) return json({ error: "Game not found" }, 404);
    if (action === "events" && method === "GET") {
      const result = await env.DB.prepare("SELECT * FROM security_events WHERE game_id = ? ORDER BY created_at DESC LIMIT 100").bind(gameId).all();
      return json({ events: result.results });
    }
    if (action === "players" && method === "GET") {
      const result = await env.DB.prepare("SELECT p.*, CASE WHEN b.playfab_id IS NULL THEN 0 ELSE 1 END AS blocked FROM player_links p LEFT JOIN player_blocks b ON b.game_id=p.game_id AND b.playfab_id=p.playfab_id WHERE p.game_id = ? ORDER BY p.last_seen DESC LIMIT 200").bind(gameId).all();
      return json({ players: result.results });
    }
    if (action === "blocks" && method === "POST") {
      const input = await body(request);
      const playFabId = String(input.playFabId || "");
      const reason = String(input.reason || "Blocked by developer");
      if (!playFabId) return json({ error: "PlayFab ID required" }, 400);
      await env.DB.prepare("INSERT OR REPLACE INTO player_blocks (game_id, playfab_id, reason, blocked_at, blocked_by) VALUES (?, ?, ?, ?, ?)")
        .bind(gameId, playFabId, reason, now(), userId).run();
      await env.DB.prepare("INSERT INTO security_events (id, game_id, playfab_id, event_type, severity, details, created_at) VALUES (?, ?, ?, 'PLAYER_BLOCKED', 'high', ?, ?)")
        .bind(id("evt"), gameId, playFabId, reason, now()).run();
      return json({ ok: true, message: "Future authentication attempts will be denied." });
    }
  }

  if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);
  return env.ASSETS.fetch(request);
}

export default { fetch: route };
