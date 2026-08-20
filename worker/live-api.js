const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
});

const blockedRequestHeaders = [
  "authorization",
  "cookie",
  "host",
  "x-api-key",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
];

const blockedResponseHeaders = [
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-allow-origin",
  "set-cookie",
];

function configurationError(missing) {
  return json({
    error: {
      code: "LIVE_API_NOT_CONFIGURED",
      message: "La API real todavía no está configurada para este sitio.",
      required: missing,
    },
    meta: {
      mode: "live",
      demoMode: false,
      externalWrites: false,
    },
  }, 503);
}

function readConfiguration(env) {
  const originValue = String(env?.SAC_FLOW_API_ORIGIN || "").trim();
  const apiKey = String(env?.SAC_FLOW_API_KEY || "").trim();
  const missing = [];
  if (!originValue) missing.push("SAC_FLOW_API_ORIGIN");
  if (!apiKey) missing.push("SAC_FLOW_API_KEY");
  if (missing.length) return { missing };

  let origin;
  try {
    origin = new URL(originValue);
  } catch {
    return { invalid: "SAC_FLOW_API_ORIGIN debe ser una URL HTTPS válida." };
  }

  if (
    origin.protocol !== "https:"
    || origin.username
    || origin.password
    || origin.search
    || origin.hash
    || !["", "/"].includes(origin.pathname)
  ) {
    return { invalid: "SAC_FLOW_API_ORIGIN debe contener solo un origen HTTPS, sin ruta, credenciales ni parámetros." };
  }

  return { origin, apiKey };
}

export async function proxyLiveApi(request, env, fetchImpl = fetch) {
  const config = readConfiguration(env);
  if (config.missing) return configurationError(config.missing);
  if (config.invalid) {
    return json({
      error: { code: "LIVE_API_CONFIGURATION_INVALID", message: config.invalid },
      meta: { mode: "live", demoMode: false, externalWrites: false },
    }, 503);
  }

  const incomingUrl = new URL(request.url);
  if (incomingUrl.origin === config.origin.origin) {
    return json({
      error: { code: "LIVE_API_PROXY_LOOP", message: "El origen configurado apunta al mismo sitio." },
      meta: { mode: "live", demoMode: false, externalWrites: false },
    }, 503);
  }

  const upstreamUrl = new URL(incomingUrl.pathname + incomingUrl.search, config.origin);
  const headers = new Headers(request.headers);
  blockedRequestHeaders.forEach((header) => headers.delete(header));
  for (const header of [...headers.keys()]) {
    if (header.startsWith("cf-")) headers.delete(header);
  }
  headers.set("accept", request.headers.get("accept") || "application/json");
  headers.set("x-api-key", config.apiKey);
  headers.set("x-sac-flow-proxy", "sites");

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = await request.arrayBuffer();
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetchImpl(upstreamUrl, init);
  } catch {
    return json({
      error: {
        code: "LIVE_API_UNREACHABLE",
        message: "No fue posible contactar la API real. Revisa el origen y el estado del servicio.",
      },
      meta: { mode: "live", demoMode: false, externalWrites: false },
    }, 502);
  }

  const responseHeaders = new Headers(upstreamResponse.headers);
  blockedResponseHeaders.forEach((header) => responseHeaders.delete(header));
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("x-sac-flow-mode", "live");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}
