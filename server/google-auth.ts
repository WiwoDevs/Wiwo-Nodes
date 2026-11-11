/**
 * Inicio de sesión con Google (OAuth 2.0 + OpenID Connect, flujo de código con PKCE).
 *
 * 1. `start()` genera state, nonce y code_verifier, los guarda en una cookie firmada de
 *    corta duración y devuelve la URL de autorización de Google.
 * 2. Google vuelve a `GOOGLE_OAUTH_REDIRECT_URI` con `code` y `state`. `complete()` comprueba
 *    el state contra la cookie, canjea el código (con el client secret y el verifier),
 *    verifica la firma, audiencia, emisor, vigencia y nonce del id_token, y exige un correo
 *    verificado. Recién entonces consulta la allowlist y emite la cookie de sesión.
 *
 * El client secret solo vive en el servidor; el navegador nunca recibe tokens de Google.
 */
import { randomBytes } from "node:crypto";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import {
  createSigner,
  findAllowedUser,
  IdentityError,
  normalizeEmail,
  resolveActorFromAllowedUser,
  type IdentityConfig,
  type IdentityService,
  type SessionUser,
} from "./identity.js";

const FLOW_TTL_MS = 10 * 60 * 1_000;

/** Lo mínimo que se usa del cliente OAuth; permite simularlo en pruebas. */
export interface GoogleOAuthClient {
  generateCodeVerifierAsync(): Promise<{ codeVerifier: string; codeChallenge?: string }>;
  generateAuthUrl(options: Record<string, unknown>): string;
  getToken(options: { code: string; codeVerifier: string }): Promise<{ tokens: { id_token?: string | null } }>;
  verifyIdToken(options: { idToken: string; audience: string }): Promise<{ getPayload(): Record<string, unknown> | undefined }>;
}

export function createGoogleIdentity(config: IdentityConfig, client?: GoogleOAuthClient): IdentityService {
  const google = config.google;
  if (!google) throw new Error("SAC_FLOW_AUTH_MODE=google requiere GOOGLE_OAUTH_CLIENT_ID y GOOGLE_OAUTH_CLIENT_SECRET.");
  const oauth: GoogleOAuthClient = client ?? new OAuth2Client({
    clientId: google.clientId,
    clientSecret: google.clientSecret,
    redirectUri: google.redirectUri,
  }) as unknown as GoogleOAuthClient;
  const signer = createSigner(config.sessionSecret);

  function sessionCookie(user: SessionUser): string {
    return signer.seal({ uid: user.uid, email: user.email, name: user.name, exp: Date.now() + config.sessionTtlMs });
  }

  return {
    config,

    google: {
      async start() {
        const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync();
        const state = randomBytes(24).toString("base64url");
        const nonce = randomBytes(24).toString("base64url");
        const url = oauth.generateAuthUrl({
          access_type: "online",
          scope: ["openid", "email", "profile"],
          state,
          nonce,
          code_challenge: codeChallenge,
          code_challenge_method: CodeChallengeMethod.S256,
          prompt: "select_account",
        });
        const flowCookie = signer.seal({ state, nonce, verifier: codeVerifier, exp: Date.now() + FLOW_TTL_MS });
        return { url, flowCookie };
      },

      async complete(params, flowCookie) {
        if (params.error) {
          throw new IdentityError(401, params.error === "access_denied" ? "GOOGLE_CANCELLED" : "GOOGLE_ERROR", "Google no completó el inicio de sesión.");
        }
        const flow = signer.open<{ state: string; nonce: string; verifier: string }>(flowCookie);
        if (!flow || !params.state || params.state !== flow.state) {
          throw new IdentityError(401, "OAUTH_STATE_INVALID", "El intento de inicio de sesión expiró. Vuelve a intentarlo.");
        }
        if (!params.code) throw new IdentityError(400, "OAUTH_CODE_MISSING", "Google no devolvió un código de autorización.");

        let payload: Record<string, unknown> | undefined;
        try {
          const { tokens } = await oauth.getToken({ code: params.code, codeVerifier: flow.verifier });
          if (!tokens.id_token) throw new Error("sin id_token");
          const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: google.clientId });
          payload = ticket.getPayload();
        } catch {
          throw new IdentityError(401, "GOOGLE_TOKEN_INVALID", "No fue posible validar la respuesta de Google.");
        }
        if (!payload || payload.nonce !== flow.nonce) {
          throw new IdentityError(401, "GOOGLE_TOKEN_INVALID", "No fue posible validar la respuesta de Google.");
        }
        if (typeof payload.email !== "string" || payload.email_verified !== true) {
          throw new IdentityError(401, "EMAIL_NOT_VERIFIED", "La cuenta de Google no tiene un correo verificado.");
        }
        const user: SessionUser = {
          uid: `google:${String(payload.sub ?? payload.email)}`,
          email: normalizeEmail(payload.email),
          name: typeof payload.name === "string" ? payload.name : null,
        };
        const allowed = await findAllowedUser(config, user.email, user.name);
        const actor = resolveActorFromAllowedUser(allowed, user, config, "google");
        return { cookie: sessionCookie(user), actor, user };
      },
    },

    async resolveActor(cookieValue) {
      const session = signer.open<{ uid: string; email: string; name: string | null }>(cookieValue);
      if (!session || typeof session.email !== "string" || typeof session.uid !== "string") {
        throw new IdentityError(401, "SESSION_INVALID", "La sesión expiró o fue revocada. Inicia sesión de nuevo.");
      }
      const user: SessionUser = { uid: session.uid, email: session.email, name: session.name ?? null };
      // Se relee la allowlist en cada solicitud: quitar a alguien corta su sesión de inmediato.
      const allowed = await findAllowedUser(config, user.email, user.name);
      return resolveActorFromAllowedUser(allowed, user, config, "google");
    },
  };
}
