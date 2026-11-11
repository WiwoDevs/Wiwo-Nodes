/** Time-of-day salutation in Spanish, matching the WIWO apps ("Buenos días, …"). */
export function salutationFor(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

/**
 * First name to greet the signed-in user with. The actor display name can be a full name
 * (Firestore allowlist / Google profile), an email, or the local development actor.
 * Returns null when there is nothing personal to show, so the UI can fall back to a plain greeting.
 */
export function greetingNameOf(displayName: string | null | undefined): string | null {
  const raw = displayName?.trim();
  if (!raw) return null;
  // Local development and gateway placeholders are roles, not people.
  if (/^(administrador local|usuario gateway)$/i.test(raw)) return null;
  const base = raw.includes("@") ? raw.split("@")[0].replace(/[._-]+/g, " ") : raw;
  const first = base.split(/\s+/).find(Boolean);
  if (!first) return null;
  return first.charAt(0).toLocaleUpperCase("es") + first.slice(1);
}
