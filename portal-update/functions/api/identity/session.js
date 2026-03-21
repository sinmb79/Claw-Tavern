import { verifyAilJwt as defaultVerifyAilJwt } from "../../_lib/ail-verifier.js";
import {
  clearSessionCookie as defaultClearSessionCookie,
  issueSessionCookie as defaultIssueSessionCookie,
  readSessionCookie as defaultReadSessionCookie
} from "../../_lib/session-cookie.js";

function jsonResponse(payload, status, headers = {}) {
  return Response.json(payload, {
    status,
    headers
  });
}

function getSessionSecret(env) {
  return typeof env?.CT_SESSION_SECRET === "string" && env.CT_SESSION_SECRET.trim() !== ""
    ? env.CT_SESSION_SECRET.trim()
    : null;
}

function mapVerificationStatus(errorCode) {
  if (errorCode === "expired-jwt") {
    return 401;
  }

  if (errorCode === "invalid-jwt" || errorCode === "missing-jwt") {
    return 400;
  }

  return 502;
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function buildIdentityPayload(source) {
  return {
    ail_id: source.ail_id,
    display_name: source.display_name,
    verified_at: source.verified_at,
    expires_at: source.expires_at
  };
}

export function createIdentitySessionHandlers(deps = {}) {
  const verifyAilJwt = deps.verifyAilJwt ?? defaultVerifyAilJwt;
  const issueSessionCookie = deps.issueSessionCookie ?? defaultIssueSessionCookie;
  const readSessionCookie = deps.readSessionCookie ?? defaultReadSessionCookie;
  const clearSessionCookie = deps.clearSessionCookie ?? defaultClearSessionCookie;

  return {
    async onRequestGet(context) {
      const session = await readSessionCookie(
        context.request.headers.get("cookie"),
        getSessionSecret(context.env)
      );

      if (!session) {
        return jsonResponse({ verified: false }, 200);
      }

      return jsonResponse(
        {
          verified: true,
          identity: buildIdentityPayload(session)
        },
        200
      );
    },

    async onRequestPost(context) {
      const body = await readJsonBody(context.request);
      const jwt = typeof body?.jwt === "string" ? body.jwt.trim() : "";

      if (!jwt) {
        return jsonResponse(
          {
            verified: false,
            error: "missing-jwt"
          },
          400
        );
      }

      const verification = await verifyAilJwt(jwt);

      if (!verification?.valid) {
        return jsonResponse(
          {
            verified: false,
            error: verification?.error ?? "invalid-jwt"
          },
          mapVerificationStatus(verification?.error)
        );
      }

      const sessionSecret = getSessionSecret(context.env);

      if (!sessionSecret) {
        return jsonResponse(
          {
            verified: false,
            error: "server-misconfigured"
          },
          500
        );
      }

      const identity = buildIdentityPayload(verification);
      const setCookie = await issueSessionCookie(identity, sessionSecret);

      return jsonResponse(
        {
          verified: true,
          identity
        },
        200,
        {
          "set-cookie": setCookie
        }
      );
    },

    async onRequestDelete() {
      return new Response(null, {
        status: 204,
        headers: {
          "set-cookie": clearSessionCookie()
        }
      });
    }
  };
}

const handlers = createIdentitySessionHandlers();

export const onRequestGet = handlers.onRequestGet;
export const onRequestPost = handlers.onRequestPost;
export const onRequestDelete = handlers.onRequestDelete;
