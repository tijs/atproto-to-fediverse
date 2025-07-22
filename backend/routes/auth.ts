import { Hono } from "https://esm.sh/hono@3.11.7";
import {
  deleteCookie,
  getCookie,
  setCookie,
} from "https://esm.sh/hono@3.11.7/cookie";
import {
  createUserAccount,
  getUserAccount,
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
    // Check if handle matches the allowed handle from environment
    const allowedHandle = Deno.env.get("ATPROTO_ALLOWED_HANDLE");
    
    if (!allowedHandle) {
      return c.json({
        error: "ATPROTO_ALLOWED_HANDLE not configured. Please set this environment variable.",
      }, 500);
    }

    // Normalize handles for comparison (remove @ if present, lowercase)
    const normalizedInput = handle.toLowerCase().replace(/^@/, '');
    const normalizedAllowed = allowedHandle.toLowerCase().replace(/^@/, '');

    if (normalizedInput !== normalizedAllowed) {
      return c.json({
        error: `This service is configured for ${allowedHandle} only.`,
      }, 403);
    }

    // For the allowed handle, always allow login
    // This helps with recovery when setup state is inconsistent
    let user = await getUserAccountByHandle(handle);

    // If no user exists yet, create one for the allowed handle
    if (!user) {
      user = await getUserAccount();
      if (!user) {
        // Create a new user account for the allowed handle
        await createUserAccount();
        user = await getUserAccount();
      }
    }

    // Create session regardless of setup completion status
    // This allows the user to access dashboard and fix issues
    const { sessionToken } = await createUserSession(
      user.id.toString(),
      handle,
    );

    // Set session cookie with simple settings (same as OAuth cookies)
    setCookie(c, "session_token", sessionToken, {
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: "/",
    });

    return c.json({
      success: true,
      userId: user.id,
      handle: handle,
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

/**
 * Middleware that blocks setup endpoints when setup is already completed.
 * Use this to prevent setup interference after both Bluesky and Mastodon are connected.
 */
export function blockIfSetupCompleted() {
  return async (c: any, next: any) => {
    try {
      const userAccount = await getUserAccount();

      // If setup is completed (both accounts connected), block access
      if (userAccount?.setup_completed) {
        const allowedHandle = Deno.env.get("ATPROTO_ALLOWED_HANDLE");
        return c.json({
          error:
            `Setup already completed. If you are ${allowedHandle}, please go to /login to access your dashboard and manage connections.`,
          loginUrl: "/login"
        }, 403);
      }

      await next();
    } catch (_error) {
      // If no user account exists yet, allow setup to proceed
      await next();
    }
  };
}

/**
 * Middleware that requires setup to be completed before accessing endpoint.
 * Use this for dashboard and other post-setup functionality.
 */
export function requireSetupCompleted() {
  return async (c: any, next: any) => {
    try {
      const userAccount = await getUserAccount();

      if (!userAccount?.setup_completed) {
        return c.json({
          error: "Complete setup first before accessing this feature.",
        }, 403);
      }

      await next();
    } catch (_error) {
      return c.json({
        error: "Complete setup first before accessing this feature.",
      }, 403);
    }
  };
}

export default auth;
