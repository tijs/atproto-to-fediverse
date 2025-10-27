import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { DIDResolver } from "../backend/services/did-resolver.ts";
import { jsonResponse, withMockFetch } from "./helpers/mockFetch.ts";

Deno.test("DIDResolver - resolves handle to PDS URL (mocked)", async () => {
  await withMockFetch((input) => {
    const url = String(input);
    if (url.includes("/com.atproto.identity.resolveHandle")) {
      return jsonResponse({ did: "did:plc:abc123" });
    }
    if (url.includes("/com.bad-example.identity.resolveMiniDoc")) {
      return jsonResponse({
        did: "did:plc:abc123",
        pds: "https://pds.example.com",
      });
    }
    return new Response("Not Found", { status: 404 });
  }, async () => {
    const pdsUrl = await DIDResolver.resolvePDSUrl("tijs.pds.blowdart.blue");
    assertEquals(pdsUrl, "https://pds.example.com");
  });
});

Deno.test("DIDResolver - resolves DID to PDS URL (injected fetch)", async () => {
  const fakeFetch = (input: Request | URL | string) => {
    const url = String(input);
    if (
      url.includes("/com.bad-example.identity.resolveMiniDoc") &&
      (url.includes("did:plc:ewvi7nxzyoun6zhxrhs64oiz") ||
        url.includes("did%3Aplc%3Aewvi7nxzyoun6zhxrhs64oiz"))
    ) {
      return Promise.resolve(jsonResponse({
        did: "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
        pds: "https://pds.other.example",
      }));
    }
    return Promise.resolve(new Response("Not Found", { status: 404 }));
  };
  const pdsUrl = await DIDResolver.resolvePDSUrl(
    "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
    fakeFetch as any,
  );
  assertEquals(pdsUrl, "https://pds.other.example");
});

Deno.test("DIDResolver - handles invalid handle (mocked)", async () => {
  await withMockFetch((input) => {
    const url = String(input);
    if (url.includes("/com.atproto.identity.resolveHandle")) {
      return new Response("Not Found", {
        status: 404,
        statusText: "Not Found",
      });
    }
    return new Response("Not Found", { status: 404 });
  }, async () => {
    await assertRejects(
      () =>
        DIDResolver.resolvePDSUrl(
          "invalid.handle.that.does.not.exist.bsky.social",
        ),
      Error,
    );
  });
});

Deno.test("DIDResolver - handles invalid DID with PLC fallback (mocked)", async () => {
  await withMockFetch((input) => {
    const url = String(input);
    if (url.includes("/com.bad-example.identity.resolveMiniDoc")) {
      // Force fallback by returning non-OK
      return new Response("error", { status: 500, statusText: "Server Error" });
    }
    if (url.match(/^https:\/\/plc\.directory\//)) {
      // Simulate PLC also failing for bogus DID
      return new Response("Not Found", {
        status: 404,
        statusText: "Not Found",
      });
    }
    return new Response("Not Found", { status: 404 });
  }, async () => {
    await assertRejects(
      () => DIDResolver.resolvePDSUrl("did:plc:doesnotexist123456789"),
      Error,
    );
  });
});
