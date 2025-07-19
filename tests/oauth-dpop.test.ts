import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

// Import the functions we need to test
// We'll need to extract these from the oauth.ts file to make them testable

// Mock the oauth functions for testing
async function generateDPoPKeyPair(): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  jwk: JsonWebKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true,
    ["sign", "verify"],
  );

  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    jwk,
  };
}

function base64urlEncode(data: ArrayBuffer | Uint8Array): string {
  const uint8Array = data instanceof Uint8Array ? data : new Uint8Array(data);
  return btoa(String.fromCharCode(...uint8Array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function createDPoPProof(
  privateKey: CryptoKey,
  jwk: JsonWebKey,
  method: string,
  url: string,
  nonce?: string,
): Promise<string> {
  const header = {
    alg: "ES256",
    typ: "dpop+jwt",
    jwk: {
      kty: jwk.kty,
      crv: jwk.crv,
      x: jwk.x,
      y: jwk.y,
    },
  };

  const payload = {
    jti: crypto.randomUUID(),
    htm: method,
    htu: url,
    iat: Math.floor(Date.now() / 1000),
    ...(nonce && { nonce }),
  };

  // Encode header and payload
  const encodedHeader = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(header)),
  );
  const encodedPayload = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );

  // Create the signing input
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // Sign using ECDSA with SHA-256
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    privateKey,
    new TextEncoder().encode(signingInput),
  );

  // Encode signature
  const encodedSignature = base64urlEncode(signature);

  return `${signingInput}.${encodedSignature}`;
}

function parseJWT(
  jwt: string,
): { header: any; payload: any; signature: string } {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  const header = JSON.parse(
    atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")),
  );
  const payload = JSON.parse(
    atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
  );

  return { header, payload, signature: parts[2] };
}

Deno.test("DPoP Key Generation", async () => {
  const keyPair = await generateDPoPKeyPair();

  // Test that we get the expected structure
  assertExists(keyPair.publicKey);
  assertExists(keyPair.privateKey);
  assertExists(keyPair.jwk);

  // Test JWK properties
  assertEquals(keyPair.jwk.kty, "EC");
  assertEquals(keyPair.jwk.crv, "P-256");
  assertExists(keyPair.jwk.x);
  assertExists(keyPair.jwk.y);

  // Test that keys can be used for signing
  const testData = new TextEncoder().encode("test");
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    keyPair.privateKey,
    testData,
  );

  assertExists(signature);
  assert(signature.byteLength > 0);
});

Deno.test("Base64URL Encoding", () => {
  // Test with Uint8Array
  const testData = new TextEncoder().encode("hello world");
  const encoded = base64urlEncode(testData);

  // Should be base64url encoded (no padding, URL-safe characters)
  assert(!encoded.includes("="));
  assert(!encoded.includes("+"));
  assert(!encoded.includes("/"));

  // Test with ArrayBuffer
  const encoded2 = base64urlEncode(new Uint8Array(testData.buffer));
  assertEquals(encoded, encoded2);
});

Deno.test("DPoP JWT Creation", async () => {
  const keyPair = await generateDPoPKeyPair();
  const method = "POST";
  const url = "https://example.com/token";

  const jwt = await createDPoPProof(
    keyPair.privateKey,
    keyPair.jwk,
    method,
    url,
  );

  // Test JWT format
  const parts = jwt.split(".");
  assertEquals(parts.length, 3);

  // Parse and validate JWT
  const parsed = parseJWT(jwt);

  // Test header
  assertEquals(parsed.header.alg, "ES256");
  assertEquals(parsed.header.typ, "dpop+jwt");
  assertEquals(parsed.header.jwk.kty, "EC");
  assertEquals(parsed.header.jwk.crv, "P-256");
  assertExists(parsed.header.jwk.x);
  assertExists(parsed.header.jwk.y);

  // Test payload
  assertEquals(parsed.payload.htm, method);
  assertEquals(parsed.payload.htu, url);
  assertExists(parsed.payload.jti);
  assertExists(parsed.payload.iat);

  // Test that iat is reasonable (within last minute)
  const now = Math.floor(Date.now() / 1000);
  assert(parsed.payload.iat <= now);
  assert(parsed.payload.iat > now - 60);
});

Deno.test("DPoP JWT with Nonce", async () => {
  const keyPair = await generateDPoPKeyPair();
  const method = "POST";
  const url = "https://example.com/token";
  const nonce = "test-nonce-123";

  const jwt = await createDPoPProof(
    keyPair.privateKey,
    keyPair.jwk,
    method,
    url,
    nonce,
  );
  const parsed = parseJWT(jwt);

  assertEquals(parsed.payload.nonce, nonce);
});

Deno.test("DPoP JWT Signature Verification", async () => {
  const keyPair = await generateDPoPKeyPair();
  const method = "POST";
  const url = "https://example.com/token";

  const jwt = await createDPoPProof(
    keyPair.privateKey,
    keyPair.jwk,
    method,
    url,
  );
  const parts = jwt.split(".");

  // Verify signature
  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = new Uint8Array(
    atob(parts[2].replace(/-/g, "+").replace(/_/g, "/"))
      .split("")
      .map((c) => c.charCodeAt(0)),
  );

  const isValid = await crypto.subtle.verify(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    keyPair.publicKey,
    signature,
    new TextEncoder().encode(signingInput),
  );

  assert(isValid);
});

Deno.test("DPoP JWT Unique JTI", async () => {
  const keyPair = await generateDPoPKeyPair();
  const method = "POST";
  const url = "https://example.com/token";

  const jwt1 = await createDPoPProof(
    keyPair.privateKey,
    keyPair.jwk,
    method,
    url,
  );
  const jwt2 = await createDPoPProof(
    keyPair.privateKey,
    keyPair.jwk,
    method,
    url,
  );

  const parsed1 = parseJWT(jwt1);
  const parsed2 = parseJWT(jwt2);

  // JTI should be unique
  assert(parsed1.payload.jti !== parsed2.payload.jti);
});

Deno.test("DPoP Key Serialization", async () => {
  const keyPair = await generateDPoPKeyPair();

  // Test that we can export and import the private key
  const privateKeyJwk = await crypto.subtle.exportKey(
    "jwk",
    keyPair.privateKey,
  );

  const importedPrivateKey = await crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    false,
    ["sign"],
  );

  // Test that imported key can sign
  const testData = new TextEncoder().encode("test");
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    importedPrivateKey,
    testData,
  );

  assertExists(signature);
  assert(signature.byteLength > 0);
});

Deno.test("DPoP JWT Different Methods and URLs", async () => {
  const keyPair = await generateDPoPKeyPair();

  const testCases = [
    { method: "GET", url: "https://example.com/api" },
    { method: "POST", url: "https://auth.example.com/token" },
    { method: "PUT", url: "https://api.example.com/data" },
  ];

  for (const testCase of testCases) {
    const jwt = await createDPoPProof(
      keyPair.privateKey,
      keyPair.jwk,
      testCase.method,
      testCase.url,
    );
    const parsed = parseJWT(jwt);

    assertEquals(parsed.payload.htm, testCase.method);
    assertEquals(parsed.payload.htu, testCase.url);
  }
});

Deno.test("DPoP Nonce Retry Flow", async () => {
  const keyPair = await generateDPoPKeyPair();
  const method = "POST";
  const url = "https://auth.example.com/token";

  // First request without nonce
  const jwtWithoutNonce = await createDPoPProof(
    keyPair.privateKey,
    keyPair.jwk,
    method,
    url,
  );
  const parsedWithoutNonce = parseJWT(jwtWithoutNonce);

  // Should not have nonce
  assertEquals(parsedWithoutNonce.payload.nonce, undefined);

  // Second request with nonce (simulating retry)
  const nonce = "server-provided-nonce-123";
  const jwtWithNonce = await createDPoPProof(
    keyPair.privateKey,
    keyPair.jwk,
    method,
    url,
    nonce,
  );
  const parsedWithNonce = parseJWT(jwtWithNonce);

  // Should have nonce
  assertEquals(parsedWithNonce.payload.nonce, nonce);

  // Should have different JTI
  assert(parsedWithoutNonce.payload.jti !== parsedWithNonce.payload.jti);

  // Should have same method and URL
  assertEquals(parsedWithNonce.payload.htm, method);
  assertEquals(parsedWithNonce.payload.htu, url);
});
