import { Hono } from "https://esm.sh/hono@3.11.7";
import {
  createDefaultSettings,
  createUserAccount,
  getUserAccount,
  updateUserAccount,
} from "../database/queries.ts";
import { SetupState, SetupStep } from "../../shared/types.ts";

const setup = new Hono();

// Get setup state for the single user
async function getSetupState(): Promise<SetupState> {
  const userAccount = await getUserAccount();

  const steps: SetupStep[] = [
    {
      id: "create-account",
      title: "Create Bridge Account",
      description: "Initialize your bridge account",
      completed: !!userAccount,
    },
    {
      id: "connect-bluesky",
      title: "Connect Bluesky Account",
      description: "Connect your Bluesky/ATProto account using OAuth",
      completed: !!userAccount?.atproto_access_token,
    },
    {
      id: "connect-mastodon",
      title: "Connect Mastodon Account",
      description: "Connect your Mastodon account using OAuth",
      completed: !!userAccount?.mastodon_access_token,
    },
    {
      id: "configure-sync",
      title: "Configure Sync Settings",
      description: "Set up your synchronization preferences",
      completed: !!userAccount?.setup_completed,
    },
  ];

  const completedSteps = steps.filter((s) => s.completed).length;
  const currentStep = Math.min(completedSteps, steps.length - 1);

  return {
    currentStep,
    steps,
    userId: "single-user", // For backward compatibility
    atprotoConnected: !!userAccount?.atproto_access_token,
    mastodonConnected: !!userAccount?.mastodon_access_token,
    setupCompleted: !!userAccount?.setup_completed,
  };
}

// Start setup - get or create the single user account
setup.post("/start", async (c) => {
  try {
    // For single-user service, get or create the single user account
    let userAccount = await getUserAccount();

    if (!userAccount) {
      // Create the single user account
      userAccount = await createUserAccount();
      await createDefaultSettings();
    }

    const setupState = await getSetupState();

    return c.json({
      success: true,
      userId: "single-user", // For backward compatibility
      setupState,
    });
  } catch (error) {
    console.error("Setup start error:", error);
    return c.json({ error: "Failed to start setup" }, 500);
  }
});

// Get setup state
setup.get("/state/:userId", async (c) => {
  const _userId = c.req.param("userId");

  try {
    const setupState = await getSetupState();
    return c.json(setupState);
  } catch (error) {
    console.error("Setup state error:", error);
    return c.json({ error: "Failed to get setup state" }, 500);
  }
});

// Complete setup
setup.post("/complete/:userId", async (c) => {
  const _userId = c.req.param("userId");

  try {
    const userAccount = await getUserAccount();

    if (!userAccount) {
      return c.json({ error: "User account not found" }, 404);
    }

    // Verify both accounts are connected
    if (
      !userAccount.atproto_access_token || !userAccount.mastodon_access_token
    ) {
      return c.json({
        error: "Both accounts must be connected before completing setup",
      }, 400);
    }

    // Mark setup as completed
    await updateUserAccount({
      setup_completed: true,
    });

    const setupState = await getSetupState();

    return c.json({
      success: true,
      setupState,
    });
  } catch (error) {
    console.error("Setup complete error:", error);
    return c.json({ error: "Failed to complete setup" }, 500);
  }
});

// Check if user is already set up (for landing page redirect)
setup.get("/check", (c) => {
  try {
    // For now, we'll use a simple approach - check if there's any completed setup
    // In a real app, you'd check based on session/auth
    // This is a placeholder that always returns no user for new visitors

    // TODO: Implement proper user session/auth checking
    // For now, return no user so landing page works as expected
    return c.json({
      hasSetupUser: false,
      userId: null,
    });
  } catch (error) {
    console.error("Setup check error:", error);
    return c.json({ error: "Failed to check setup status" }, 500);
  }
});

// Test connections
setup.post("/test-connections/:userId", async (c) => {
  const _userId = c.req.param("userId");

  try {
    const userAccount = await getUserAccount();

    if (!userAccount) {
      return c.json({ error: "User account not found" }, 404);
    }

    const results = {
      atproto: { connected: false, error: null as string | null },
      mastodon: { connected: false, error: null as string | null },
    };

    // Test ATProto connection
    if (userAccount.atproto_access_token && userAccount.atproto_pds_url) {
      try {
        const response = await fetch(
          `${userAccount.atproto_pds_url}/xrpc/com.atproto.identity.resolveHandle?handle=${userAccount.atproto_handle}`,
          {
            headers: {
              "Authorization": `Bearer ${userAccount.atproto_access_token}`,
            },
          },
        );

        if (response.ok) {
          results.atproto.connected = true;
        } else {
          results.atproto.error =
            `HTTP ${response.status}: ${response.statusText}`;
        }
      } catch (error) {
        results.atproto.error = error instanceof Error
          ? error.message
          : "Unknown error";
      }
    } else {
      results.atproto.error = "No ATProto credentials found";
    }

    // Test Mastodon connection
    if (
      userAccount.mastodon_access_token && userAccount.mastodon_instance_url
    ) {
      try {
        const response = await fetch(
          `${userAccount.mastodon_instance_url}/api/v1/accounts/verify_credentials`,
          {
            headers: {
              "Authorization": `Bearer ${userAccount.mastodon_access_token}`,
            },
          },
        );

        if (response.ok) {
          results.mastodon.connected = true;
        } else {
          results.mastodon.error =
            `HTTP ${response.status}: ${response.statusText}`;
        }
      } catch (error) {
        results.mastodon.error = error instanceof Error
          ? error.message
          : "Unknown error";
      }
    } else {
      results.mastodon.error = "No Mastodon credentials found";
    }

    return c.json(results);
  } catch (error) {
    console.error("Test connections error:", error);
    return c.json({ error: "Failed to test connections" }, 500);
  }
});

export default setup;
