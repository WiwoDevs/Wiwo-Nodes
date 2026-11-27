/**
 * Sesión de WhatsApp (Baileys) cifrada en disco. Mismo esquema de archivos que
 * `useMultiFileAuthState` de Baileys (un archivo por credencial o clave), pero cada archivo va
 * cifrado (`.enc`, ver at-rest.ts). Una sesión guardada antes en texto plano (`.json`) se lee y
 * se migra sola al primer uso, así que un número ya vinculado no tiene que volver a escanear.
 */
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { decryptAtRest, encryptAtRest } from "./at-rest.js";

/** Nombre que usaba `useMultiFileAuthState` (puede incluir números de teléfono). */
function legacyFileName(name: string): string {
  return name.replace(/\//g, "__").replace(/:/g, "-");
}

/** Cola por archivo: Baileys lee y escribe en paralelo y un archivo no puede quedar a medias. */
function createLocks() {
  const tails = new Map<string, Promise<unknown>>();
  return async <T>(path: string, operation: () => Promise<T>): Promise<T> => {
    const previous = tails.get(path) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    tails.set(path, result.catch(() => undefined));
    return result;
  };
}

export async function useEncryptedFileAuthState(
  folder: string,
  key: Buffer,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const withLock = createLocks();
  // Los archivos cifrados se nombran con un hash: los nombres de Baileys llevan teléfonos.
  const encryptedFor = (legacyBase: string) => join(folder, `${createHmac("sha256", key).update(legacyBase).digest("hex").slice(0, 40)}.enc`);
  const encryptedPath = (name: string) => encryptedFor(legacyFileName(name));
  const legacyPath = (name: string) => join(folder, `${legacyFileName(name)}.json`);

  // Migración de una sesión guardada en texto plano: se cifra toda la carpeta de una vez.
  for (const entry of await readdir(folder).catch(() => [] as string[])) {
    if (!entry.endsWith(".json")) continue;
    const base = entry.slice(0, -".json".length);
    const plain = await readFile(join(folder, entry)).catch(() => undefined);
    if (!plain) continue;
    const target = encryptedFor(base);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, encryptAtRest(key, plain), { mode: 0o600 });
    await rename(temporary, target);
    await unlink(join(folder, entry)).catch(() => undefined);
  }

  const write = async (data: unknown, name: string) => {
    const target = encryptedPath(name);
    await withLock(target, async () => {
      const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, encryptAtRest(key, Buffer.from(JSON.stringify(data, BufferJSON.replacer))), { mode: 0o600 });
      await rename(temporary, target);
    });
    // Si quedaba la versión en texto plano, se borra apenas existe la cifrada.
    await unlink(legacyPath(name)).catch(() => undefined);
  };

  const read = async (name: string): Promise<unknown> => {
    const target = encryptedPath(name);
    const encrypted = await withLock(target, async () => readFile(target).catch(() => undefined));
    if (encrypted) return JSON.parse(decryptAtRest(key, encrypted).toString("utf8"), BufferJSON.reviver);
    // Sesión anterior en texto plano (useMultiFileAuthState): se lee y se cifra.
    const legacy = await readFile(legacyPath(name), "utf8").catch(() => undefined);
    if (legacy === undefined) return null;
    const value: unknown = JSON.parse(legacy, BufferJSON.reviver);
    await write(value, name);
    return value;
  };

  const remove = async (name: string) => {
    const target = encryptedPath(name);
    await withLock(target, async () => unlink(target).catch(() => undefined));
    await unlink(legacyPath(name)).catch(() => undefined);
  };

  const creds = ((await read("creds")) as AuthenticationCreds | null) ?? initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {};
          await Promise.all(ids.map(async (id) => {
            let value = await read(`${type}-${id}`);
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value as Record<string, unknown>);
            }
            data[id] = value as SignalDataTypeMap[T];
          }));
          return data;
        },
        set: async (data) => {
          const tasks: Array<Promise<void>> = [];
          for (const category of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
            const entries = data[category] ?? {};
            for (const id of Object.keys(entries)) {
              const value = entries[id];
              const name = `${category}-${id}`;
              tasks.push(value ? write(value, name) : remove(name));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => write(creds, "creds"),
  };
}
