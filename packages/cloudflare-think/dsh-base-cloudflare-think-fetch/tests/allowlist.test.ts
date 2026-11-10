import assert from "node:assert/strict";
import test from "node:test";
import { fetchTools } from "../src/index.ts";

// Exercise the installed Think SDK, including its URL matching and redirect
// loop. Only the network boundary is replaced; no request can leave this test.
interface FetchResult {
  ok: boolean;
  code?: string;
  body?: string;
  finalUrl?: string;
}

interface RequestRecord {
  url: string;
  redirect: RequestRedirect | undefined;
  method: string | undefined;
}

function configure(deployment: string | undefined, owner?: unknown) {
  const tools = fetchTools.tools!(
    { FETCH_ALLOWLIST: deployment },
    { pluginConfig: (name: string) => {
      assert.equal(name, "fetch");
      return owner;
    } } as never,
  );
  assert.equal(typeof tools.fetch_url?.execute, "function");
  const execute = tools.fetch_url.execute as unknown as (
    input: { url: string; response: "text" },
    options: { toolCallId: string; messages: never[] },
  ) => Promise<FetchResult>;
  return (url: string) => execute({ url, response: "text" }, { toolCallId: "allowlist-test", messages: [] });
}

async function withNetwork(
  run: (requests: RequestRecord[]) => Promise<void> | void,
  respond: (url: string, count: number) => Response = () => new Response("local fixture", { headers: { "content-type": "text/plain" } }),
) {
  const original = globalThis.fetch;
  const requests: RequestRecord[] = [];
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push({ url, redirect: init?.redirect, method: init?.method });
    return respond(url, requests.length);
  };
  try {
    await run(requests);
  } finally {
    globalThis.fetch = original;
  }
}

const docs = "https://developers.cloudflare.com/docs/**";

test("unconfigured owner and empty owner allowlist inherit only the deployment", async () => {
  await withNetwork(async requests => {
    for (const owner of [undefined, {}, { allowlist: [] }]) {
      const fetch = configure(docs, owner);
      assert.equal((await fetch("https://developers.cloudflare.com/docs/start")).ok, true);
      const before = requests.length;
      assert.equal((await fetch("https://developers.cloudflare.com/outside")).code, "disallowed_url");
      assert.equal(requests.length, before);
    }
    assert.equal(requests.length, 3);
  });
});

test("default deployment allows the documented origins and no lookalike domain", async () => {
  await withNetwork(async requests => {
    const fetch = configure(undefined, { allowlist: [] });
    assert.equal((await fetch("https://developers.cloudflare.com/workers/")).ok, true);
    assert.equal((await fetch("https://ai-sdk.dev/docs/")).ok, true);
    assert.equal((await fetch("https://ai-sdk.dev.evil.example/docs/")).code, "disallowed_url");
    assert.equal(requests.length, 2);
  });
});

for (const entry of [
  "https://developers.cloudflare.com.evil.example/docs/**",
  "https://developers.cloudflare.com:8443/docs/**",
  "https://developers.cloudflare.com/docs-elsewhere/**",
  "https://developers.cloudflare.com/docs*/**",
  "https://developers.cloudflare.com/**",
  "https://developers.cloudflare.com/docs/../private/**",
  "https://developers.cloudflare.com/docs/%2e%2e/private/**",
  "https://ai-sdk.dev/docs/**",
]) {
  test(`owner cannot widen deployment: ${entry}`, async () => {
    await withNetwork(requests => {
      assert.throws(() => configure(docs, { allowlist: [entry] }), /fetch\/allowlist-outside-deployment/u);
      assert.deepEqual(requests, []);
    });
  });
}

for (const entry of [
  "http://developers.cloudflare.com/docs/**",
  "https://*.cloudflare.com/docs/**",
  "https://developers.cloudflare.com*/docs/**",
  "https://user@developers.cloudflare.com/docs/**",
  "https://user:secret@developers.cloudflare.com/docs/**",
  "https://developers.cloudflare.com/docs/**?scope=all",
  "https://developers.cloudflare.com/docs/**#section",
  "https://developers.cloudflare.com\\evil.example/docs/**",
  "/docs/**",
  "not a URL",
  "",
  7,
  null,
]) {
  test(`invalid nonempty owner policy fails closed: ${JSON.stringify(entry)}`, async () => {
    await withNetwork(requests => {
      assert.throws(() => configure(docs, { allowlist: [entry] }), /fetch\/allowlist-invalid/u);
      assert.deepEqual(requests, []);
    });
  });
}

test("a mixed valid/outside owner list is rejected rather than partially accepted", async () => {
  await withNetwork(requests => {
    assert.throws(() => configure(docs, { allowlist: ["https://developers.cloudflare.com/docs/guide/**", "https://evil.example/**"] }), /fetch\/allowlist-outside-deployment/u);
    assert.deepEqual(requests, []);
  });
});

test("a mixed valid/malformed owner list is rejected rather than falling back", async () => {
  await withNetwork(requests => {
    assert.throws(() => configure(docs, { allowlist: ["https://developers.cloudflare.com/docs/guide/**", false] }), /fetch\/allowlist-invalid/u);
    assert.deepEqual(requests, []);
  });
});

test("invalid deployment policy cannot be rescued by an owner override", async () => {
  await withNetwork(requests => {
    assert.throws(() => configure("https://*.cloudflare.com/docs/**", { allowlist: ["https://developers.cloudflare.com/docs/**"] }), /fetch\/allowlist-invalid/u);
    assert.deepEqual(requests, []);
  });
});

test("owner path globs stay inside the deployment subtree", async () => {
  await withNetwork(async requests => {
    const fetch = configure(docs, { allowlist: ["https://developers.cloudflare.com/docs/guide/*/index.html"] });
    assert.equal((await fetch("https://developers.cloudflare.com/docs/guide/workers/index.html")).ok, true);
    assert.equal((await fetch("https://developers.cloudflare.com/docs/other/index.html")).code, "disallowed_url");
    assert.equal((await fetch("https://developers.cloudflare.com/docs/guide/a/b/index.html")).code, "disallowed_url");
    assert.equal(requests.length, 1);
  });
});

test("origin case, default HTTPS port, trailing dot and dot segments normalize before narrowing", async () => {
  await withNetwork(async requests => {
    const fetch = configure("HTTPS://DEVELOPERS.CLOUDFLARE.COM.:443/docs/part/../**", {
      allowlist: ["https://developers.cloudflare.com:443/docs/old/../guide/**"],
    });
    assert.equal((await fetch("HTTPS://DEVELOPERS.CLOUDFLARE.COM.:443/docs/guide/part/../start?lang=en#top")).ok, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].redirect, "manual", "the real SDK must inspect redirects before following them");
    assert.equal((await fetch("https://developers.cloudflare.com/docs/other/start")).code, "disallowed_url");
    assert.equal(requests.length, 1);
  });
});

test("nondefault ports require the same deployment origin", async () => {
  await withNetwork(async requests => {
    const fetch = configure("https://developers.cloudflare.com:8443/docs/**", {
      allowlist: ["https://developers.cloudflare.com:8443/docs/guide/**"],
    });
    assert.equal((await fetch("https://developers.cloudflare.com:8443/docs/guide/start")).ok, true);
    assert.equal((await fetch("https://developers.cloudflare.com/docs/guide/start")).code, "disallowed_url");
    assert.equal(requests.length, 1);
  });
});

test("an exact deployment URL permits only the same exact owner policy", async () => {
  await withNetwork(async requests => {
    const exact = "https://developers.cloudflare.com/docs/start";
    const fetch = configure(exact, { allowlist: ["https://DEVELOPERS.CLOUDFLARE.COM:443/docs/./start"] });
    assert.equal((await fetch(exact)).ok, true);
    assert.equal((await fetch(`${exact}/extra`)).code, "disallowed_url");
    for (const entry of [`${exact}*`, `${exact}/**`, `${exact}/extra`]) {
      assert.throws(() => configure(exact, { allowlist: [entry] }), /fetch\/allowlist-outside-deployment/u);
    }
    assert.equal(requests.length, 1);
  });
});

test("complex deployment globs allow only an identical normalized owner pattern", async () => {
  await withNetwork(async requests => {
    const pattern = "https://developers.cloudflare.com/docs/*/index.html";
    const fetch = configure(pattern, { allowlist: [pattern] });
    assert.equal((await fetch("https://developers.cloudflare.com/docs/workers/index.html")).ok, true);
    for (const entry of ["https://developers.cloudflare.com/docs/workers/index.html", "https://developers.cloudflare.com/docs/**"]) {
      assert.throws(() => configure(pattern, { allowlist: [entry] }), /fetch\/allowlist-outside-deployment/u);
    }
    assert.equal(requests.length, 1);
  });
});

test("out-of-policy requested URLs are rejected before the first outbound request", async () => {
  await withNetwork(async requests => {
    const fetch = configure(docs, { allowlist: ["https://developers.cloudflare.com/docs/guide/**"] });
    for (const url of [
      "https://developers.cloudflare.com.evil.example/docs/guide/start",
      "https://developers.cloudflare.com:8443/docs/guide/start",
      "http://developers.cloudflare.com/docs/guide/start",
      "https://developers.cloudflare.com/docs/guide-evil/start",
      "https://developers.cloudflare.com/docs/guide/../../private",
      "https://developers.cloudflare.com/docs/guide/%2e%2e/other",
      "https://user@developers.cloudflare.com/docs/guide/start",
      "https://127.0.0.1/docs/guide/start",
    ]) {
      const result = await fetch(url);
      assert.equal(result.ok, false, url);
      assert.equal(result.code, "disallowed_url", url);
      assert.deepEqual(requests, [], url);
    }
  });
});

for (const location of [
  "https://developers.cloudflare.com.evil.example/docs/guide/final",
  "https://ai-sdk.dev/docs/guide/final",
  "https://developers.cloudflare.com:8443/docs/guide/final",
  "/docs/outside/final",
  "/docs/guide/../../private",
]) {
  test(`redirect outside the narrowed policy makes only the first request: ${location}`, async () => {
    await withNetwork(async requests => {
      const fetch = configure(docs, { allowlist: ["https://developers.cloudflare.com/docs/guide/**"] });
      const result = await fetch("https://developers.cloudflare.com/docs/guide/start");
      assert.equal(result.ok, false);
      assert.equal(result.code, "disallowed_redirect");
      assert.deepEqual(requests.map(request => request.url), ["https://developers.cloudflare.com/docs/guide/start"]);
      assert.equal(requests[0].redirect, "manual");
    }, () => new Response(null, { status: 302, headers: { location } }));
  });
}

test("a relative redirect inside the narrowed path succeeds through the real SDK", async () => {
  await withNetwork(async requests => {
    const fetch = configure(docs, { allowlist: ["https://developers.cloudflare.com/docs/guide/**"] });
    const result = await fetch("https://developers.cloudflare.com/docs/guide/start");
    assert.equal(result.ok, true);
    assert.equal(result.body, "redirected fixture");
    assert.equal(result.finalUrl, "https://developers.cloudflare.com/docs/guide/final");
    assert.deepEqual(requests.map(request => request.url), ["https://developers.cloudflare.com/docs/guide/start", "https://developers.cloudflare.com/docs/guide/final"]);
    assert.ok(requests.every(request => request.redirect === "manual"));
  }, (_url, count) => count === 1
    ? new Response(null, { status: 302, headers: { location: "./part/../final" } })
    : new Response("redirected fixture", { headers: { "content-type": "text/plain" } }));
});

test("allowlisted redirects may cross origins only when both origins are in the narrowed policy", async () => {
  await withNetwork(async requests => {
    const fetch = configure(`${docs},https://ai-sdk.dev/docs/**`, {
      allowlist: ["https://developers.cloudflare.com/docs/guide/**", "https://ai-sdk.dev/docs/guide/**"],
    });
    const result = await fetch("https://developers.cloudflare.com/docs/guide/start");
    assert.equal(result.ok, true);
    assert.equal(result.finalUrl, "https://ai-sdk.dev/docs/guide/final");
    assert.equal(requests.length, 2);
    assert.ok(requests.every(request => request.redirect === "manual"));
  }, (_url, count) => count === 1
    ? new Response(null, { status: 302, headers: { location: "https://ai-sdk.dev/docs/guide/final" } })
    : new Response("allowed cross-origin fixture", { headers: { "content-type": "text/plain" } }));
});
