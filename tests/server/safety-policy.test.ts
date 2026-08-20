import { describe, expect, it } from "vitest";
import {
  ensureMandatoryHumanReviewCategories,
  isMandatoryHumanReviewCategory,
  MANDATORY_HUMAN_REVIEW_CATEGORIES,
  requiresHumanReview,
} from "../../server/safety-policy.js";
import type { Interaction, Workflow } from "../../server/types.js";

const interaction = (overrides: Partial<Interaction> = {}): Interaction => ({
  id: "interaction-policy",
  externalId: "external-policy",
  brandId: "brand-policy",
  accountId: "account-policy",
  channel: "instagram",
  type: "dm",
  direction: "inbound",
  customerName: "Cliente",
  customerHandle: "cliente",
  text: "Consulta",
  category: "preventa",
  sentiment: "neutral",
  confidence: 0.99,
  status: "new",
  source: "demo",
  version: 1,
  createdAt: "2026-08-12T12:00:00.000Z",
  updatedAt: "2026-08-12T12:00:00.000Z",
  internalNotes: [],
  audit: [],
  ...overrides,
});

const workflow: Pick<Workflow, "minimumConfidence" | "requireHumanFor"> = {
  minimumConfidence: 0.82,
  requireHumanFor: [],
};

describe("mandatory human-review policy", () => {
  it("normalizes aliases and cannot remove mandatory categories", () => {
    expect(isMandatoryHumanReviewCategory("Datos personales")).toBe(true);
    expect(isMandatoryHumanReviewCategory("RECLAMO CRÍTICO")).toBe(true);
    const categories = ensureMandatoryHumanReviewCategories(["VIP", "legal", "vip"]);
    expect(categories).toContain("vip");
    expect(categories).toEqual(expect.arrayContaining([...MANDATORY_HUMAN_REVIEW_CATEGORIES]));
  });

  it.each(["legal", "pago", "fraude", "amenaza", "salud", "datos personales", "reclamo crítico"])(
    "always requires human review for %s",
    (category) => {
      expect(requiresHumanReview(interaction({ category }), workflow)).toBe(true);
    },
  );

  it("also blocks negative sentiment, configured categories and low confidence", () => {
    expect(requiresHumanReview(interaction({ sentiment: "negative" }), workflow)).toBe(true);
    expect(requiresHumanReview(interaction({ category: "cliente_vip" }), {
      ...workflow,
      requireHumanFor: ["Cliente VIP"],
    })).toBe(true);
    expect(requiresHumanReview(interaction({ confidence: 0.5 }), workflow)).toBe(true);
    expect(requiresHumanReview(interaction(), workflow)).toBe(false);
  });
});
