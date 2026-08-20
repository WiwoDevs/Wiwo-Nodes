import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import worker from "../worker/index.js";
import { proxyLiveApi } from "../worker/live-api.js";

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("does not turn write requests into the app shell", async () => {
  let calls = 0;
  const response = await worker.fetch(
    new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }),
    {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    },
  );

  assert.equal(response.status, 404);
  assert.equal(calls, 1);
});

test("fails closed when the live API is not configured", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/platform"), {});
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.equal(payload.error.code, "LIVE_API_NOT_CONFIGURED");
  assert.equal(payload.meta.demoMode, false);
  assert.deepEqual(payload.error.required, ["SAC_FLOW_API_ORIGIN", "SAC_FLOW_API_KEY"]);
});

test("proxies API requests to the configured live backend without exposing its key", async () => {
  let upstreamRequest;
  const response = await proxyLiveApi(
    new Request("https://example.test/api/brands?page=2", {
      headers: {
        accept: "application/json",
        authorization: "Bearer browser-value",
        cookie: "session=browser-value",
        "x-api-key": "browser-value",
      },
    }),
    {
      SAC_FLOW_API_ORIGIN: "https://api.example.test",
      SAC_FLOW_API_KEY: "server-secret",
    },
    async (url, init) => {
      upstreamRequest = new Request(url, init);
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json", "set-cookie": "upstream=secret" },
      });
    },
  );

  assert.equal(response.status, 200);
  assert.equal(upstreamRequest.url, "https://api.example.test/api/brands?page=2");
  assert.equal(upstreamRequest.headers.get("x-api-key"), "server-secret");
  assert.equal(upstreamRequest.headers.get("authorization"), null);
  assert.equal(upstreamRequest.headers.get("cookie"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-sac-flow-mode"), "live");
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
});
