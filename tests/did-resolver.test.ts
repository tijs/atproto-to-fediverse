import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { DIDResolver } from "../backend/services/did-resolver.ts";

Deno.test("DIDResolver - should resolve handle to PDS URL", async () => {
  const pdsUrl = await DIDResolver.resolvePDSUrl("tijs.pds.blowdart.blue");

  // Should return a valid HTTPS URL
  assertEquals(pdsUrl.startsWith("https://"), true);
  console.log(`Resolved handle to PDS: ${pdsUrl}`);
});

Deno.test("DIDResolver - should resolve DID to PDS URL", async () => {
  // Using a known test DID (Jay Graber's DID as example)
  const pdsUrl = await DIDResolver.resolvePDSUrl(
    "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
  );

  // Should return a valid HTTPS URL
  assertEquals(pdsUrl.startsWith("https://"), true);
  console.log(`Resolved DID to PDS: ${pdsUrl}`);
});

Deno.test("DIDResolver - should handle invalid handle", async () => {
  await assertRejects(
    async () => {
      await DIDResolver.resolvePDSUrl(
        "invalid.handle.that.does.not.exist.bsky.social",
      );
    },
    Error,
  );
});

Deno.test("DIDResolver - should handle invalid DID", async () => {
  await assertRejects(
    async () => {
      await DIDResolver.resolvePDSUrl("did:plc:doesnotexist123456789");
    },
    Error,
  );
});
