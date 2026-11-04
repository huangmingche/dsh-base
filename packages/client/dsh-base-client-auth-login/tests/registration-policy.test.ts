import assert from "node:assert/strict";
import { readRegistrationPolicy } from "../src/client/registration-policy.ts";
import { loginCopy } from "../src/client/locales.ts";
for (const [body, expected] of [[{ signUpEnabled: true }, "enabled"], [{ signUpEnabled: false }, "closed"], [{ signUpEnabled: "true" }, "unavailable"], [{}, "unavailable"], [null, "unavailable"]] as const) {
  const result = await readRegistrationPolicy((async (url, init) => {
    assert.equal(url, "/api/auth-policy");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.headers, undefined);
    return Response.json(body);
  }) as typeof fetch);
  assert.equal(result, expected);
}
assert.equal(await readRegistrationPolicy((async () => new Response("failed", { status: 503 })) as typeof fetch), "unavailable");
assert.equal(await readRegistrationPolicy((async () => { throw new Error("offline"); }) as typeof fetch), "unavailable");
assert.notEqual(loginCopy("zh-CN").registrationClosed, loginCopy("en").registrationClosed);
console.log("login registration policy: explicit true only; closed, malformed, failed and offline stay unavailable; bilingual explanations");
