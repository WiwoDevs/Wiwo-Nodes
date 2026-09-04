/**
 * Identidad basada en Firebase, compartida con METRIQ.
 *
 * El navegador se autentica con Google (Firebase Auth) y envía el `idToken` a
 * `POST /api/auth/session`. Aquí se verifica ese token, se consulta la allowlist en
 * Firestore (`allowed_users/{email}`) y se emite una cookie de sesión httpOnly firmada
 * por Firebase. Cada solicitud posterior resuelve el actor desde esa cookie.
 *
 * La autorización proviene EXCLUSIVAMENTE de Firestore: no hay fallback por dominio.
 * Un correo sin documento en la allowlist no entra aunque su token de Google sea válido.
 * Es el mismo contrato que ya usa METRIQ, de modo que ambos productos comparten usuarios,
 * permisos y revocación sin duplicar administración.
 */
import type { ActorContext, ActorRole } from "./types.js";
import { ACTOR_ROLES } from "./types.js";

export interface FirebaseAuthConfig {
  enabled: boolean;
  projectId?: string;
  serviceAccountKey?: string;
  cookieName: string;
  sessionTtlMs: number;
  allowedUsersCollection: string;
  /** Permiso mínimo que debe tener el usuario en la allowlist para entrar a Nodes. */
  requiredPermission: string;
  /** Permiso que otorga rol admin dentro de Nodes. */
  adminPermission: string;
  /** Rol asignado a quien tiene `requiredPermission` pero no `adminPermission`. */
  defaultRole: ActorRole;
  tenantId: string;
}

/** Documento `allowed_users/{email}` tal como lo escribe METRIQ, más overrides de Nodes. */
export interface AllowedUserRecord {
  email: string;
  name: string | null;
  permissions: string[];
  /** Override opcional del rol dentro de Nodes; si falta se deriva de `permissions`. */
  nodesRole?: ActorRole;
  /** Override opcional del alcance de marcas; `"*"` o lista de brandIds. */
  nodesBrandIds?: string[] | "all";
}

export interface FirebaseSessionUser {
  uid: string;
  email: string;
  name: string | null;
}

export class FirebaseAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "FirebaseAuthError";
    this.status = status;
    this.code = code;
  }
}

/** Normaliza el email para usarlo como id de documento, igual que METRIQ. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Deriva el rol y el alcance de marcas desde la allowlist.
 *
 * `admin` en Firestore implica todo, igual que en METRIQ. Un override explícito
 * `nodesRole`/`nodesBrandIds` en el documento gana sobre la derivación, para poder
 * dar rol de agente a alguien sin tocar sus permisos del resto del portal.
 */
export function resolveActorFromAllowedUser(
  user: AllowedUserRecord,
  session: FirebaseSessionUser,
  config: FirebaseAuthConfig,
): ActorContext {
  const permissions = user.permissions.map((permission) => permission.trim().toLowerCase());
  const isAdmin = permissions.includes(config.adminPermission);
  const hasAccess = isAdmin || permissions.includes(config.requiredPermission);
  if (!hasAccess) {
    throw new FirebaseAuthError(
      403,
      "PERMISSION_REQUIRED",
      `La cuenta ${user.email} no tiene el permiso "${config.requiredPermission}" para Wiwo Nodes.`,
    );
  }

  const role: ActorRole = user.nodesRole && ACTOR_ROLES.includes(user.nodesRole)
    ? user.nodesRole
    : isAdmin
      ? "admin"
      : config.defaultRole;

  const brandIds: ActorContext["brandIds"] = user.nodesBrandIds === "all" || user.nodesBrandIds === undefined
    ? "all"
    : user.nodesBrandIds.length
      ? [...new Set(user.nodesBrandIds.map((id) => id.trim()).filter(Boolean))]
      : "all";

  return {
    userId: session.uid,
    displayName: user.name || session.name || user.email,
    tenantId: config.tenantId,
    role,
    // Un admin siempre ve el portafolio completo; el override solo restringe a no-admins.
    brandIds: role === "admin" ? "all" : brandIds,
    source: "firebase",
  };
}

interface AdminAuth {
  verifyIdToken(token: string): Promise<{ uid: string; email?: string; name?: unknown }>;
  createSessionCookie(idToken: string, options: { expiresIn: number }): Promise<string>;
  verifySessionCookie(cookie: string, checkRevoked: boolean): Promise<{ uid: string; email?: string; name?: unknown }>;
}

interface AdminFirestore {
  collection(name: string): {
    doc(id: string): { get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }> };
  };
}

export interface FirebaseAuthService {
  readonly config: FirebaseAuthConfig;
  /** Canjea un idToken de Google por una cookie de sesión. Lanza si no está autorizado. */
  createSession(idToken: string): Promise<{ cookie: string; actor: ActorContext; user: FirebaseSessionUser }>;
  /** Resuelve el actor desde la cookie de sesión. Lanza 401 si no es válida. */
  resolveActor(cookieValue: string): Promise<ActorContext>;
}

function parseServiceAccount(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  // Acepta el JSON crudo o codificado en base64, que es como suele viajar en un gestor de secretos.
  const decoded = trimmed.startsWith("{")
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY debe ser el JSON de la cuenta de servicio (crudo o base64).");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY no contiene un objeto JSON válido.");
  }
  return parsed as Record<string, unknown>;
}

function allowedUserFromDocument(
  email: string,
  data: Record<string, unknown>,
): AllowedUserRecord {
  const rawPermissions = Array.isArray(data.permissions) ? data.permissions : [];
  const permissions = rawPermissions.filter((value): value is string => typeof value === "string");
  // Compatibilidad con documentos legacy de METRIQ que aún usan `role` en vez de `permissions`.
  if (!permissions.length && typeof data.role === "string") permissions.push(data.role);

  const rawRole = typeof data.nodesRole === "string" ? data.nodesRole.toLowerCase() : undefined;
  const nodesRole = rawRole && (ACTOR_ROLES as readonly string[]).includes(rawRole)
    ? rawRole as ActorRole
    : undefined;

  const rawBrands = data.nodesBrandIds;
  const nodesBrandIds: AllowedUserRecord["nodesBrandIds"] = rawBrands === "*" || rawBrands === "all"
    ? "all"
    : Array.isArray(rawBrands)
      ? rawBrands.filter((value): value is string => typeof value === "string")
      : undefined;

  return {
    email,
    name: typeof data.name === "string" ? data.name : null,
    permissions,
    nodesRole,
    nodesBrandIds,
  };
}

/**
 * Construye el servicio de identidad. Devuelve `undefined` cuando Firebase no está
 * configurado, para que el entorno local siga funcionando con el actor por defecto.
 */
export async function createFirebaseAuth(
  config: FirebaseAuthConfig,
): Promise<FirebaseAuthService | undefined> {
  if (!config.enabled) return undefined;
  if (!config.serviceAccountKey) {
    throw new Error("SAC_FLOW_AUTH_MODE=firebase requiere FIREBASE_SERVICE_ACCOUNT_KEY.");
  }

  const credentials = parseServiceAccount(config.serviceAccountKey);
  // Import dinámico: firebase-admin solo se carga cuando la identidad está activa,
  // de modo que el modo local/demo no paga su costo de arranque.
  const [{ cert, getApps, initializeApp }, { getAuth }, { getFirestore }] = await Promise.all([
    import("firebase-admin/app"),
    import("firebase-admin/auth"),
    import("firebase-admin/firestore"),
  ]);

  const appName = "sac-flow-auth";
  const existing = getApps().find((app) => app.name === appName);
  const app = existing || initializeApp(
    {
      credential: cert(credentials as never),
      projectId: config.projectId || (credentials.project_id as string | undefined),
    },
    appName,
  );

  const auth = getAuth(app) as unknown as AdminAuth;
  const firestore = getFirestore(app) as unknown as AdminFirestore;

  async function loadAllowedUser(email: string): Promise<AllowedUserRecord> {
    const normalized = normalizeEmail(email);
    const snapshot = await firestore.collection(config.allowedUsersCollection).doc(normalized).get();
    if (!snapshot.exists) {
      throw new FirebaseAuthError(
        403,
        "ACCOUNT_NOT_ALLOWED",
        `La cuenta ${normalized} no está autorizada. Pide a un administrador que te agregue.`,
      );
    }
    return allowedUserFromDocument(normalized, snapshot.data() ?? {});
  }

  return {
    config,

    async createSession(idToken) {
      let decoded: { uid: string; email?: string; name?: unknown };
      try {
        decoded = await auth.verifyIdToken(idToken);
      } catch {
        throw new FirebaseAuthError(401, "INVALID_TOKEN", "El token de Google no es válido o expiró.");
      }
      if (!decoded.email) {
        throw new FirebaseAuthError(401, "EMAIL_REQUIRED", "La cuenta de Google no expone un correo.");
      }
      const session: FirebaseSessionUser = {
        uid: decoded.uid,
        email: normalizeEmail(decoded.email),
        name: typeof decoded.name === "string" ? decoded.name : null,
      };
      const allowed = await loadAllowedUser(session.email);
      const actor = resolveActorFromAllowedUser(allowed, session, config);

      let cookie: string;
      try {
        cookie = await auth.createSessionCookie(idToken, { expiresIn: config.sessionTtlMs });
      } catch {
        throw new FirebaseAuthError(500, "SESSION_FAILED", "No fue posible crear la sesión.");
      }
      return { cookie, actor, user: session };
    },

    async resolveActor(cookieValue) {
      let decoded: { uid: string; email?: string; name?: unknown };
      try {
        // checkRevoked=true para que revocar en Firebase corte la sesión de inmediato.
        decoded = await auth.verifySessionCookie(cookieValue, true);
      } catch {
        throw new FirebaseAuthError(401, "SESSION_INVALID", "La sesión expiró o fue revocada. Inicia sesión de nuevo.");
      }
      if (!decoded.email) {
        throw new FirebaseAuthError(401, "SESSION_INVALID", "La sesión no contiene un correo válido.");
      }
      const session: FirebaseSessionUser = {
        uid: decoded.uid,
        email: normalizeEmail(decoded.email),
        name: typeof decoded.name === "string" ? decoded.name : null,
      };
      // Se relee la allowlist en cada solicitud: quitar un permiso en Firestore surte
      // efecto sin esperar a que expire la cookie.
      const allowed = await loadAllowedUser(session.email);
      return resolveActorFromAllowedUser(allowed, session, config);
    },
  };
}
