import { Hono } from "https://esm.sh/hono@3.11.7";
import {
  deleteCookie,
  getCookie,
  setCookie,
} from "https://esm.sh/hono@3.11.7/cookie";
import {
  getUserAccountByHandle,
  updateUserAccount,
} from "../database/queries.ts";
import {
  createUserSession,
  deleteSession,
  getSession,
} from "../lib/session.ts";
const auth = new Hono();

// Login with Bluesky handle
auth.post("/login", async (c) => {
  const { handle } = await c.req.json();

  if (!handle) {
    return c.json({ error: "Handle is required" }, 400);
  }

  try {
    // Find user by handle
    const user = await getUserAccountByHandle(handle);

    if (!user) {
      return c.json({
        error: "No account found for this handle. Please complete setup first.",
      }, 404);
    }

    if (!user.setup_completed) {
      return c.json({
        error: "Setup not completed. Please finish setup first.",
      }, 400);
    }

    // Create session
    const { sessionToken } = await createUserSession(
      user.id.toString(),
      user.atproto_handle || handle,
    );

    // Set session cookie with simple settings (same as OAuth cookies)
    setCookie(c, "session_token", sessionToken, {
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: "/",
    });

    return c.json({
      success: true,
      userId: user.id,
      handle: user.atproto_handle || handle,
    });
  } catch (error) {
    console.error("Login error:", error);
    return c.json({ error: "Login failed" }, 500);
  }
});

// Logout
auth.post("/logout", async (c) => {
  const sessionToken = getCookie(c, "session_token");

  if (sessionToken) {
    await deleteSession(sessionToken);
    deleteCookie(c, "session_token");
  }

  return c.json({ success: true });
});

// Disconnect Bluesky account
auth.post("/disconnect/bluesky", requireAuth(), async (c) => {
  const _userId = c.get("userId") as string;

  try {
    await updateUserAccount({
      atproto_did: null,
      atproto_pds_url: null,
      atproto_handle: null,
      atproto_access_token: null,
      atproto_refresh_token: null,
      atproto_token_expires_at: null,
    });

    return c.json({ success: true, message: "Bluesky account disconnected" });
  } catch (error) {
    console.error("Bluesky disconnect error:", error);
    return c.json({ error: "Failed to disconnect Bluesky account" }, 500);
  }
});

// Disconnect Mastodon account
auth.post("/disconnect/mastodon", requireAuth(), async (c) => {
  const _userId = c.get("userId") as string;

  try {
    await updateUserAccount({
      mastodon_instance_url: null,
      mastodon_username: null,
      mastodon_access_token: null,
      mastodon_client_id: null,
      mastodon_client_secret: null,
    });

    return c.json({ success: true, message: "Mastodon account disconnected" });
  } catch (error) {
    console.error("Mastodon disconnect error:", error);
    return c.json({ error: "Failed to disconnect Mastodon account" }, 500);
  }
});

// Get current user
auth.get("/me", async (c) => {
  const sessionToken = getCookie(c, "session_token");

  if (!sessionToken) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  const session = await getSession(sessionToken);

  if (!session) {
    deleteCookie(c, "session_token");
    return c.json({ error: "Session expired" }, 401);
  }

  return c.json({
    userId: session.userId,
    handle: session.handle,
    authenticated: true,
  });
});

// Middleware to check authentication
export function requireAuth() {
  return async (c: any, next: any) => {
    const sessionToken = getCookie(c, "session_token");
    if (!sessionToken) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const session = await getSession(sessionToken);
    if (!session) {
      deleteCookie(c, "session_token");
      return c.json({ error: "Session expired" }, 401);
    }

    // Add user info to context
    c.set("userId", session.userId);
    c.set("handle", session.handle);
    await next();
  };
}

export default auth;
