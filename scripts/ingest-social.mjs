import { ingestSocial } from "../src/ingest/social.ts";
import { readQueue, writeQueue } from "./ingest-queue.mjs";

const fetchedAt = new Date().toISOString();
const env = {
  X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
  LINKEDIN_TOKEN: process.env.LINKEDIN_TOKEN,
};
const social = await ingestSocial(env, new Date(fetchedAt));
const itemsOut = writeQueue(readQueue(), social.items, {
  fetchedAt,
  social: { linkedin: social.linkedin, x: social.x },
});
console.log("social", JSON.stringify({ linkedin: social.linkedin, x: social.x }));
console.log("wrote data/review-queue.json", itemsOut.length, "items");
