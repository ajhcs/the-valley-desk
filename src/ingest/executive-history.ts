const CREDENTIAL_RE = /\b(md|phd|dnp|mba|mph|mbi|ms|bs|bsn|emba|cism|rn|fache|do|jd|mpa|mha|fnp|np)\b/gi;

export type ExecutiveRole = {
  id: string;
  personId: string;
  institutionId: string;
  title: string;
  normalizedTitle: string;
  sourceId?: string;
  evidenceUrl?: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  verificationStatus?: "unverified" | "verified";
  verifiedAt?: string | null;
  verifiedBy?: string | null;
  verificationNote?: string | null;
  createdAt?: string;
};

export type RoleApplyRequest = {
  id?: string;
  personId: string;
  institutionId: string;
  title: string;
  sourceId?: string;
  evidenceUrl?: string;
  effectiveFrom: string;
  /** When set, close this open title instead of adding a concurrent role. */
  replacesNormalizedTitle?: string;
  verificationStatus?: "unverified" | "verified";
  verifiedAt?: string | null;
  verifiedBy?: string | null;
  verificationNote?: string | null;
};

export type RoleApplyResult = {
  roles: ExecutiveRole[];
  applied: "inserted" | "unchanged" | "superseded";
  closedRoleId?: string;
};

export function normalizePersonName(value: string) {
  return value
    .replace(CREDENTIAL_RE, " ")
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeTitle(value: string) {
  return value
    .replace(/[—–]/g, " ")
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function validEffectiveInstant(value: string) {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

export type CoveredPersonIdentity = {
  id: string;
  displayName: string;
  aliases: readonly string[];
  institutionIds: readonly string[];
};

/** Resolve only unique registry identities, scoped to the source institution. */
export function resolvePersonId(
  name: string,
  people: readonly CoveredPersonIdentity[],
  institutionId?: string,
) {
  const normalized = normalizePersonName(name);
  if (!normalized) return undefined;
  const candidates = people.filter((person) => (
    (!institutionId || person.institutionIds.includes(institutionId))
    && [person.displayName, ...person.aliases].some((value) => normalizePersonName(value) === normalized)
  ));
  return candidates.length === 1 ? candidates[0]!.id : undefined;
}

export function isRoleOpen(role: ExecutiveRole, at = role.effectiveFrom) {
  if (role.effectiveTo && role.effectiveTo <= at) return false;
  return role.effectiveFrom <= at;
}

export function openRolesFor(
  roles: readonly ExecutiveRole[],
  personId: string,
  institutionId: string,
  at: string,
) {
  return roles.filter((role) => (
    role.personId === personId
    && role.institutionId === institutionId
    && isRoleOpen(role, at)
  ));
}

function roleId(request: RoleApplyRequest) {
  return request.id ?? `role-${request.personId}-${request.institutionId}-${request.effectiveFrom}`;
}

/**
 * Preserve role history. Same open title is a no-op. Title changes close the
 * prior row with effective_to and insert a new row. Never mutate title in place.
 */
export function applyRoleChange(
  roles: readonly ExecutiveRole[],
  request: RoleApplyRequest,
): RoleApplyResult {
  const normalizedTitle = normalizeTitle(request.title);
  if (!normalizedTitle || !request.personId || !request.institutionId) {
    return { roles: [...roles], applied: "unchanged" };
  }
  const at = request.effectiveFrom;
  if (!validEffectiveInstant(at)) {
    return { roles: [...roles], applied: "unchanged" };
  }
  const open = openRolesFor(roles, request.personId, request.institutionId, at);
  const same = open.find((role) => role.normalizedTitle === normalizedTitle);
  if (same) {
    return { roles: [...roles], applied: "unchanged" };
  }

  const incoming: ExecutiveRole = {
    id: roleId(request),
    personId: request.personId,
    institutionId: request.institutionId,
    title: request.title.trim(),
    normalizedTitle,
    sourceId: request.sourceId,
    evidenceUrl: request.evidenceUrl,
    effectiveFrom: request.effectiveFrom,
    effectiveTo: null,
    ...(request.verificationStatus ? { verificationStatus: request.verificationStatus } : {}),
    ...(request.verifiedAt !== undefined ? { verifiedAt: request.verifiedAt } : {}),
    ...(request.verifiedBy !== undefined ? { verifiedBy: request.verifiedBy } : {}),
    ...(request.verificationNote !== undefined ? { verificationNote: request.verificationNote } : {}),
  };

  const replacementTitle = request.replacesNormalizedTitle
    ? normalizeTitle(request.replacesNormalizedTitle)
    : undefined;
  if (replacementTitle) {
    const previous = open.find((role) => role.normalizedTitle === replacementTitle);
    if (previous) {
      const closed: ExecutiveRole = { ...previous, effectiveTo: at };
      const next = roles.map((role) => (role.id === previous.id ? closed : role));
      if (next.some((role) => role.id === incoming.id)) {
        incoming.id = `${incoming.id}-next`;
      }
      return { roles: [...next, incoming], applied: "superseded", closedRoleId: previous.id };
    }
    // A requested replacement must never silently become a concurrent title.
    return { roles: [...roles], applied: "unchanged" };
  }

  return { roles: [...roles, incoming], applied: "inserted" };
}

export type ExtractedLeader = {
  name: string;
  normalizedName: string;
  title: string;
  normalizedTitle: string;
};

export type LeaderDiff = {
  appeared: ExtractedLeader[];
  departed: ExtractedLeader[];
  titleChanged: Array<{ previous: ExtractedLeader; next: ExtractedLeader }>;
  unchanged: ExtractedLeader[];
};

export function diffLeaders(
  previous: readonly ExtractedLeader[],
  next: readonly ExtractedLeader[],
): LeaderDiff {
  const prevByName = new Map(previous.map((row) => [row.normalizedName, row]));
  const nextByName = new Map(next.map((row) => [row.normalizedName, row]));
  const appeared: ExtractedLeader[] = [];
  const departed: ExtractedLeader[] = [];
  const titleChanged: Array<{ previous: ExtractedLeader; next: ExtractedLeader }> = [];
  const unchanged: ExtractedLeader[] = [];

  for (const row of next) {
    const prior = prevByName.get(row.normalizedName);
    if (!prior) {
      appeared.push(row);
      continue;
    }
    if (prior.normalizedTitle !== row.normalizedTitle) {
      titleChanged.push({ previous: prior, next: row });
    } else {
      unchanged.push(row);
    }
  }
  for (const row of previous) {
    if (!nextByName.has(row.normalizedName)) departed.push(row);
  }
  return { appeared, departed, titleChanged, unchanged };
}
