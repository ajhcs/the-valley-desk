globalThis.fetch = async () => { throw new Error("Unexpected network request in offline evaluation"); };
const protectedNames = new Set(["OPENROUTER_API_KEY", "EDITOR_MODEL_API_KEY", "REVIEW_API_TOKEN", "SOCIAL_INGEST_TOKEN"]);
process.env = new Proxy(process.env, {
  get(target, name) {
    if (protectedNames.has(name)) throw new Error("Offline evaluation must not inspect operational credentials");
    return Reflect.get(target, name);
  },
});
