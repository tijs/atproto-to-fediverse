import { Hono } from "https://esm.sh/hono@3.11.7";
import {
  readFile,
  serveFile,
} from "https://esm.town/v/std/utils@85-main/index.ts";
import { runMigrations } from "./database/migrations.ts";
import oauthRoutes from "./routes/oauth.ts";
import setupRoutes from "./routes/setup.ts";
import dashboardRoutes from "./routes/dashboard.ts";
import authRoutes from "./routes/auth.ts";
import { initSessionsTable } from "./lib/session-db.ts";

const app = new Hono();

// Unwrap Hono errors to see original error details
app.onError((err, _c) => {
  throw err;
});

// Initialize database on startup
await runMigrations();
await initSessionsTable();

// API routes
app.route("/api/oauth", oauthRoutes);
app.route("/api/setup", setupRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/dashboard", dashboardRoutes);

// Health check endpoint
app.get("/api/health", (c) => {
  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "atproto-to-fediverse-bridge",
  });
});

// Setup status endpoint - shows what environment variables and steps are needed
app.get("/api/setup/status", (c) => {
  const environmentVars = {
    ATPROTO_APP_PASSWORD: {
      set: !!Deno.env.get("ATPROTO_APP_PASSWORD"),
      description: "Bluesky App Password for sync service",
      required: true,
    },
    ATPROTO_ALLOWED_HANDLE: {
      set: !!Deno.env.get("ATPROTO_ALLOWED_HANDLE"),
      description: "Allowed Bluesky handle for this single-user service",
      required: true,
    },
    VALTOWN_URL: {
      set: !!Deno.env.get("VALTOWN_URL"),
      description: "Val.town deployment URL",
      required: true,
    },
  };

  const setupSteps = [
    {
      id: "env_vars",
      title: "Environment Variables",
      completed: Object.values(environmentVars).every((env) =>
        !env.required || env.set
      ),
      description: "Configure required environment variables",
    },
    {
      id: "oauth_setup",
      title: "Account Setup",
      completed: false, // This will be checked separately by looking at database
      description: "Connect your Bluesky and Mastodon accounts",
    },
  ];

  return c.json({
    environmentVars,
    setupSteps,
    overallReady: setupSteps.every((step) => step.completed),
  });
});

// Serve client metadata for ATProto OAuth
app.get("/client", (c) => {
  const rawUrl = Deno.env.get("VALTOWN_URL") || "http://localhost:8080";
  // Remove trailing slash to avoid double slashes in URLs
  const valtownUrl = rawUrl.replace(/\/$/, "");
  const clientMetadata = {
    client_id: `${valtownUrl}/client`,
    client_name: "ATProto to Fediverse Bridge",
    redirect_uris: [
      `${valtownUrl}/api/oauth/atproto/callback`,
    ],
    scope: "atproto transition:generic",
    response_types: ["code"],
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "none",
    dpop_bound_access_tokens: true,
  };
  return c.json(clientMetadata);
});

// Serve static files
app.get("/frontend/*", (c) => serveFile(c.req.path, import.meta.url));
app.get("/shared/*", (c) => serveFile(c.req.path, import.meta.url));

// Serve main application
app.get("/", async (c) => {
  let html = await readFile("/frontend/index.html", import.meta.url);

  // Basic data injection for initial page load
  const initialData = {
    appName: "ATProto-to-Fediverse Bridge",
    version: "1.0.0",
  };

  const dataScript = `<script>
    window.__INITIAL_DATA__ = ${JSON.stringify(initialData)};
  </script>`;

  html = html.replace("</head>", `${dataScript}</head>`);
  return c.html(html);
});

// Setup wizard routes
app.get("/setup", async (c) => {
  const html = await readFile("/frontend/setup.html", import.meta.url);
  return c.html(html);
});

// Login route
app.get("/login", async (c) => {
  const html = await readFile("/frontend/login.html", import.meta.url);
  return c.html(html);
});

// Dashboard route
app.get("/dashboard", async (c) => {
  const html = await readFile("/frontend/dashboard.html", import.meta.url);
  return c.html(html);
});

// Catch-all route for unhandled API requests
app.all("/api/*", (c) => {
  return c.json({ error: "Not found" }, 404);
});

// This is the entry point for HTTP vals
export default app.fetch;
