/**
 * Identidad de PRUEBA LOCAL con correo y contraseña (`SAC_FLOW_AUTH_MODE=dev`).
 *
 * Permite probar el inicio de sesión, roles, alcance de marcas y cierre de sesión sin
 * credenciales de Google. Los usuarios son ficticios y viven en un archivo JSON
 * (`SAC_FLOW_DEV_AUTH_USERS_FILE`, por defecto `dev-users.example.json`) con el mismo
 * formato que la allowlist más una contraseña de prueba.
 *
 * `loadConfig` rechaza este modo cuando NODE_ENV=production.
 */
import { randomBytes } from "node:crypto";
import {
  allowedUserFromRecord,
  createSigner,
  IdentityError,
  normalizeEmail,
  readUsersFile,
  resolveActorFromAllowedUser,
  sameSecret,
  type AllowedUserRecord,
  type IdentityConfig,
  type IdentityService,
  type SessionUser,
} from "./identity.js";

type DevUserRecord = AllowedUserRecord & { password: string };

async function loadDevUsers(file: string): Promise<DevUserRecord[]> {
  return (await readUsersFile(file)).flatMap((entry) => {
    const record = allowedUserFromRecord(entry);
    return record && typeof entry.password === "string" && entry.password ? [{ ...record, password: entry.password }] : [];
  });
}

export function createDevAuth(config: IdentityConfig, usersFile: string): IdentityService {
  const signer = createSigner(config.sessionSecret);
  const sessionUser = (user: DevUserRecord): SessionUser => ({ uid: `dev:${user.email}`, email: user.email, name: user.name });

  return {
    config,

    async createPasswordSession(email, password) {
      const normalized = normalizeEmail(email);
      const user = (await loadDevUsers(usersFile)).find((candidate) => candidate.email === normalized);
      // Se compara siempre, aunque el correo no exista, para no filtrar cuáles existen por tiempo.
      const valid = sameSecret(password, user?.password ?? randomBytes(16).toString("hex")) && Boolean(user);
      if (!user || !valid) {
        throw new IdentityError(401, "INVALID_CREDENTIALS", "Correo o contraseña incorrectos.");
      }
      const session = sessionUser(user);
      const actor = resolveActorFromAllowedUser(user, session, config, "dev");
      const cookie = signer.seal({ email: user.email, exp: Date.now() + config.sessionTtlMs });
      return { cookie, actor, user: session };
    },

    async resolveActor(cookieValue) {
      const session = signer.open<{ email: string }>(cookieValue);
      if (!session || typeof session.email !== "string") {
        throw new IdentityError(401, "SESSION_INVALID", "La sesión expiró o fue revocada. Inicia sesión de nuevo.");
      }
      // Igual que con la allowlist real: se relee en cada solicitud, así quitar un usuario
      // o un permiso surte efecto sin esperar a que expire la cookie.
      const user = (await loadDevUsers(usersFile)).find((candidate) => candidate.email === session.email);
      if (!user) {
        throw new IdentityError(403, "ACCOUNT_NOT_ALLOWED", `La cuenta ${session.email} ya no está autorizada.`);
      }
      return resolveActorFromAllowedUser(user, sessionUser(user), config, "dev");
    },
  };
}
