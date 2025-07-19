/** @jsxImportSource https://esm.sh/react@18.2.0 */
import React, { useEffect, useState } from "https://esm.sh/react@18.2.0";
import ReactDOM from "https://esm.sh/react-dom@18.2.0/client";

interface User {
  userId: string;
  handle: string;
  authenticated: boolean;
}

interface EnvironmentVar {
  set: boolean;
  description: string;
  required: boolean;
}

interface SetupStep {
  id: string;
  title: string;
  completed: boolean;
  description: string;
}

interface SetupStatus {
  environmentVars: Record<string, EnvironmentVar>;
  setupSteps: SetupStep[];
  overallReady: boolean;
}

function LandingApp() {
  const [_user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);

  useEffect(() => {
    checkAuth();
    fetchSetupStatus();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await fetch("/api/auth/me");
      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        // Redirect authenticated users to dashboard
        globalThis.location.href = "/dashboard";
      }
    } catch (_error) {
      console.log("Not authenticated");
    } finally {
      setLoading(false);
    }
  };

  const fetchSetupStatus = async () => {
    try {
      const response = await fetch("/api/setup/status");
      if (response.ok) {
        const status = await response.json();
        setSetupStatus(status);
      }
    } catch (error) {
      console.error("Failed to fetch setup status:", error);
    }
  };

  const handleGetStarted = () => {
    globalThis.location.href = "/setup";
  };

  const handleLogin = () => {
    globalThis.location.href = "/login";
  };

  if (loading) {
    return (
      <div className="bg-gray-50 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl text-gray-600">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-2xl mx-auto py-16 px-4">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            ATProto to Fediverse Bridge
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Connect your Bluesky account to Mastodon and automatically
            cross-post your content
          </p>

          <div className="space-y-4">
            <button
              type="button"
              onClick={handleGetStarted}
              className="bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors mr-4"
            >
              Get Started
            </button>

            <button
              type="button"
              onClick={handleLogin}
              className="bg-white text-blue-600 px-8 py-3 rounded-lg font-semibold border border-blue-600 hover:bg-blue-50 transition-colors"
            >
              Sign In
            </button>
          </div>
        </div>

        {/* Setup Status Checklist */}
        {setupStatus && (
          <div className="mt-12 bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Setup Status
            </h2>
            <p className="text-gray-600 mb-6">
              Here's what you need to configure to get your bridge running:
            </p>

            {/* Environment Variables Section */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <span className="mr-2">🔧</span>
                Environment Variables
              </h3>
              <div className="space-y-3">
                {Object.entries(setupStatus.environmentVars).map((
                  [key, env],
                ) => (
                  <div key={key} className="flex items-start space-x-3">
                    <div className="flex-shrink-0 mt-1">
                      {env.set
                        ? (
                          <span className="inline-block w-4 h-4 bg-green-500 rounded-full">
                          </span>
                        )
                        : (
                          <span className="inline-block w-4 h-4 bg-red-500 rounded-full">
                          </span>
                        )}
                    </div>
                    <div className="flex-1">
                      <div className="font-mono text-sm font-medium text-gray-900">
                        {key}
                      </div>
                      <div className="text-sm text-gray-600">
                        {env.description}
                      </div>
                      {!env.set && env.required && (
                        <div className="text-xs text-red-600 mt-1">
                          ⚠️ Required - needs to be set in environment
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Setup Steps Section */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <span className="mr-2">📋</span>
                Setup Steps
              </h3>
              <div className="space-y-3">
                {setupStatus.setupSteps.map((step) => (
                  <div key={step.id} className="flex items-start space-x-3">
                    <div className="flex-shrink-0 mt-1">
                      {step.completed
                        ? (
                          <span className="inline-block w-4 h-4 bg-green-500 rounded-full">
                          </span>
                        )
                        : (
                          <span className="inline-block w-4 h-4 bg-gray-300 rounded-full">
                          </span>
                        )}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">
                        {step.title}
                      </div>
                      <div className="text-sm text-gray-600">
                        {step.description}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Overall Status */}
            <div
              className={`p-4 rounded-lg ${
                setupStatus.overallReady
                  ? "bg-green-50 border border-green-200"
                  : "bg-yellow-50 border border-yellow-200"
              }`}
            >
              <div className="flex items-center">
                <span className="text-xl mr-2">
                  {setupStatus.overallReady ? "✅" : "⚠️"}
                </span>
                <div>
                  <div className="font-semibold">
                    {setupStatus.overallReady
                      ? "Ready to go!"
                      : "Setup required"}
                  </div>
                  <div className="text-sm text-gray-600">
                    {setupStatus.overallReady
                      ? "All environment variables are configured. You can start setting up your accounts."
                      : "Please configure the missing environment variables before proceeding."}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-16 grid md:grid-cols-2 gap-8">
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h3 className="text-lg font-semibold mb-2">🔗 Easy Setup</h3>
            <p className="text-gray-600">
              Connect your accounts with secure OAuth in just a few clicks
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h3 className="text-lg font-semibold mb-2">⚡ Automatic Sync</h3>
            <p className="text-gray-600">
              Your Bluesky posts automatically appear on Mastodon
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h3 className="text-lg font-semibold mb-2">📱 Media Support</h3>
            <p className="text-gray-600">
              Images and videos are cross-posted along with your text
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h3 className="text-lg font-semibold mb-2">🔒 Private & Secure</h3>
            <p className="text-gray-600">
              All data is encrypted and stored securely
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Initialize React app
const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<LandingApp />);
