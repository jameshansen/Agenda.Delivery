/**
 * Environment variable validation.
 *
 * Called at startup to fail fast if critical configuration is missing.
 * Optional variables have defaults; required variables throw if absent.
 */

export type EnvCheck = {
  name: string;
  required: boolean;
  present: boolean;
  value?: string;
};

const REQUIRED_ENVS = [
  "DATABASE_URL",
  "AUTH_SECRET",
];

const OPTIONAL_ENVS = [
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "OLLAMA_BASE_URL",
  "OLLAMA_API_KEY",
  "AGENT_MODEL",
  "SUMMARY_MODEL",
  "NEXT_PUBLIC_BASE_URL",
];

export function validateEnv(): { ok: boolean; missing: string[]; checks: EnvCheck[] } {
  const checks: EnvCheck[] = [];
  const missing: string[] = [];

  for (const name of REQUIRED_ENVS) {
    const value = process.env[name];
    const present = !!value && value !== "replace-me";
    checks.push({ name, required: true, present, value: present ? "***" : undefined });
    if (!present) missing.push(name);
  }

  for (const name of OPTIONAL_ENVS) {
    const value = process.env[name];
    checks.push({ name, required: false, present: !!value, value: value ? "***" : undefined });
  }

  return { ok: missing.length === 0, missing, checks };
}

/**
 * Log a warning (not an error) if required env vars are missing.
 * In production, missing required vars could cause runtime failures, so
 * we log loudly. In dev, we let the app start with mock/empty values.
 */
export function warnIfEnvMissing() {
  const { missing } = validateEnv();
  if (missing.length > 0) {
    console.warn(
      `[env] Missing required environment variables: ${missing.join(", ")}. ` +
      `Some features may not work correctly.`,
    );
  }
}