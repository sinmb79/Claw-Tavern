const EXCHANGE_URL = "https://api.agentidcard.org/auth/exchange";

function normalizeExpiry(source) {
  const absoluteExpiry = source?.expires_at ?? source?.expiresAt;

  if (absoluteExpiry !== undefined && absoluteExpiry !== null) {
    const parsedDate = new Date(absoluteExpiry);
    const normalized = Number.isFinite(parsedDate.getTime())
      ? parsedDate.toISOString()
      : String(absoluteExpiry);

    return { expires_at: normalized };
  }

  const rawExpiry = source?.expires;

  if (rawExpiry === undefined || rawExpiry === null) {
    return {};
  }

  const numericSeconds = typeof rawExpiry === "number"
    ? rawExpiry
    : (typeof rawExpiry === "string" && /^\d+(\.\d+)?$/.test(rawExpiry.trim()) ? Number(rawExpiry) : NaN);

  let normalized;
  if (Number.isFinite(numericSeconds)) {
    normalized = new Date(Date.now() + numericSeconds * 1000).toISOString();
  } else {
    const parsedDate = new Date(rawExpiry);
    normalized = Number.isFinite(parsedDate.getTime())
      ? parsedDate.toISOString()
      : String(rawExpiry);
  }

  const result = { expires_at: normalized };
  result.expires = source.expires;

  return result;
}

function normalizeIdentityPayload(payload) {
  const source = payload?.identity && typeof payload.identity === "object" ? payload.identity : payload;
  const ailId = source?.ail_id ?? source?.ailId;

  if (!ailId) {
    return null;
  }

  const identity = {
    ail_id: ailId,
    display_name: source?.display_name ?? source?.displayName ?? null,
    role: source?.role ?? null
  };

  if (source?.owner_org ?? source?.ownerOrg) {
    identity.owner_org = source.owner_org ?? source.ownerOrg;
  }

  if (source?.reputation !== undefined) {
    identity.reputation = source.reputation;
  }

  return {
    ...identity,
    ...normalizeExpiry(source)
  };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function exchangeAilAuthCode(code, env, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;

  if (!code) {
    return { valid: false, status: 400, error: "missing_code" };
  }

  if (!env?.AIL_CLIENT_ID || !env?.AIL_CLIENT_SECRET) {
    return { valid: false, status: 500, error: "missing_ail_credentials" };
  }

  if (typeof fetchImpl !== "function") {
    return { valid: false, status: 500, error: "missing_fetch" };
  }

  let response;
  try {
    response = await fetchImpl(EXCHANGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        client_id: env.AIL_CLIENT_ID,
        client_secret: env.AIL_CLIENT_SECRET
      })
    });
  } catch {
    return { valid: false, status: 502, error: "exchange_unavailable" };
  }

  const payload = await readJson(response);
  const normalized = normalizeIdentityPayload(payload);
  const upstreamValid = payload?.valid;

  if (!response.ok || upstreamValid === false || !normalized) {
    return {
      valid: false,
      status: response.status || 401,
      error: payload?.error ?? payload?.message ?? "invalid_identity_exchange"
    };
  }

  return {
    valid: true,
    ...normalized
  };
}
