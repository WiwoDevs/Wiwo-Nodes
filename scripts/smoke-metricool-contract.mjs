import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { MetricoolClient, MetricoolRequestError } from "../dist-api/metricool-client.js";

const token = "local-contract-token-not-real";
const requests = [];
const sockets = new Set();

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : undefined;
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(value));
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const body = await readJson(request);
    const entry = {
      method: request.method,
      path: url.pathname,
      userId: url.searchParams.get("userId"),
      blogId: url.searchParams.get("blogId"),
      provider: url.searchParams.get("provider"),
      auth: request.headers["x-mc-auth"],
      body,
    };
    requests.push(entry);

    assert.equal(entry.auth, token);
    assert.equal(entry.userId, "user-contract");
    assert.ok(["/api/v2/inbox/conversations", "/api/v2/inbox/post-comments"].includes(entry.path));

    if (entry.blogId === "unauthorized") {
      return sendJson(response, 401, { message: `upstream must never leak ${token}` });
    }
    if (entry.blogId === "rate-limited") {
      return sendJson(response, 429, { message: "slow down" }, { "retry-after": "2" });
    }
    if (entry.blogId === "upstream-error") {
      return sendJson(response, 500, { message: "provider unavailable" });
    }
    if (entry.blogId === "timeout") {
      setTimeout(() => {
        if (!response.destroyed && !response.writableEnded) sendJson(response, 200, { late: true });
      }, 100);
      return;
    }

    if (entry.method === "GET" && entry.path.endsWith("/post-comments")) {
      response.writeHead(204);
      return response.end();
    }
    return sendJson(response, 200, { ok: true, accepted: body || null });
  } catch (error) {
    sendJson(response, 500, { simulatorError: error instanceof Error ? error.message : "unknown" });
  }
});

server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}/api`;

const account = (blogId) => ({ userId: "user-contract", blogId });
const client = new MetricoolClient({ token, baseUrl, timeoutMs: 1_000 });
const timeoutClient = new MetricoolClient({ token, baseUrl, timeoutMs: 25 });

try {
  assert.deepEqual(await client.listConversations(account("success"), "INSTAGRAMBUSINESS"), {
    ok: true,
    accepted: null,
  });
  assert.equal(await client.listPostComments(account("success"), "FACEBOOK"), null);
  assert.deepEqual(await client.replyToConversation(account("success"), {
    text: "Hola desde el simulador",
    conversationId: "conversation-contract",
    provider: "INSTAGRAMBUSINESS",
    recipient: "recipient-contract",
  }), {
    ok: true,
    accepted: {
      text: "Hola desde el simulador",
      conversationId: "conversation-contract",
      provider: "INSTAGRAMBUSINESS",
      recipient: "recipient-contract",
    },
  });

  await assert.rejects(
    client.replyToPostComment(account("rate-limited"), {
      text: "Respuesta contractual",
      objectId: "comment-contract",
      provider: "FACEBOOK",
    }),
    (error) => error instanceof MetricoolRequestError
      && error.status === 429
      && error.endpoint === "/v2/inbox/post-comments"
      && error.retryAfterMs === 2_000,
  );

  for (const [blogId, status] of [["unauthorized", 401], ["upstream-error", 500]]) {
    await assert.rejects(
      client.listConversations(account(blogId), "INSTAGRAMBUSINESS"),
      (error) => error instanceof MetricoolRequestError
        && error.status === status
        && !error.message.includes(token),
    );
  }

  await assert.rejects(
    timeoutClient.listConversations(account("timeout"), "INSTAGRAMBUSINESS"),
    (error) => error instanceof Error
      && error.message === "La solicitud a Metricool excedió el tiempo máximo."
      && !error.message.includes(token),
  );

  assert.equal(requests.length, 7);
  const conversationRead = requests[0];
  assert.deepEqual(
    { method: conversationRead.method, path: conversationRead.path, provider: conversationRead.provider },
    { method: "GET", path: "/api/v2/inbox/conversations", provider: "INSTAGRAMBUSINESS" },
  );
  const commentRead = requests[1];
  assert.deepEqual(
    { method: commentRead.method, path: commentRead.path, provider: commentRead.provider },
    { method: "GET", path: "/api/v2/inbox/post-comments", provider: "FACEBOOK" },
  );
  const conversationReply = requests[2];
  assert.equal(conversationReply.method, "POST");
  assert.equal(conversationReply.provider, null);
  assert.equal(conversationReply.body.conversationId, "conversation-contract");
  const commentReply = requests[3];
  assert.equal(commentReply.method, "POST");
  assert.equal(commentReply.body.objectId, "comment-contract");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    requests: requests.length,
    cases: ["read", "write-shape", "204", "401", "429-retry-after", "500", "timeout"],
    externalNetwork: false,
  })}\n`);
} finally {
  for (const socket of sockets) socket.destroy();
  server.close();
  await once(server, "close");
}
