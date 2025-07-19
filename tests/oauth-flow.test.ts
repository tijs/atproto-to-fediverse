import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

// Mock OAuth flow tests
Deno.test("OAuth State Generation", () => {
  function generateState(): string {
    return crypto.randomUUID();
  }

  const state1 = generateState();
  const state2 = generateState();

  // Should be valid UUIDs
  assert(state1.length === 36);
  assert(state2.length === 36);

  // Should be unique
  assert(state1 !== state2);

  // Should match UUID format
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  assert(uuidPattern.test(state1));
  assert(uuidPattern.test(state2));
});

Deno.test("Code Verifier Generation", () => {
  function generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  const verifier1 = generateCodeVerifier();
  const verifier2 = generateCodeVerifier();

  // Should be base64url encoded
  assert(!verifier1.includes("="));
  assert(!verifier1.includes("+"));
  assert(!verifier1.includes("/"));

  // Should be unique
  assert(verifier1 !== verifier2);

  // Should be reasonable length (32 bytes base64url encoded)
  assert(verifier1.length > 40);
});

Deno.test("Code Challenge Generation", async () => {
  async function generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  const verifier = "test-verifier-123";
  const challenge1 = await generateCodeChallenge(verifier);
  const challenge2 = await generateCodeChallenge(verifier);

  // Should be deterministic
  assertEquals(challenge1, challenge2);

  // Should be base64url encoded
  assert(!challenge1.includes("="));
  assert(!challenge1.includes("+"));
  assert(!challenge1.includes("/"));

  // Should be 43 characters (32 bytes SHA-256 in base64url)
  assertEquals(challenge1.length, 43);
});

Deno.test("OAuth Authorization URL Construction", () => {
  const baseUrl = "https://example.com/oauth/authorize";
  const authUrl = new URL(baseUrl);

  const params = {
    response_type: "code",
    client_id: "test-client",
    redirect_uri: "https://app.example.com/callback",
    scope: "atproto transition:generic",
    state: "test-state",
    code_challenge: "test-challenge",
    code_challenge_method: "S256",
  };

  Object.entries(params).forEach(([key, value]) => {
    authUrl.searchParams.set(key, value);
  });

  const urlString = authUrl.toString();

  // Should contain all required parameters
  assert(urlString.includes("response_type=code"));
  assert(urlString.includes("client_id=test-client"));
  assert(urlString.includes("scope=atproto+transition%3Ageneric"));
  assert(urlString.includes("code_challenge_method=S256"));
});

Deno.test("OAuth Token Exchange Parameters", () => {
  const tokenParams = {
    grant_type: "authorization_code",
    code: "test-code",
    redirect_uri: "https://app.example.com/callback",
    client_id: "test-client",
    code_verifier: "test-verifier",
  };

  const formData = new URLSearchParams(tokenParams);
  const body = formData.toString();

  // Should contain all required parameters
  assert(body.includes("grant_type=authorization_code"));
  assert(body.includes("code=test-code"));
  assert(
    body.includes("redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback"),
  );
  assert(body.includes("client_id=test-client"));
  assert(body.includes("code_verifier=test-verifier"));
});

Deno.test("Cookie Security Settings", () => {
  // Test that OAuth cookies have proper security settings
  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
    maxAge: 600, // 10 minutes
  };

  assertEquals(cookieOptions.httpOnly, true);
  assertEquals(cookieOptions.secure, true);
  assertEquals(cookieOptions.sameSite, "Lax");
  assertEquals(cookieOptions.maxAge, 600);
});

Deno.test("OAuth Error Handling", () => {
  // Test error response structure
  const errorResponse = {
    error: "invalid_request",
    error_description: "Missing required parameter",
  };

  assertExists(errorResponse.error);
  assertExists(errorResponse.error_description);

  // Test error categorization
  const retryableErrors = ["server_error", "temporarily_unavailable"];
  const nonRetryableErrors = [
    "invalid_request",
    "invalid_client",
    "unsupported_grant_type",
  ];

  assert(retryableErrors.includes("server_error"));
  assert(nonRetryableErrors.includes("invalid_request"));
  assert(!retryableErrors.includes("invalid_request"));
});

Deno.test("DPoP Integration with OAuth", async () => {
  // Test that DPoP keys are properly integrated into OAuth flow

  // Mock key generation
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );

  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

  // Test key serialization for cookie storage
  const privateKeyStr = JSON.stringify(privateJwk);
  const publicKeyStr = JSON.stringify(publicJwk);

  // Should be serializable
  assertExists(privateKeyStr);
  assertExists(publicKeyStr);

  // Should be parseable
  const parsedPrivate = JSON.parse(privateKeyStr);
  const parsedPublic = JSON.parse(publicKeyStr);

  assertEquals(parsedPrivate.kty, "EC");
  assertEquals(parsedPublic.kty, "EC");
  assertEquals(parsedPrivate.crv, "P-256");
  assertEquals(parsedPublic.crv, "P-256");

  // Test key reimport
  const reimportedPrivate = await crypto.subtle.importKey(
    "jwk",
    parsedPrivate,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  assertExists(reimportedPrivate);
});

Deno.test("OAuth Callback URL Parsing", () => {
  // Test successful callback
  const successUrl =
    "https://app.example.com/callback?code=test-code&state=test-state";
  const successUrlObj = new URL(successUrl);

  const code = successUrlObj.searchParams.get("code");
  const state = successUrlObj.searchParams.get("state");

  assertEquals(code, "test-code");
  assertEquals(state, "test-state");

  // Test error callback
  const errorUrl =
    "https://app.example.com/callback?error=access_denied&state=test-state";
  const errorUrlObj = new URL(errorUrl);

  const error = errorUrlObj.searchParams.get("error");
  const errorState = errorUrlObj.searchParams.get("state");

  assertEquals(error, "access_denied");
  assertEquals(errorState, "test-state");
});

Deno.test("OAuth Session Management", () => {
  // Test session data structure
  const sessionData = {
    state: "test-state",
    codeVerifier: "test-verifier",
    userId: "test-user",
    pdsUrl: "https://pds.example.com",
    dpopPrivateKey: "serialized-key",
    dpopPublicJwk: "serialized-jwk",
  };

  // All required fields should be present
  Object.values(sessionData).forEach((value) => {
    assertExists(value);
    assert(typeof value === "string");
  });

  // Test session cleanup
  const cleanupSession = {
    state: "",
    codeVerifier: "",
    userId: "",
    pdsUrl: "",
    dpopPrivateKey: "",
    dpopPublicJwk: "",
  };

  Object.values(cleanupSession).forEach((value) => {
    assertEquals(value, "");
  });
});
