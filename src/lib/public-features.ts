export type PublicFeatures = { policyBackground: boolean; watch: boolean };

export function publicFeaturesFromEnv(env: { POLICY_BACKGROUND_PUBLIC_ENABLED?: unknown; WATCH_PUBLIC_ENABLED?: unknown }): PublicFeatures {
  return { policyBackground: env.POLICY_BACKGROUND_PUBLIC_ENABLED === "true", watch: env.WATCH_PUBLIC_ENABLED === "true" };
}

export function normalizePublicFeatures(value: unknown): PublicFeatures {
  return { policyBackground: typeof value === "object" && value !== null &&
    Object.hasOwn(value, "policyBackground") && (value as PublicFeatures).policyBackground === true,
    watch: typeof value === "object" && value !== null && Object.hasOwn(value, "watch") && (value as PublicFeatures).watch === true };
}

/** An advisory display signal. Server routes independently enforce the public gate. */
export function publicFeatures(): PublicFeatures {
  return normalizePublicFeatures((globalThis as { __VALLEY_DESK_PUBLIC_FEATURES__?: unknown }).__VALLEY_DESK_PUBLIC_FEATURES__);
}
