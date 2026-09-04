import { describe, expect, it } from "vitest";
import { normalizeDiscoveredBrands } from "../../server/metricool-brands.js";

/** Recorte real de `/admin/simpleProfiles`, sin datos sensibles. */
const sample = [
  {
    id: 457689,
    userId: 147871,
    ownerUserId: 147871,
    label: "stevemaddenchile",
    title: null,
    picture: "https://example.test/logo.jpg",
    twitter: null,
    facebook: "172549979586083",
    facebookPageId: "172549979586083",
    instagram: "stevemaddencl",
    fbBusinessId: "17841401602319559",
    linkedinCompany: null,
    youtube: null,
    gmb: null,
  },
  {
    id: 877033,
    userId: 147871,
    label: "umbrochile",
    instagram: "umbro.cl",
    facebook: null,
    twitter: null,
    youtube: "UC123",
  },
];

describe("normalizeDiscoveredBrands", () => {
  it("extrae blogId, userId y etiqueta de cada marca", () => {
    const brands = normalizeDiscoveredBrands(sample);
    expect(brands).toHaveLength(2);
    const steve = brands.find((brand) => brand.blogId === "457689");
    expect(steve?.userId).toBe("147871");
    expect(steve?.label).toBe("stevemaddenchile");
    expect(steve?.instagramHandle).toBe("stevemaddencl");
  });

  it("deduce las redes conectadas desde los campos con identificador", () => {
    const brands = normalizeDiscoveredBrands(sample);
    const steve = brands.find((brand) => brand.blogId === "457689");
    expect(steve?.channels).toEqual(expect.arrayContaining(["instagram", "facebook"]));
    expect(steve?.channels).not.toContain("x");
    expect(steve?.channels).not.toContain("youtube");

    const umbro = brands.find((brand) => brand.blogId === "877033");
    expect(umbro?.channels).toEqual(expect.arrayContaining(["instagram", "youtube"]));
    expect(umbro?.channels).not.toContain("facebook");
  });

  it("acepta la respuesta envuelta en data y ordena por etiqueta", () => {
    const brands = normalizeDiscoveredBrands({ data: sample });
    expect(brands.map((brand) => brand.label)).toEqual(["stevemaddenchile", "umbrochile"]);
  });

  it("descarta entradas sin id o sin userId en vez de inventar referencias", () => {
    const brands = normalizeDiscoveredBrands([
      { label: "sin id", userId: 147871 },
      { id: 999, label: "sin userId" },
      ...sample,
    ]);
    expect(brands).toHaveLength(2);
  });

  it("tolera una respuesta inesperada sin lanzar", () => {
    expect(normalizeDiscoveredBrands(null)).toEqual([]);
    expect(normalizeDiscoveredBrands({ error: "boom" })).toEqual([]);
    expect(normalizeDiscoveredBrands("texto")).toEqual([]);
  });

  it("usa el handle de Instagram como etiqueta cuando no hay label", () => {
    const brands = normalizeDiscoveredBrands([{ id: 1, userId: 2, instagram: "marca.cl" }]);
    expect(brands[0]?.label).toBe("marca.cl");
  });
});
