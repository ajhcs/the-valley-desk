import { publicOrigin, resolvePublicOrigin } from "./canonical";

export function calendarSubscriptionUrls(origin=publicOrigin()) {
  const download=resolvePublicOrigin(origin)+"/events.ics";
  return {download,subscribe:download.replace(/^https:/,"webcal:")};
}

