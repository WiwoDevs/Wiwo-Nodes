import type { Interaction, Workflow } from "./types.js";

export const MANDATORY_HUMAN_REVIEW_CATEGORIES = [
  "amenaza",
  "crisis",
  "datos_personales",
  "fraude",
  "legal",
  "pago",
  "reclamo",
  "reclamo_critico",
  "salud",
  "seguridad",
] as const;

function canonicalCategory(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isMandatoryHumanReviewCategory(category: string): boolean {
  const normalized = canonicalCategory(category);
  return (MANDATORY_HUMAN_REVIEW_CATEGORIES as readonly string[]).includes(normalized);
}

export function ensureMandatoryHumanReviewCategories(categories: string[]): string[] {
  const byCanonical = new Map<string, string>();
  for (const category of [...MANDATORY_HUMAN_REVIEW_CATEGORIES, ...categories]) {
    const normalized = canonicalCategory(category);
    if (normalized && !byCanonical.has(normalized)) byCanonical.set(normalized, normalized);
  }
  return [...byCanonical.values()].sort();
}

export function requiresHumanReview(
  interaction: Interaction,
  workflow: Pick<Workflow, "minimumConfidence" | "requireHumanFor">,
  confidence = interaction.confidence,
): boolean {
  const configured = new Set(workflow.requireHumanFor.map(canonicalCategory));
  const category = canonicalCategory(interaction.category);
  return interaction.sentiment === "negative"
    || isMandatoryHumanReviewCategory(category)
    || configured.has(category)
    || confidence < workflow.minimumConfidence;
}
