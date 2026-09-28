import "server-only";

/**
 * Server-side environment access.
 *
 * Everything in this module is server-only by construction: importing it
 * from a Client Component is a build error, which is the guarantee that
 * SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_ACCESS_TOKEN and friends can never
 * be bundled into browser JavaScript.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export const serverEnv = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get n8nApiSecret() {
    return required("N8N_API_SECRET");
  },
  get whatsappAccessToken() {
    return required("WHATSAPP_ACCESS_TOKEN");
  },
  get whatsappPhoneNumberId() {
    return required("WHATSAPP_PHONE_NUMBER_ID");
  },
  get whatsappBusinessAccountId() {
    return optional("WHATSAPP_BUSINESS_ACCOUNT_ID");
  },
  get whatsappVerifyToken() {
    return required("WHATSAPP_VERIFY_TOKEN");
  },
  get metaAppSecret() {
    return optional("META_APP_SECRET");
  },
  get whatsappApiVersion() {
    return optional("WHATSAPP_API_VERSION") ?? "v21.0";
  },
  get appUrl() {
    return optional("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000";
  },
} as const;

/** True when outbound sends are simulated instead of hitting Meta. */
export function isMockMode(): boolean {
  return bool("WHATSAPP_MOCK_MODE", true);
}

/** Vercel sets this to "production" on the production deployment. */
export function isProductionEnvironment(): boolean {
  return (process.env.VERCEL_ENV ?? process.env.NODE_ENV) === "production";
}

/**
 * Mock mode in production is legal (useful for a dry run) but must never
 * be silent — the dashboard renders a banner when this returns true.
 */
export function isDangerousMockMode(): boolean {
  return isMockMode() && isProductionEnvironment();
}
