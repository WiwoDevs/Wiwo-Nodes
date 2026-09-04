/**
 * Firebase en el navegador. Se usa solo para el login con Google: obtener un idToken
 * que el servidor canjea por una cookie httpOnly. Ningún dato de la aplicación se lee
 * desde Firebase en el cliente, y el idToken nunca se guarda en localStorage.
 *
 * Es el mismo proyecto Firebase que METRIQ, de modo que la allowlist de Firestore
 * gobierna ambos productos.
 *
 * El SDK se importa de forma diferida: quien llega con una sesión válida nunca lo
 * descarga, que es el caso habitual una vez iniciada la jornada.
 */
import type { Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** true cuando el entorno trae configuración de Firebase; si no, la app corre en modo local. */
export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let cachedAuth: Auth | undefined;

async function browserAuth(): Promise<Auth> {
  if (cachedAuth) return cachedAuth;
  const [{ getApp, getApps, initializeApp }, { getAuth }] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig as never);
  cachedAuth = getAuth(app);
  return cachedAuth;
}

/** Abre el popup de Google y devuelve el idToken recién emitido. */
export async function signInWithGoogle(): Promise<string> {
  const [auth, { GoogleAuthProvider, signInWithPopup }] = await Promise.all([
    browserAuth(),
    import("firebase/auth"),
  ]);
  const provider = new GoogleAuthProvider();
  // Forzar el selector de cuenta evita entrar con la cuenta equivocada de forma silenciosa.
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth, provider);
  return result.user.getIdToken();
}

/** Cierra la sesión del SDK del navegador. La cookie del servidor se borra aparte. */
export async function signOutFromGoogle(): Promise<void> {
  if (!firebaseConfigured || !cachedAuth) return;
  const { signOut } = await import("firebase/auth");
  await signOut(cachedAuth).catch(() => undefined);
}
