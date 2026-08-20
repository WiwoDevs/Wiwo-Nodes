import { expect, test } from "@playwright/test";
import type { InteractionContentContext } from "../../src/types";

async function expectNamedControls(page: import("@playwright/test").Page) {
  const unnamed = await page.locator("button:visible, input:visible, select:visible, textarea:visible").evaluateAll((controls) =>
    controls.flatMap((control) => {
      const element = control as HTMLElement;
      const labelled = element.getAttribute("aria-label")
        || element.getAttribute("aria-labelledby")
        || element.getAttribute("title")
        || element.closest("label")?.textContent?.trim()
        || (element.tagName === "BUTTON" ? element.textContent?.trim() : "");
      return labelled ? [] : [`${element.tagName.toLowerCase()}.${element.className}`];
    }),
  );
  expect(unnamed).toEqual([]);
}

async function openSacFlow(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Flujo SAC", exact: true }).click();
  await expect(page.getByRole("heading", { name: "SAC Multicuenta · Metricool" })).toBeVisible();
}

function mockReplyTarget(postContext?: {
  postId: string;
  permalink?: string;
  caption?: string;
  thumbnailUrl?: string;
  publishedAt?: string;
}) {
  return {
    id: "mock-comment-1",
    externalId: "metricool-comment-1",
    brandId: "brand-01",
    brandName: "Converse",
    accountId: "account-01",
    accountHandle: "@converse",
    channel: "instagram",
    type: "comment",
    direction: "inbound",
    customerName: "Ana Cliente",
    customerHandle: "@ana.cliente",
    text: "¿Tienen stock de este modelo?",
    category: "consulta_producto",
    sentiment: "neutral",
    confidence: 0.96,
    status: "pending",
    source: "metricool",
    version: 3,
    createdAt: "2026-08-17T12:00:00.000Z",
    audit: [],
    contentContext: { kind: "text" } as InteractionContentContext,
    postContext,
  };
}

function mockInboxContact(messageCount = 3, postContext?: ReturnType<typeof mockReplyTarget>["postContext"]) {
  const replyTarget = mockReplyTarget(postContext);
  return {
    contactKey: "brand-01:account-01:instagram:ana-cliente",
    brandId: "brand-01",
    accountId: "account-01",
    channel: "instagram",
    customerName: "Ana Cliente",
    customerHandle: "@ana.cliente",
    replyTarget,
    latest: {
      id: replyTarget.id,
      text: replyTarget.text,
      direction: "inbound",
      createdAt: replyTarget.createdAt,
      type: "comment",
      status: "pending",
      contentContext: replyTarget.contentContext,
      postContext,
    },
    messageCount,
    pendingCount: 1,
    dmCount: 1,
    commentCount: messageCount - 1,
    reviewCount: 0,
    threadCount: 2,
    assignmentConflict: false,
  };
}

async function mockInboxContacts(
  page: import("@playwright/test").Page,
  contacts: ReturnType<typeof mockInboxContact>[],
) {
  await page.route("**/api/inbox/contacts?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: contacts,
        pagination: { page: 1, pageSize: 200, total: contacts.length, totalPages: 1 },
      }),
    });
  });
  await page.route("**/api/interactions?**", async (route) => {
    const interactions = contacts.flatMap((contact) => contact.replyTarget ? [contact.replyTarget] : []);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: interactions,
        pagination: { page: 1, pageSize: 200, total: interactions.length, totalPages: 1 },
      }),
    });
  });
}

function mockInboxPost(
  postKey: string,
  replyTarget: ReturnType<typeof mockReplyTarget>,
  options: {
    commentCount?: number;
    pendingCount?: number;
    participantCount?: number;
    latestComment?: ReturnType<typeof mockReplyTarget>;
  } = {},
) {
  const postContext = replyTarget.postContext!;
  const latestComment = options.latestComment ?? replyTarget;
  const publishedAt = postContext.publishedAt;
  return {
    postKey,
    brandId: replyTarget.brandId,
    accountId: replyTarget.accountId,
    channel: replyTarget.channel,
    postContext,
    publishedAt,
    latestCommentAt: latestComment.createdAt,
    sortAt: publishedAt ?? latestComment.createdAt,
    sortSource: publishedAt ? "published_at" : "latest_comment_at",
    commentCount: options.commentCount ?? 1,
    pendingCount: options.pendingCount ?? 1,
    teamReplyCount: 0,
    participantCount: options.participantCount ?? 1,
    latestComment,
    replyTarget,
  };
}

async function mockInboxPosts(
  page: import("@playwright/test").Page,
  posts: ReturnType<typeof mockInboxPost>[],
  commentsByPostKey: Record<string, ReturnType<typeof mockReplyTarget>[]>,
) {
  await page.route("**/api/inbox/posts?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: posts,
        pagination: { page: 1, pageSize: 200, total: posts.length, totalPages: 1 },
        meta: { ordering: "newest_first", primarySort: "published_at", fallbackSort: "latest_comment_at" },
      }),
    });
  });
  await page.route(/\/api\/inbox\/posts\/([^/]+)\/comments\?/, async (route) => {
    const match = new URL(route.request().url()).pathname.match(/\/api\/inbox\/posts\/([^/]+)\/comments$/);
    const postKey = match?.[1] ? decodeURIComponent(match[1]) : "";
    const comments = commentsByPostKey[postKey] ?? [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: comments,
        pagination: { page: 1, pageSize: 200, total: comments.length, totalPages: 1 },
        meta: { ordering: "oldest_first", pendingOnly: true },
      }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Centro de operaciones SAC" })).toBeVisible();
});

test("renders the persisted blue SAC workflow without browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await openSacFlow(page);
  await expect(page.locator(".workflow-node")).toHaveCount(19);
  await expect(page.getByText("Traer mensajes", { exact: true })).toBeVisible();
  await expect(page.getByText("Registrar interacciones", { exact: true })).toBeVisible();
  await expect(page.getByText("Enviar respuesta", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("locks workflow editing by default and persists each connector style", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Desktop covers precise cable selection and persistence.");
  await openSacFlow(page);
  await expect(page.getByText("Solo lectura", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".workflow-canvas-wrap")).toHaveClass(/is-read-only/);

  await page.getByRole("button", { name: "Editar flujo" }).click();
  const connectorSelector = page.getByRole("radiogroup", { name: "Trazado de conexiones nuevas" });
  await expect(connectorSelector.getByRole("radio")).toHaveCount(3);
  await expect(connectorSelector.getByRole("radio", { name: "Curvo" })).toBeVisible();
  await expect(connectorSelector.getByRole("radio", { name: "Recto" })).toBeVisible();
  await expect(connectorSelector.getByRole("radio", { name: "Ortogonal" })).toBeVisible();

  await page.locator(".react-flow__edge-interaction").first().dispatchEvent("click");
  await expect(page.getByText("Conexión seleccionada (1)")).toBeVisible();
  const saved = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes("/api/workflow"));
  await page.getByRole("radio", { name: "Curvo" }).click();
  expect((await saved).status()).toBe(200);

  const persistedType = await page.evaluate(async () => {
    const response = await fetch("/api/workflow");
    const payload = await response.json();
    return payload.data.edges[0].connectorType;
  });
  expect(persistedType).toBe("bezier");

  await page.reload();
  await openSacFlow(page);
  await expect(page.getByText("Solo lectura", { exact: true }).first()).toBeVisible();
});

test("executes, persists history and retries with one click", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Covered by the desktop operational flow.");
  await openSacFlow(page);
  const initialHistory = page.waitForResponse((response) =>
    response.request().method() === "GET" && response.url().includes("/api/executions"),
  );
  await page.getByRole("tab", { name: /Ejecuciones/ }).click();
  await initialHistory;
  await expect(page.getByText("Cargando editor del workflow…")).toHaveCount(0);
  const initialCount = await page.locator(".execution-row").count();
  await page.getByRole("tab", { name: "Editor" }).click();
  await page.getByRole("button", { name: "Ejecutar flujo" }).click();
  await expect(page.getByText("Flujo completado")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: /Ejecuciones/ }).click();
  await expect(page.locator(".execution-row")).toHaveCount(initialCount + 1);
  await page.getByRole("button", { name: "Reintentar" }).first().click();
  await expect(page.locator(".execution-row")).toHaveCount(initialCount + 2);
});

test("shows workflow validation and publication state", async ({ page }) => {
  await openSacFlow(page);
  await page.getByRole("tab", { name: "Evaluaciones" }).click();
  await expect(page.getByText("Integridad del grafo")).toBeVisible();
  await expect(page.getByText("Nodos, conexiones y rutas obligatorias validados.")).toBeVisible();
  await expect(page.getByText(/Borrador v\d+; producción v\d+\./)).toBeVisible();
});

test("prioritizes SAC work on home and opens the visual studio", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "The full studio interaction is covered on desktop.");
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await expect(page.getByRole("heading", { name: "Lo que necesita atención, primero." })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Por atender/ })).toBeVisible();
  await expect(page.getByText("100%", { exact: true })).toHaveCount(0);
  await page.locator(".sac-queue-list > button").first().click();
  await expect(page.getByLabel("Detalle de conversación")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar detalle" }).click();
  await page.getByRole("button", { name: "Automatización", exact: true }).click();
  await page.getByRole("button", { name: /SAC Multicuenta Orquestación principal/ }).click();
  await expect(page.getByLabel("Editor visual de automatizaciones")).toBeVisible();
  await expect(page.locator(".platform-canvas-node")).toHaveCount(8);
  await page.getByText("Cada 5 minutos", { exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Intervalo en minutos *" })).toHaveValue("5");
  expect(errors).toEqual([]);
});

test("updates the SAC inbox from Metricool without leaving the operator view", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Desktop covers the network sync; mobile has dedicated responsive coverage.");
  await page.getByRole("button", { name: "Bandeja SAC", exact: true }).click();
  await expect(page.locator(".interactions-view").getByRole("heading", { name: "Conversaciones", exact: true })).toBeVisible();
  await expect(page.getByText("Vista automática cada 30 s", { exact: true })).toBeVisible();

  const syncResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/api/sync"),
  );
  await page.getByRole("button", { name: "Actualizar ahora", exact: true }).click();
  expect((await syncResponse).status()).toBe(200);

  await expect(page.locator(".interactions-view").getByRole("heading", { name: "Conversaciones", exact: true })).toBeVisible();
  await expect(page.getByText("Bandeja actualizada", { exact: true })).toBeVisible();
  await expect(page.getByText(/Última sync Metricool/)).toBeVisible();
});

test("refreshes the visible inbox locally every 30 seconds without triggering Metricool", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Lo que necesita atención, primero." })).toBeVisible({ timeout: 15_000 });
  await page.clock.install();
  let interactionReads = 0;
  let automaticSyncPosts = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/inbox/contacts") interactionReads += 1;
    if (request.method() === "POST" && url.pathname === "/api/sync") automaticSyncPosts += 1;
  });

  await page.getByRole("button", { name: "Bandeja SAC", exact: true }).click();
  await expect.poll(() => interactionReads).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Actualizar ahora", exact: true })).toBeEnabled();
  const readsAfterOpening = interactionReads;

  await page.getByRole("searchbox", { name: "Buscar conversaciones" }).fill("consulta preservada");
  await page.clock.fastForward(31_000);
  await expect.poll(() => interactionReads).toBeGreaterThan(readsAfterOpening);

  expect(automaticSyncPosts).toBe(0);
  await expect(page.getByRole("searchbox", { name: "Buscar conversaciones" })).toHaveValue("consulta preservada");
});

test("renders one inbox row per contact and keeps it unique across repeated inbox reads", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Desktop covers the tabular conversation aggregation.");
  let inboxReads = 0;
  await page.route("**/api/inbox/contacts?**", async (route) => {
    inboxReads += 1;
    const contact = mockInboxContact(inboxReads > 1 ? 4 : 3);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [contact],
        pagination: { page: 1, pageSize: 200, total: 1, totalPages: 1 },
      }),
    });
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Centro de operaciones SAC" })).toBeVisible();
  await page.getByRole("button", { name: "Bandeja SAC", exact: true }).click();
  const contactRow = page.locator(".conversation-cell", { hasText: "Ana Cliente" });
  await expect(contactRow).toHaveCount(1);
  await expect(contactRow.locator(".conversation-cell__count")).toHaveText(/\d mensajes/);
  await expect(contactRow.locator(".conversation-cell__pending")).toHaveText("1 pendiente");
  await expect(page.locator(".results-toolbar__count")).toContainText("1 conversaciones");

  expect(inboxReads).toBeGreaterThanOrEqual(2);
  await expect(contactRow).toHaveCount(1);
  await expect(contactRow.locator(".conversation-cell__count")).toHaveText("4 mensajes");
});

test("shows safe post context, contact history and restores focus when closing", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Desktop covers focus restoration and the full detail panel.");
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  const postContext = {
    postId: "instagram-post-42",
    permalink: "https://www.instagram.com/p/example/",
    caption: "Nueva colección Chuck 70",
    thumbnailUrl: "https://images.example.test/chuck-70.jpg",
  };
  const replyTarget = mockReplyTarget(postContext);
  await mockInboxContacts(page, [mockInboxContact(3, postContext)]);
  await page.route("https://images.example.test/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      headers: { "access-control-allow-origin": "*" },
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#dbe6ff"/></svg>',
    });
  });
  await page.route(/\/api\/interactions\/mock-comment-1$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: replyTarget }) });
  });
  await page.route("**/api/deliveries?interactionId=mock-comment-1", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) });
  });
  await page.route("**/api/interactions/mock-comment-1/conversation?scope=contact", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "mock-comment-older",
            direction: "inbound",
            text: "¿En qué colores está disponible?",
            createdAt: "2026-08-17T11:00:00.000Z",
            channel: "instagram",
            type: "comment",
            status: "pending",
            postContext: {
              postId: "instagram-post-older",
              caption: "Publicación anterior sin enlace entregado por Metricool",
              permalink: "http://insecure.example.test/post",
            },
          },
          {
            id: replyTarget.id,
            direction: replyTarget.direction,
            text: replyTarget.text,
            createdAt: replyTarget.createdAt,
            channel: replyTarget.channel,
            type: replyTarget.type,
            status: replyTarget.status,
            postContext,
          },
        ],
      }),
    });
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Centro de operaciones SAC" })).toBeVisible();
  await page.getByRole("button", { name: "Bandeja SAC", exact: true }).click();
  const contactButton = page.locator(".conversation-cell", { hasText: "Ana Cliente" });
  await expect(contactButton).toHaveCount(1);
  await contactButton.click();

  const panel = page.getByLabel("Detalle de conversación");
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();
  const postCard = panel.getByLabel("Publicación comentada").first();
  await expect(postCard).toContainText("Nueva colección Chuck 70");
  const thumbnail = postCard.locator("img");
  await expect(thumbnail).toBeVisible();
  await expect.poll(() => thumbnail.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const postLink = postCard.getByRole("link", { name: "Ver publicación original" });
  await expect(postLink).toHaveAttribute("href", "https://www.instagram.com/p/example/");
  await expect(postLink).toHaveAttribute("target", "_blank");
  await expect(postLink).toHaveAttribute("rel", "noopener noreferrer");
  await expect(postLink).toHaveAttribute("referrerpolicy", "no-referrer");

  await panel.getByRole("button", { name: /Ver historial/ }).click();
  const history = panel.getByLabel("Historial de conversación");
  await expect(history.getByText("Enlace no disponible", { exact: true })).toBeVisible();
  await expect(history.getByRole("link", { name: "Ver publicación original" })).toHaveCount(1);
  await expectNamedControls(page);

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(contactButton).toBeFocused();
  expect(browserErrors).toEqual([]);
});

test("labels and previews Metricool attachments without exposing unsafe URLs", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Desktop covers the complete media preview.");
  const attachment = {
    ...mockReplyTarget(),
    type: "dm" as const,
    text: "¿Pueden revisar este archivo?",
    contentContext: {
      kind: "attachment" as const,
      mediaUrls: [
        "https://media.example.test/attachment.png",
        "http://unsafe.example.test/attachment.png",
        "https://user:password@media.example.test/private.png",
        "https://127.0.0.1/internal.png",
        "https://192.168.1.10/internal.png",
      ],
    },
  };
  const contact = {
    ...mockInboxContact(1),
    replyTarget: attachment,
    latest: {
      ...mockInboxContact(1).latest,
      type: attachment.type,
      text: attachment.text,
      contentContext: attachment.contentContext,
    },
  };
  await mockInboxContacts(page, [contact]);
  await page.route("https://media.example.test/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      headers: { "access-control-allow-origin": "*" },
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#dbe6ff"/></svg>',
    });
  });
  await page.route(/\/api\/interactions\/mock-comment-1$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: attachment }) });
  });
  await page.route("**/api/deliveries?interactionId=mock-comment-1", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) });
  });
  await page.route("**/api/interactions/mock-comment-1/conversation?scope=contact", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [{
          id: attachment.id,
          direction: attachment.direction,
          text: attachment.text,
          createdAt: attachment.createdAt,
          channel: attachment.channel,
          type: attachment.type,
          status: attachment.status,
          contentContext: attachment.contentContext,
        }],
      }),
    });
  });

  await page.reload();
  await page.getByRole("button", { name: "Bandeja SAC", exact: true }).click();
  const contactButton = page.locator(".conversation-cell", { hasText: "Ana Cliente" });
  await expect(contactButton.getByText("Archivo adjunto", { exact: true })).toBeVisible();
  await expect(contactButton.getByText("¿Pueden revisar este archivo?", { exact: true })).toBeVisible();
  await contactButton.click();

  const content = page.getByLabel("Detalle de conversación").locator(".content-context--attachment").first();
  await expect(content.getByText("Archivo adjunto", { exact: true })).toBeVisible();
  await expect(content.getByText("¿Pueden revisar este archivo?", { exact: true })).toBeVisible();
  const image = content.locator("img");
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(content.getByRole("link", { name: "Abrir archivo 1" })).toHaveAttribute(
    "href",
    "https://media.example.test/attachment.png",
  );
  await expect(content.getByRole("link")).toHaveCount(1);
  await image.dispatchEvent("error");
  await expect(content.getByText("Vista previa no disponible", { exact: true })).toBeVisible();
  await expect(content.getByRole("link", { name: "Abrir archivo 1" })).toBeVisible();
});

test("keeps the latest selected contact when an older detail request finishes later", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Desktop covers concurrent detail selection.");
  const first = mockInboxContact(2);
  const secondTarget = {
    ...mockReplyTarget(),
    id: "mock-comment-2",
    externalId: "metricool-comment-2",
    customerName: "Bruno Cliente",
    customerHandle: "@bruno.cliente",
    text: "Necesito ayuda con mi pedido",
  };
  const second = {
    ...mockInboxContact(2),
    contactKey: "brand-01:account-01:instagram:bruno-cliente",
    customerName: secondTarget.customerName,
    customerHandle: secondTarget.customerHandle,
    replyTarget: secondTarget,
    latest: {
      ...mockInboxContact(2).latest,
      id: secondTarget.id,
      text: secondTarget.text,
    },
  };
  await mockInboxContacts(page, [first, second]);
  await page.route(/\/api\/interactions\/mock-comment-[12]$/, async (route) => {
    const isFirst = route.request().url().endsWith("mock-comment-1");
    if (isFirst) await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: isFirst ? first.replyTarget : secondTarget }),
    });
  });
  await page.route(/\/api\/deliveries\?interactionId=mock-comment-[12]/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) });
  });
  await page.route(/\/api\/interactions\/mock-comment-[12]\/conversation\?scope=contact/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) });
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Centro de operaciones SAC" })).toBeVisible();
  await page.getByRole("button", { name: "Bandeja SAC", exact: true }).click();
  const firstContact = page.locator(".conversation-cell", { hasText: "Ana Cliente" });
  const secondContact = page.locator(".conversation-cell", { hasText: "Bruno Cliente" });
  await firstContact.dispatchEvent("click");
  await secondContact.dispatchEvent("click");

  const panel = page.getByLabel("Detalle de conversación");
  await expect(panel.getByRole("heading", { name: "Bruno Cliente" })).toBeVisible();
  await page.waitForTimeout(350);
  await expect(panel.getByRole("heading", { name: "Bruno Cliente" })).toBeVisible();
});

test("manages one account in a simplified two-pane manual workspace with exact human replies", async ({ page }) => {
  const postContext = {
    postId: "instagram-post-manual-42",
    permalink: "https://www.instagram.com/p/manual-example/",
    caption: "Chuck 70: colores disponibles",
    thumbnailUrl: "https://images.example.test/manual-chuck-70.jpg",
    publishedAt: "2026-08-17T10:00:00.000Z",
  };
  const replyTarget = mockReplyTarget(postContext);
  const secondComment = {
    ...replyTarget,
    id: "mock-comment-2",
    externalId: "metricool-comment-2",
    customerName: "Bruno Cliente",
    customerHandle: "@bruno.cliente",
    text: "¿También está disponible en talla 42?",
    createdAt: "2026-08-17T12:05:00.000Z",
    version: 4,
  };
  const olderPostContext = {
    postId: "instagram-post-manual-older",
    permalink: "https://www.instagram.com/p/manual-older/",
    caption: "Colección anterior",
    publishedAt: "2026-08-10T10:00:00.000Z",
  };
  const olderPostComment = {
    ...mockReplyTarget(olderPostContext),
    id: "mock-comment-older-post",
    externalId: "metricool-comment-older-post",
    createdAt: "2026-08-18T13:00:00.000Z",
  };
  const newestPost = mockInboxPost("post-key-newest", replyTarget, {
    commentCount: 2,
    pendingCount: 2,
    participantCount: 2,
    latestComment: secondComment,
  });
  const olderPost = mockInboxPost("post-key-older", olderPostComment);
  const replyRequests: Array<{ interactionId: string; body: Record<string, unknown>; idempotencyKey: string }> = [];
  let syncRequests = 0;

  await mockInboxContacts(page, [mockInboxContact(3, postContext)]);
  await mockInboxPosts(page, [olderPost, newestPost], {
    "post-key-newest": [replyTarget, secondComment],
    "post-key-older": [olderPostComment],
  });
  await page.route("https://images.example.test/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#dbe6ff"/></svg>',
    });
  });
  await page.route(/\/api\/interactions\/mock-comment-[12]$/, async (route) => {
    const target = route.request().url().includes("mock-comment-2") ? secondComment : replyTarget;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: target }) });
  });
  await page.route(/\/api\/deliveries\?interactionId=mock-comment-[12]/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) });
  });
  await page.route(/\/api\/interactions\/mock-comment-[12]\/conversation\?scope=contact/, async (route) => {
    const target = route.request().url().includes("mock-comment-2") ? secondComment : replyTarget;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: target.id,
            direction: target.direction,
            text: target.text,
            createdAt: target.createdAt,
            channel: target.channel,
            type: target.type,
            status: target.status,
            postContext,
          },
        ],
      }),
    });
  });
  await page.route(/\/api\/interactions\/mock-comment-[12]\/reply$/, async (route) => {
    const match = new URL(route.request().url()).pathname.match(/\/api\/interactions\/([^/]+)\/reply$/);
    replyRequests.push({
      interactionId: match?.[1] ?? "",
      body: route.request().postDataJSON() as Record<string, unknown>,
      idempotencyKey: route.request().headers()["idempotency-key"] || "",
    });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { accepted: true } }) });
  });
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/sync") syncRequests += 1;
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Centro de operaciones SAC" })).toBeVisible();
  await page.getByRole("button", { name: "Gestión manual", exact: true }).click();
  const workspace = page.locator(".manual-inbox-view");
  await expect(workspace.getByRole("heading", { name: "Gestión manual", exact: true })).toBeVisible();
  await expect(page.locator(".manual-inbox-grid > .manual-inbox-column")).toHaveCount(2);
  await expect(page.getByLabel("Cuenta obligatoria")).toHaveValue("account-01");
  expect(syncRequests).toBe(0);

  await workspace.getByRole("tab", { name: /Instagram · Comentarios/ }).click();
  const postCards = workspace.locator(".manual-inbox-contact");
  await expect(postCards).toHaveCount(2);
  await expect(postCards.nth(0)).toContainText("Chuck 70: colores disponibles");
  await expect(postCards.nth(1)).toContainText("Colección anterior");
  await postCards.nth(0).click();
  await expect(workspace.locator(".manual-inbox-conversation-header", { hasText: "Comentarios de la publicación" })).toBeVisible();
  const pendingComments = workspace.locator(".manual-inbox-exact-comments li > button");
  await expect(pendingComments).toHaveCount(2);
  await expect(pendingComments.nth(0)).toContainText("Ana Cliente");
  await expect(pendingComments.nth(1)).toContainText("Bruno Cliente");
  await expect(pendingComments.nth(0)).toHaveAttribute("aria-current", "true");
  await expect(workspace.locator(".manual-inbox-reply-target")).toContainText("Respondiendo a Ana Cliente");
  await pendingComments.nth(1).click();
  await expect(pendingComments.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(workspace.locator(".manual-inbox-reply-target")).toContainText("Respondiendo a Bruno Cliente");
  const postCard = workspace.getByLabel("Publicación comentada");
  await expect(postCard).toContainText("Chuck 70: colores disponibles");
  await expect(postCard).toContainText("Publicado");
  const postLink = postCard.getByRole("link", { name: "Abrir publicación" });
  await expect(postLink).toHaveAttribute("href", postContext.permalink);
  await expect(postLink).toHaveAttribute("target", "_blank");
  await expect(postLink).toHaveAttribute("rel", "noopener noreferrer");

  const composer = workspace.getByLabel("Compositor de respuesta humana");
  const responseText = "Hola Bruno, sí tenemos disponibilidad. Te confirmamos los colores por este mismo canal.";
  await composer.getByLabel("Respuesta personal").fill(responseText);
  await composer.getByRole("button", { name: "Guardar borrador" }).click();
  await expect.poll(() => replyRequests.length).toBe(1);
  expect(replyRequests[0]?.interactionId).toBe("mock-comment-2");
  expect(replyRequests[0]?.body).toMatchObject({ text: responseText, mode: "draft", approvedByHuman: false, expectedVersion: 4 });
  expect(replyRequests[0]?.idempotencyKey.length).toBeGreaterThan(7);

  await composer.getByLabel("Respuesta personal").fill(responseText);
  page.once("dialog", (dialog) => void dialog.accept());
  await composer.getByRole("button", { name: "Enviar manualmente" }).click();
  await expect.poll(() => replyRequests.length).toBe(2);
  expect(replyRequests[1]?.interactionId).toBe("mock-comment-2");
  expect(replyRequests[1]?.body).toMatchObject({ text: responseText, mode: "send", approvedByHuman: true, expectedVersion: 4 });
  expect(replyRequests[1]?.idempotencyKey.length).toBeGreaterThan(7);
  expect(syncRequests).toBe(0);
});

test("keeps the manual workspace within the mobile viewport", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only responsive assertion.");
  await page.getByRole("button", { name: "Gestión manual", exact: true }).click();
  const workspace = page.locator(".manual-inbox-view");
  await expect(workspace.getByRole("heading", { name: "Gestión manual", exact: true })).toBeVisible();
  const grid = workspace.locator(".manual-inbox-grid");
  await expect(grid).toBeVisible();
  const geometry = await workspace.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  const columns = await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(columns.trim().split(/\s+/)).toHaveLength(1);
});

test("keeps primary navigation usable on mobile", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only responsive assertion.");
  const navigation = page.getByRole("navigation", { name: "Navegación principal" });
  await expect(navigation).toBeVisible();
  const geometry = await navigation.evaluate((element) => {
    const style = getComputedStyle(element);
    return { direction: style.flexDirection, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
  });
  expect(geometry.direction).toBe("row");
  expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth);
  const flowButton = page.getByRole("button", { name: "Flujo SAC", exact: true });
  await flowButton.evaluate((element) => element.scrollIntoView({ inline: "center", block: "nearest" }));
  await expect(flowButton).toBeInViewport();
  await flowButton.click();
  await expect(page.getByRole("button", { name: "Ejecutar flujo" })).toBeVisible();
});

test("keeps visible controls accessibly named across the main views", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Desktop covers the complete navigation set.");
  await expectNamedControls(page);
  for (const [view, heading] of [
    ["Inicio", "Centro de operaciones SAC"],
    ["Automatización", "Automatizaciones"],
    ["Ejecuciones", "Ejecuciones"],
    ["Credenciales", "Credenciales y variables"],
    ["Cuentas", "Cuentas conectadas"],
    ["Configuración", "Configuración"],
  ]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    await expectNamedControls(page);
  }
});
