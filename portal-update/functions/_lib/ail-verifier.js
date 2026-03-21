const DEFAULT_AIL_SERVER_URL = "https://api.agentidcard.org";

function normalizeString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function pickFirstString(source, keys) {
  for (const key of keys) {
    const value = normalizeString(source?.[key]);

    if (value) {
      return value;
    }
  }

  return null;
}

function normalizeTimestamp(value) {
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Date.parse(value);

    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const timestampMs = value > 1e12 ? value : value * 1000;

    return new Date(timestampMs).toISOString();
  }

  return null;
}

function isExpiredTimestamp(isoTimestamp) {
  return typeof isoTimestamp === "string" && Date.parse(isoTimestamp) <= Date.now();
}

function classifyFailure(detail) {
  return /expir/i.test(detail ?? "") ? "expired-jwt" : "invalid-jwt";
}

function normalizeFailure(detail) {
  return {
    valid: false,
    error: classifyFailure(detail)
  };
}

function normalizeSuccess(rawResult) {
  const ailId = pickFirstString(rawResult, ["ail_id"]);
  const displayName = pickFirstString(rawResult, ["display_name"]);
  const verifiedAt =
    normalizeTimestamp(rawResult?.verified_at) ??
    normalizeTimestamp(rawResult?.issued_at) ??
    normalizeTimestamp(rawResult?.issued) ??
    normalizeTimestamp(rawResult?.iat) ??
    new Date().toISOString();
  const expiresAt =
    normalizeTimestamp(rawResult?.expires_at) ??
    normalizeTimestamp(rawResult?.expires) ??
    normalizeTimestamp(rawResult?.exp);

  if (!ailId || !displayName || !expiresAt) {
    return normalizeFailure("invalid verification payload");
  }

  if (isExpiredTimestamp(expiresAt)) {
    return normalizeFailure("expired");
  }

  return {
    valid: true,
    ail_id: ailId,
    display_name: displayName,
    verified_at: verifiedAt,
    expires_at: expiresAt
  };
}

function normalizeVerificationResult(rawResult) {
  if (!rawResult || typeof rawResult !== "object") {
    return normalizeFailure("empty verification result");
  }

  if (rawResult.valid !== true) {
    return normalizeFailure(
      pickFirstString(rawResult, ["error", "reason", "message"]) ?? "invalid verification result"
    );
  }

  return normalizeSuccess(rawResult);
}

async function loadSdk(providedSdk) {
  if (providedSdk) {
    return providedSdk;
  }

  try {
    return await import("@agentidcard/sdk");
  } catch {
    return null;
  }
}

async function verifyWithSdk(jwt, options = {}) {
  if (options.client?.verify) {
    return options.client.verify(jwt);
  }

  const sdk = await loadSdk(options.sdk);

  if (!sdk?.AilClient) {
    return null;
  }

  const client = new sdk.AilClient({
    serverUrl: options.serverUrl ?? DEFAULT_AIL_SERVER_URL
  });

  return client.verify(jwt);
}

async function verifyWithHttp(jwt, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error("fetch unavailable");
  }

  const response = await fetchImpl(`${options.serverUrl ?? DEFAULT_AIL_SERVER_URL}/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ token: jwt })
  });
  const rawResult = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      pickFirstString(rawResult, ["message", "error", "reason"]) ?? `HTTP ${response.status}`
    );
    error.status = response.status;
    throw error;
  }

  return rawResult;
}

export async function verifyAilJwt(jwt, options = {}) {
  const normalizedJwt = normalizeString(jwt);

  if (!normalizedJwt) {
    return normalizeFailure("missing jwt");
  }

  try {
    const sdkResult = await verifyWithSdk(normalizedJwt, options);

    if (sdkResult) {
      return normalizeVerificationResult(sdkResult);
    }
  } catch (error) {
    if (error?.status === 400 || error?.status === 401) {
      return normalizeFailure(error.message);
    }
  }

  try {
    const httpResult = await verifyWithHttp(normalizedJwt, options);

    return normalizeVerificationResult(httpResult);
  } catch (error) {
    if (error?.status === 400 || error?.status === 401) {
      return normalizeFailure(error.message);
    }

    return {
      valid: false,
      error: "verification-unavailable"
    };
  }
}
