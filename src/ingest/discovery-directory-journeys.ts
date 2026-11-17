import type {DirectoryWork} from '../content/discovery-directory';
import {parseDirectoryQuery} from './discovery-directory-search';

export function directoryInstitutionHref(institution: string): string | null {
  const params = new URLSearchParams({institution});
  try {
    if (parseDirectoryQuery(params).institution !== institution) return null;
    return `/discover/works?${params}`;
  } catch {
    return null;
  }
}

type SourceAccount = {href: string; login: string; observedDate: string};

/** Derive the observed repository namespace from bound public evidence. */
export function directorySourceAccount(work: DirectoryWork): SourceAccount | null {
  const identity = work.nativeIdentity;
  if (work.kind !== 'repository' || identity?.provider !== 'github' || !/^[1-9]\d*$/.test(identity.nativeId)) return null;

  const match = /^https:\/\/github\.com\/([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)\/([a-z0-9._-]{1,100})$/i.exec(work.url.value);
  if (!match) return null;
  const [, login, repository] = match;
  if (repository === '.' || repository === '..' || work.owner && work.owner.name.toLowerCase() !== login.toLowerCase()) return null;

  const original = work.evidence.find(e => e.id === work.url.evidenceId);
  const native = work.evidence.find(e => e.id === identity.evidenceId);
  if (!original || !native || original.sourceUrl !== native.sourceUrl ||
      original.observationSha256 !== native.observationSha256 || original.method !== native.method ||
      original.observedDate !== native.observedDate) return null;
  if (original.sourceUrl !== `https://api.github.com/repos/${login}/${repository}`) return null;

  const direct = original.method === 'provider-metadata' && original.pointer === '/html_url' && native.pointer === '/id';
  const fact = /^(\/packet\/facts\/(?:0|[1-9]\d*))\/url$/.exec(original.pointer);
  const retained = original.method === 'reviewed-observation' && fact && native.pointer === `${fact[1]}/nativeId`;
  if (!direct && !retained) return null;

  return {href: `https://github.com/${login}`, login, observedDate: original.observedDate};
}
