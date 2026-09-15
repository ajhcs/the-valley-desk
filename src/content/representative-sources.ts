export const REPRESENTATIVE_LOOKUPS = [
  { jurisdiction: "federal", jurisdictionId: "us-pa", bodyId: "us-house", label: "U.S. House - Pennsylvania", lookupUrl: "https://www.house.gov/representatives/find-your-representative" },
  { jurisdiction: "federal", jurisdictionId: "us-nj", bodyId: "us-house", label: "U.S. House - New Jersey", lookupUrl: "https://www.house.gov/representatives/find-your-representative" },
  { jurisdiction: "federal", jurisdictionId: "us-de", bodyId: "us-house", label: "U.S. House - Delaware", lookupUrl: "https://www.house.gov/representatives/find-your-representative" },
  { jurisdiction: "federal", jurisdictionId: "us-pa", bodyId: "us-senate", label: "U.S. Senate - Pennsylvania", lookupUrl: "https://www.senate.gov/senators/" },
  { jurisdiction: "federal", jurisdictionId: "us-nj", bodyId: "us-senate", label: "U.S. Senate - New Jersey", lookupUrl: "https://www.senate.gov/senators/" },
  { jurisdiction: "federal", jurisdictionId: "us-de", bodyId: "us-senate", label: "U.S. Senate - Delaware", lookupUrl: "https://www.senate.gov/senators/" },
  { jurisdiction: "PA", jurisdictionId: "pa", bodyId: "pa-house", label: "Pennsylvania House", lookupUrl: "https://www.palegis.us/find-my-legislator" },
  { jurisdiction: "PA", jurisdictionId: "pa", bodyId: "pa-senate", label: "Pennsylvania Senate", lookupUrl: "https://www.palegis.us/find-my-legislator" },
  { jurisdiction: "NJ", jurisdictionId: "nj", bodyId: "nj-assembly", label: "New Jersey Assembly", lookupUrl: "https://www.njleg.state.nj.us/legislative-roster" },
  { jurisdiction: "NJ", jurisdictionId: "nj", bodyId: "nj-senate", label: "New Jersey Senate", lookupUrl: "https://www.njleg.state.nj.us/legislative-roster" },
  { jurisdiction: "DE", jurisdictionId: "de", bodyId: "de-house", label: "Delaware House", lookupUrl: "https://legis.delaware.gov/FindMyLegislator" },
  { jurisdiction: "DE", jurisdictionId: "de", bodyId: "de-senate", label: "Delaware Senate", lookupUrl: "https://legis.delaware.gov/FindMyLegislator" },
] as const;

// Source permission is chamber-specific, not inferred from jurisdiction alone.
export const REPRESENTATIVE_ROSTER_ENDPOINTS = [
  { url: "https://www.senate.gov/general/contact_information/senators_cfm.xml", bodyIds: ["us-senate"] },
  { url: "https://pub.njleg.state.nj.us/leg-databases/2026data/DB2026_TEXT.zip", bodyIds: ["nj-senate", "nj-assembly"] },
  { url: "https://www.palegis.us/senate/members", bodyIds: ["pa-senate"] },
  { url: "https://www.palegis.us/house/members", bodyIds: ["pa-house"] },
] as const;
