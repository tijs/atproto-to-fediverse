import { Hono } from "https://esm.sh/hono@3.11.7";
import { getCookie, setCookie } from "https://esm.sh/hono@3.11.7/cookie";
import { getUserAccount, updateUserAccount } from "../database/queries.ts";
import { createUserSession } from "../lib/session.ts";
import { identityResolver } from "../services/identity-resolver.ts";

const oauth = new Hono();

// Generate random state for OAuth security
function generateState(): string {
  return crypto.randomUUID();
}

// Generate code verifier for PKCE
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// Generate code challenge from verifier
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// Generate DPoP key pair
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

// Base64URL encode function
function base64urlEncode(data: ArrayBuffer | Uint8Array): string {
  const uint8Array = data instanceof Uint8Array ? data : new Uint8Array(data);
  return btoa(String.fromCharCode(...uint8Array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// Create DPoP proof JWT using Web Crypto API
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

// Discover PDS URL from handle using official ATProto identity resolution
async function discoverPDS(handle: string): Promise<string> {
  try {
    console.log(`Resolving handle ${handle} using identity resolver...`);
    const pdsUrl = await identityResolver.resolveHandleToPds(handle);
    console.log(`Identity resolver returned PDS: ${pdsUrl}`);

    if (pdsUrl) {
      return pdsUrl;
    }

    // Only fallback to bsky.social for .bsky.social handles
    const cleanHandle = handle.replace("@", "");
    if (cleanHandle.endsWith(".bsky.social")) {
      console.log(`Using bsky.social fallback for ${cleanHandle}`);
      return "https://bsky.social";
    }

    throw new Error(`Unable to discover PDS for handle: ${handle}`);
  } catch (error) {
    console.error("PDS discovery failed:", error);

    // Only default to bsky.social for .bsky.social handles
    if (handle.includes(".bsky.social")) {
      console.log(`Using bsky.social error fallback for ${handle}`);
      return "https://bsky.social";
    }

    throw error;
  }
}

// Get authorization server metadata
async function getAuthServerMetadata(pdsUrl: string): Promise<any> {
  const metadataUrl = `${pdsUrl}/.well-known/oauth-authorization-server`;
  console.log(`Fetching OAuth metadata from: ${metadataUrl}`);

  const response = await fetch(metadataUrl);
  if (!response.ok) {
    console.error(
      `OAuth metadata fetch failed: ${response.status} ${response.statusText} for ${metadataUrl}`,
    );

    // If PDS doesn't have OAuth metadata, try using bsky.social for Bluesky-operated PDS instances
    if (pdsUrl.includes(".bsky.network")) {
      console.log(
        `PDS appears to be Bluesky-operated, trying bsky.social for OAuth metadata`,
      );
      const bskyMetadataUrl =
        "https://bsky.social/.well-known/oauth-authorization-server";
      const bskyResponse = await fetch(bskyMetadataUrl);
      if (bskyResponse.ok) {
        console.log(`Successfully got OAuth metadata from bsky.social`);
        return bskyResponse.json();
      }
    }

    throw new Error(`Failed to fetch auth server metadata: ${response.status}`);
  }
  return response.json();
}

// ATProto OAuth routes
oauth.get("/atproto/start", async (c) => {
  const handle = c.req.query("handle");
  const userId = c.req.query("user_id");

  if (!handle || !userId) {
    return c.json({ error: "Handle and user_id are required" }, 400);
  }

  try {
    // Discover PDS URL
    console.log(`Discovering PDS for handle: ${handle}`);
    const pdsUrl = await discoverPDS(handle);
    console.log(`Discovered PDS URL: ${pdsUrl}`);

    // Get authorization server metadata
    const authMetadata = await getAuthServerMetadata(pdsUrl);

    // Generate OAuth parameters
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    // Generate DPoP key pair
    const dpopKeyPair = await generateDPoPKeyPair();

    // Store OAuth state in cookies
    setCookie(c, "oauth_state", state, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: 600, // 10 minutes
    });
    setCookie(c, "oauth_code_verifier", codeVerifier, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: 600,
    });
    setCookie(c, "oauth_user_id", userId, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: 600,
    });
    setCookie(c, "oauth_pds_url", pdsUrl, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: 600,
    });

    // Store DPoP private key (we'll need to serialize it)
    const dpopPrivateKeyJwk = await crypto.subtle.exportKey(
      "jwk",
      dpopKeyPair.privateKey,
    );
    setCookie(c, "oauth_dpop_private_key", JSON.stringify(dpopPrivateKeyJwk), {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: 600,
    });
    setCookie(c, "oauth_dpop_public_jwk", JSON.stringify(dpopKeyPair.jwk), {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: 600,
    });

    // Build authorization URL
    const authUrl = new URL(authMetadata.authorization_endpoint);
    authUrl.searchParams.set("response_type", "code");
    const rawUrl = Deno.env.get("VALTOWN_URL") || "http://localhost:8080";
    const valtownUrl = rawUrl.replace(/\/$/, ""); // Remove trailing slash
    authUrl.searchParams.set(
      "client_id",
      `${valtownUrl}/client`,
    );
    authUrl.searchParams.set(
      "redirect_uri",
      `${c.req.url.split("/oauth")[0]}/oauth/atproto/callback`,
    );
    authUrl.searchParams.set("scope", "atproto transition:generic");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    return c.json({ authUrl: authUrl.toString() });
  } catch (error) {
    console.error("ATProto OAuth start error:", error);
    return c.json({ error: "Failed to start OAuth flow" }, 500);
  }
});

oauth.get("/atproto/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");
  if (error) {
    return c.json({ error: `OAuth error: ${error}` }, 400);
  }

  if (!code || !state) {
    return c.json({ error: "Missing code or state" }, 400);
  }

  // Verify state
  const storedState = getCookie(c, "oauth_state");
  if (state !== storedState) {
    return c.json({ error: "Invalid state parameter" }, 400);
  }

  try {
    const codeVerifier = getCookie(c, "oauth_code_verifier");
    const userId = getCookie(c, "oauth_user_id");
    const pdsUrl = getCookie(c, "oauth_pds_url");
    const dpopPrivateKeyJwkStr = getCookie(c, "oauth_dpop_private_key");
    const dpopPublicJwkStr = getCookie(c, "oauth_dpop_public_jwk");

    if (
      !codeVerifier || !userId || !pdsUrl || !dpopPrivateKeyJwkStr ||
      !dpopPublicJwkStr
    ) {
      return c.json({ error: "Missing OAuth session data" }, 400);
    }

    // Recreate DPoP key pair from stored JWK
    const dpopPrivateKeyJwk = JSON.parse(dpopPrivateKeyJwkStr);
    const dpopPublicJwk = JSON.parse(dpopPublicJwkStr);

    const dpopPrivateKey = await crypto.subtle.importKey(
      "jwk",
      dpopPrivateKeyJwk,
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      false,
      ["sign"],
    );

    // Get authorization server metadata
    const authMetadata = await getAuthServerMetadata(pdsUrl);

    // Exchange code for tokens
    const tokenParams = {
      grant_type: "authorization_code",
      code: code,
      redirect_uri: `${c.req.url.split("/oauth")[0]}/oauth/atproto/callback`,
      client_id: `${
        (Deno.env.get("VALTOWN_URL") || "http://localhost:8080").replace(
          /\/$/,
          "",
        )
      }/client`,
      code_verifier: codeVerifier,
    };

    console.log("Token exchange params:", {
      ...tokenParams,
      code_verifier: codeVerifier.substring(0, 10) + "...", // Log partial code verifier
      code: code.substring(0, 10) + "...", // Log partial code
    });

    // Create DPoP proof for token exchange
    const dpopProof = await createDPoPProof(
      dpopPrivateKey,
      dpopPublicJwk,
      "POST",
      authMetadata.token_endpoint,
    );

    const tokenResponse = await fetch(authMetadata.token_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "DPoP": dpopProof,
      },
      body: new URLSearchParams(tokenParams),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error("Token exchange failed:", errorData);

      // Check if server requires DPoP nonce
      if (errorData.error === "use_dpop_nonce") {
        console.log("Server requires DPoP nonce, retrying with nonce...");

        // Extract nonce from DPoP-Nonce header (case-insensitive)
        const nonce = tokenResponse.headers.get("DPoP-Nonce") ||
          tokenResponse.headers.get("dpop-nonce") ||
          tokenResponse.headers.get("Dpop-Nonce");

        // Log all headers to debug
        const allHeaders = {};
        tokenResponse.headers.forEach((value, key) => {
          allHeaders[key] = value;
        });

        if (!nonce) {
          return c.json({
            error: "Server requires nonce but none provided",
            details: errorData,
          }, 400);
        }

        // Create new DPoP proof with nonce
        const dpopProofWithNonce = await createDPoPProof(
          dpopPrivateKey,
          dpopPublicJwk,
          "POST",
          authMetadata.token_endpoint,
          nonce,
        );

        // Retry token exchange with nonce
        const retryResponse = await fetch(authMetadata.token_endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "DPoP": dpopProofWithNonce,
          },
          body: new URLSearchParams(tokenParams),
        });

        if (!retryResponse.ok) {
          const retryErrorData = await retryResponse.json();
          console.error("Token exchange retry failed:", retryErrorData);
          return c.json({
            error: "Token exchange failed after nonce retry",
            details: retryErrorData,
            status: retryResponse.status,
          }, 500);
        }

        // Use the retry response for the rest of the flow
        const tokens = await retryResponse.json();

        // Extract handle and DID from the token response
        let handle = null;
        const did = tokens.sub;

        // Check if we already have a handle stored for this DID
        const existingAccount = await getUserAccount();
        if (
          existingAccount?.atproto_did === did &&
          existingAccount?.atproto_handle
        ) {
          handle = existingAccount.atproto_handle;
        } else {
          // Use proper ATProto identity resolution
          try {
            handle = await identityResolver.resolveDidToHandle(did);
          } catch (_error) {
            // Identity resolution failed, handle will remain null
          }
        }

        // Verify the handle matches the allowed handle for this service
        const allowedHandle = Deno.env.get("ATPROTO_ALLOWED_HANDLE");
        if (allowedHandle && handle !== allowedHandle) {
          console.error(
            `OAuth rejected: handle ${handle} does not match allowed handle ${allowedHandle}`,
          );
          return c.json({
            error: "Unauthorized",
            message:
              `This service is configured for ${allowedHandle} only. You are logged in as ${handle}.`,
          }, 403);
        }

        // Update user account with ATProto tokens and DPoP keys
        await updateUserAccount({
          atproto_did: did,
          atproto_pds_url: pdsUrl,
          atproto_handle: handle,
          atproto_access_token: tokens.access_token,
          atproto_refresh_token: tokens.refresh_token,
          atproto_token_expires_at: tokens.expires_in
            ? Date.now() + (tokens.expires_in * 1000)
            : undefined,
          atproto_dpop_private_key: dpopPrivateKeyJwkStr,
          atproto_dpop_public_jwk: dpopPublicJwkStr,
        });

        // Clear OAuth cookies
        setCookie(c, "oauth_state", "", { maxAge: 0 });
        setCookie(c, "oauth_code_verifier", "", { maxAge: 0 });
        setCookie(c, "oauth_user_id", "", { maxAge: 0 });
        setCookie(c, "oauth_pds_url", "", { maxAge: 0 });
        setCookie(c, "oauth_dpop_private_key", "", { maxAge: 0 });
        setCookie(c, "oauth_dpop_public_jwk", "", { maxAge: 0 });

        // Use Hono's redirect method to ensure cookies are included
        return c.redirect(`/setup?step=mastodon&user_id=${userId}`);
      } else {
        // Not a nonce error, some other issue
      }

      return c.json({
        error: "Token exchange failed",
        details: errorData,
        status: tokenResponse.status,
      }, 500);
    }

    const tokens = await tokenResponse.json();

    // Extract handle from the sub field (DID)
    let handle = null;
    const did = tokens.sub;

    // Check if we already have a handle stored for this DID
    const existingAccount = await getUserAccount();
    if (
      existingAccount?.atproto_did === did && existingAccount?.atproto_handle
    ) {
      handle = existingAccount.atproto_handle;
    } else {
      // Use proper ATProto identity resolution
      try {
        handle = await identityResolver.resolveDidToHandle(did);
      } catch (_error) {
        // Identity resolution failed, handle will remain null
      }
    }

    // Verify the handle matches the allowed handle for this service
    const allowedHandle = Deno.env.get("ATPROTO_ALLOWED_HANDLE");
    if (allowedHandle && handle !== allowedHandle) {
      console.error(
        `OAuth rejected: handle ${handle} does not match allowed handle ${allowedHandle}`,
      );
      return c.json({
        error: "Unauthorized",
        message:
          `This service is configured for ${allowedHandle} only. You are logged in as ${handle}.`,
      }, 403);
    }

    // Update user account with ATProto tokens and DPoP keys
    await updateUserAccount({
      atproto_did: did,
      atproto_pds_url: pdsUrl,
      atproto_handle: handle,
      atproto_access_token: tokens.access_token,
      atproto_refresh_token: tokens.refresh_token,
      atproto_token_expires_at: tokens.expires_in
        ? Date.now() + (tokens.expires_in * 1000)
        : undefined,
      atproto_dpop_private_key: dpopPrivateKeyJwkStr,
      atproto_dpop_public_jwk: dpopPublicJwkStr,
    });

    // Clear OAuth cookies
    setCookie(c, "oauth_state", "", { maxAge: 0 });
    setCookie(c, "oauth_code_verifier", "", { maxAge: 0 });
    setCookie(c, "oauth_user_id", "", { maxAge: 0 });
    setCookie(c, "oauth_pds_url", "", { maxAge: 0 });
    setCookie(c, "oauth_dpop_private_key", "", { maxAge: 0 });
    setCookie(c, "oauth_dpop_public_jwk", "", { maxAge: 0 });

    // Use Hono's redirect method to ensure cookies are included
    return c.redirect(`/setup?step=mastodon&user_id=${userId}`);
  } catch (error) {
    console.error("ATProto OAuth callback error:", error);
    console.error("Error details:", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      code: code?.substring(0, 20) + "...",
      state: state?.substring(0, 20) + "...",
      storedState: getCookie(c, "oauth_state")?.substring(0, 20) + "...",
      userId: getCookie(c, "oauth_user_id"),
      pdsUrl: getCookie(c, "oauth_pds_url"),
    });
    return c.json({
      error: "OAuth callback failed",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

// Mastodon OAuth routes
oauth.get("/mastodon/start", async (c) => {
  const instanceUrl = c.req.query("instance_url");
  const userId = c.req.query("user_id");
  if (!instanceUrl || !userId) {
    return c.json({ error: "Instance URL and user_id are required" }, 400);
  }

  try {
    // Normalize instance URL
    const normalizedUrl = instanceUrl.startsWith("http")
      ? instanceUrl
      : `https://${instanceUrl}`;

    // Register application with Mastodon instance
    const appResponse = await fetch(`${normalizedUrl}/api/v1/apps`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_name: "ATProto-to-Fediverse Bridge",
        redirect_uris: `${
          c.req.url.split("/oauth")[0]
        }/oauth/mastodon/callback`,
        scopes: "read write",
        website: c.req.url.split("/oauth")[0],
      }),
    });

    if (!appResponse.ok) {
      const errorData = await appResponse.text();
      console.error("Mastodon app registration failed:", errorData);
      return c.json(
        { error: "Failed to register with Mastodon instance" },
        500,
      );
    }

    const appData = await appResponse.json();

    // Store app credentials in user account
    await updateUserAccount({
      mastodon_instance_url: normalizedUrl,
      mastodon_client_id: appData.client_id,
      mastodon_client_secret: appData.client_secret,
    });

    // Generate OAuth parameters
    const state = generateState();

    // Store OAuth state in cookies
    setCookie(c, "mastodon_oauth_state", state, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: 600, // 10 minutes
    });
    setCookie(c, "mastodon_oauth_user_id", userId, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: 600,
    });

    // Build authorization URL
    const authUrl = new URL(`${normalizedUrl}/oauth/authorize`);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", appData.client_id);
    const redirectUri = `${
      c.req.url.split("/oauth")[0]
    }/oauth/mastodon/callback`;
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", "read write");
    authUrl.searchParams.set("state", state);

    return c.json({ authUrl: authUrl.toString() });
  } catch (error) {
    console.error("Mastodon OAuth start error:", error);
    return c.json({ error: "Failed to start OAuth flow" }, 500);
  }
});

oauth.get("/mastodon/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");
  if (error) {
    return c.json({ error: `OAuth error: ${error}` }, 400);
  }

  if (!code || !state) {
    return c.json({ error: "Missing code or state" }, 400);
  }

  // Verify state
  const storedState = getCookie(c, "mastodon_oauth_state");
  if (state !== storedState) {
    return c.json({ error: "Invalid state parameter" }, 400);
  }

  try {
    const userId = getCookie(c, "mastodon_oauth_user_id");
    if (!userId) {
      return c.json({ error: "Missing user ID" }, 400);
    }

    // Get user account to retrieve app credentials
    const userAccount = await getUserAccount();
    if (
      !userAccount?.mastodon_client_id ||
      !userAccount?.mastodon_client_secret ||
      !userAccount?.mastodon_instance_url
    ) {
      return c.json({ error: "Missing Mastodon app credentials" }, 400);
    }

    // Exchange code for tokens
    const tokenResponse = await fetch(
      `${userAccount.mastodon_instance_url}/oauth/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code,
          redirect_uri: `${
            c.req.url.split("/oauth")[0]
          }/oauth/mastodon/callback`,
          client_id: userAccount.mastodon_client_id,
          client_secret: userAccount.mastodon_client_secret,
        }),
      },
    );

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error("Mastodon token exchange failed:", errorData);
      return c.json({
        error: "Token exchange failed",
        details: errorData,
        endpoint: `${userAccount.mastodon_instance_url}/oauth/token`,
      }, 500);
    }

    const tokens = await tokenResponse.json();

    // Get user profile
    const profileResponse = await fetch(
      `${userAccount.mastodon_instance_url}/api/v1/accounts/verify_credentials`,
      {
        headers: {
          "Authorization": `Bearer ${tokens.access_token}`,
        },
      },
    );

    let userProfile: any = {};
    if (profileResponse.ok) {
      userProfile = await profileResponse.json();
    }

    // Update user account with Mastodon tokens
    await updateUserAccount({
      mastodon_access_token: tokens.access_token,
      mastodon_username: userProfile.username || userProfile.acct,
      setup_completed: true, // Both accounts are now connected
    });

    // Get updated user account to get the handle
    const updatedUser = await getUserAccount();
    const handle = updatedUser?.atproto_handle || userProfile.username ||
      userProfile.acct;

    // Create session automatically after successful setup
    const { sessionToken } = await createUserSession(userId, handle);
    // Clear OAuth cookies
    setCookie(c, "oauth_state", "", { maxAge: 0, path: "/" });
    setCookie(c, "oauth_code_verifier", "", { maxAge: 0, path: "/" });
    setCookie(c, "oauth_user_id", "", { maxAge: 0, path: "/" });
    setCookie(c, "oauth_pds_url", "", { maxAge: 0, path: "/" });
    setCookie(c, "oauth_dpop_private_key", "", { maxAge: 0, path: "/" });
    setCookie(c, "oauth_dpop_public_jwk", "", { maxAge: 0, path: "/" });
    setCookie(c, "mastodon_oauth_state", "", { maxAge: 0, path: "/" });
    setCookie(c, "mastodon_oauth_user_id", "", { maxAge: 0, path: "/" });

    // Set session cookie for automatic login
    // Check if we're on HTTPS (Val.town should be)
    const isHttps = c.req.url.startsWith("https://");

    const cookieOptions = {
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: "/",
      httpOnly: true,
      secure: isHttps, // Only set secure flag on HTTPS
      sameSite: "Lax" as const,
    };

    setCookie(c, "session_token", sessionToken, cookieOptions);

    // Instead of direct redirect, return HTML with JavaScript redirect
    // This ensures cookies are set before the redirect happens
    const redirectHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Setup Complete</title>
        <script>
          // Wait a bit longer to ensure cookies are set
          setTimeout(() => {
            // Check if cookie is set
            console.log('Cookies before redirect:', document.cookie);
            window.location.href = '/dashboard';
          }, 500);
        </script>
      </head>
      <body>
        <p>Setup complete! Redirecting to dashboard...</p>
        <p style="color: #666; font-size: 12px;">Session: ${
      sessionToken.substring(0, 8)
    }...</p>
      </body>
      </html>
    `;

    // Use Hono's response method to ensure cookies are included
    c.header("Content-Type", "text/html");
    c.header("Cache-Control", "no-cache");
    return c.html(redirectHtml);
  } catch (error) {
    console.error("Mastodon OAuth callback error:", error);
    return c.json({
      error: "OAuth callback failed",
      details: error.message,
    }, 500);
  }
});

export default oauth;
