export type PublicFeatures = { policyBackground: boolean };

export function publicFeaturesFromEnv(env: { POLICY_BACKGROUND_PUBLIC_ENABLED?: unknown }): PublicFeatures {
  return { policyBackground: env.POLICY_BACKGROUND_PUBLIC_ENABLED === "true" };
}

export function normalizePublicFeatures(value: unknown): PublicFeatures {
  return { policyBackground: typeof value === "object" && value !== null &&
    Object.hasOwn(value, "policyBackground") && (value as PublicFeatures).policyBackground === true };
}

/** An advisory display signal. Server routes independently enforce the public gate. */
export function publicFeatures(): PublicFeatures {
  return normalizePublicFeatures((globalThis as { __VALLEY_DESK_PUBLIC_FEATURES__?: unknown }).__VALLEY_DESK_PUBLIC_FEATURES__);
}
