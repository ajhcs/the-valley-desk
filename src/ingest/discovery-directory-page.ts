import type {DirectorySnapshot, DirectoryWork} from '../content/discovery-directory';
import {
  directoryPathId, validatedDirectoryRelease, DIRECTORY_RESPONSE_BYTE_LIMIT, type DirectoryEnvironment,
} from './discovery-directory-http';
import {parseDirectoryQuery, readDirectoryDetail, readDirectoryList} from './discovery-directory';
import type {DirectorySearchResult, DirectoryQuery} from './discovery-directory-search';
import {directoryPageStyle} from './discovery-directory-page-style';
import {directoryInstitutionHref, directorySourceAccount} from './discovery-directory-journeys';

const catalogPath = '/discover/works';
const esc = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const link = (href: string, label: string) => `<a href="${esc(href)}" rel="noreferrer noopener">${esc(label)}</a>`;
const detailPath = (id: string) => `/discover/work/${encodeURIComponent(id)}`;
const reportIssue = (id: string) => link(
  `mailto:leads@thevalleydesk.org?subject=Research%20listing%20correction&body=${encodeURIComponent(`Work ID: ${id}`)}`,
  'Report an issue',
);
const breakableTitle = (title: string) => esc(title).replaceAll('/', '/<wbr>');
const time = (value: string) => `<time>${esc(value)}</time>`;
const kindLabels = {repository: 'Repository', publication: 'Publication', preprint: 'Preprint', project: 'Project', discussion: 'Discussion'};
const topicLabels: Record<string, string> = {
  'machine-learning': 'AI / machine learning', 'medical-imaging': 'Medical imaging',
  'clinical-informatics': 'Clinical informatics', 'biomedical-data': 'Biomedical data',
  'assistive-technology': 'Assistive technology', 'public-health': 'Public health', sleep: 'Sleep',
};
const methods = {
  'provider-metadata': 'Retained provider metadata',
  'primary-web-rendering': 'Primary source observation',
  'primary-indexed-rendering': 'Indexed primary source observation',
  'reviewed-observation': 'Reviewed factual observation',
};
type Region = Extract<DirectoryWork['claims'][number], {kind: 'regional-connection'}>;
type Match = DirectorySearchResult['matches'][number];
type WorkIndex = ReadonlyMap<string, DirectoryWork>;

function originalAction(work: DirectoryWork): string {
  const labels = {
    repository: 'Open repository', publication: 'Read publication', preprint: 'Read preprint',
    project: 'Open project', discussion: 'Open discussion',
  };
  return link(work.url.value, labels[work.kind]);
}

function regionHtml(claim: Region, detail: boolean): string {
  const who = {
    'author-affiliation': `Publication author ${claim.subjectLabel} — affiliation`,
    'project-association': 'Project connection',
    'account-association': 'Source account connection',
    work: 'Work connection',
  };
  const institutionHref = detail && claim.institution ? directoryInstitutionHref(claim.institution) : null;
  const institution = claim.institution
    ? institutionHref ? link(institutionHref, claim.institution) : esc(claim.institution)
    : null;
  // Keep the campus when it is the observed basis of the connection.
  const campus = detail || claim.regionalBasis === 'campus' || (!claim.municipality && !claim.county) ? claim.campus : null;
  const locality = [campus, claim.municipality, claim.county ? `${claim.county} County` : null, claim.state]
    .flatMap(value => value ? [esc(value)] : []);
  const place = [institution, ...locality].filter(Boolean).join(' · ');
  return `<div class="region" data-claim-kind="regional-connection">
    <p><strong>${esc(who[claim.subjectRole])}</strong> · ${place} · ${time(claim.asOf.value)}</p>
    <p class="qualifier">${esc(claim.qualification)}</p>
  </div>`;
}

function datesHtml(work: DirectoryWork): string {
  const date = work.sourceDate?.value;
  return `<p class="dates">${date ? `<span>Source date: ${time(date.value)} (${esc(date.precision)})</span>` : ''}
    <span>Checked ${time(work.checkedAt)}</span></p>`;
}

function matchExplanation(match: Match | undefined, works: WorkIndex): string {
  if (!match) return '';
  const result = works.get(match.workId), supporting = works.get(match.sourceWorkId);
  const claimLabels = match.claimIds.flatMap(id => {
    // The result and one directly related work can supply different terms.
    const claim = result?.claims.find(c => c.id === id) ?? supporting?.claims.find(c => c.id === id);
    if (!claim) return [];
    if (claim.kind === 'topic') return [topicLabels[claim.topic] ?? claim.topic];
    if (claim.kind === 'regional-connection') return [[claim.institution,
      claim.county ? `${claim.county} County` : claim.municipality].filter(Boolean).join(' · ')];
    return ['Research purpose'];
  }).filter(Boolean);
  const basis = match.basis === 'related' && supporting
    ? `Match uses a directly linked work: ${link(detailPath(supporting.id), supporting.title.value)}.`
    : 'Match in this work.';
  const predicate = match.predicate === 'repository-cites-work' ? 'Evidence: repository cites publication.'
    : match.predicate === 'work-links-repository' ? 'Evidence: publication links repository.' : '';
  return `<p class="match" data-match-basis="${match.basis}">${basis}
    ${esc([...new Set(claimLabels)].join('; '))} ${predicate}</p>`;
}

function workCard(work: DirectoryWork, explanation: string): string {
  const purpose = work.claims.find(c => c.kind === 'health-purpose');
  const region = work.claims.find(c => c.kind === 'regional-connection');
  return `<article class="card" data-work-id="${esc(work.id)}">
    <p class="kind">${kindLabels[work.kind]}</p>
    <h3><a href="${esc(detailPath(work.id))}">${breakableTitle(work.title.value)}</a></h3>
    ${purpose ? `<p class="purpose">${esc(purpose.text)}</p>` : ''}
    ${region ? regionHtml(region, false) : ''}
    ${datesHtml(work)}
    ${explanation}
    <p class="actions">${originalAction(work)} ${link(detailPath(work.id), 'Details and sources')}</p>
  </article>`;
}

function workDetail(work: DirectoryWork, works: WorkIndex): string {
  const purposes = work.claims.filter(c => c.kind === 'health-purpose');
  const regions = work.claims.filter(c => c.kind === 'regional-connection');
  const topics = work.claims.filter(c => c.kind === 'topic').map(c => topicLabels[c.topic] ?? c.topic);
  const account = directorySourceAccount(work);
  const relations = work.relations.map(relation => {
    const target = works.get(relation.toId)!;
    const label = relation.predicate === 'repository-cites-work' ? 'Repository cites publication' : 'Publication links repository';
    return `<li data-relation="${esc(relation.predicate)}">${label}: ${link(detailPath(target.id), target.title.value)}</li>`;
  });
  return `<article class="detail" data-work-id="${esc(work.id)}">
    <p class="kind">${kindLabels[work.kind]} ${topics.map(topic => `<span>${esc(topic)}</span>`).join('')}</p>
    ${purposes.map(claim => `<p class="purpose">${esc(claim.text)}</p>`).join('')}
    <p class="actions">${originalAction(work)} ${reportIssue(work.id)}</p>
    ${datesHtml(work)}
    ${work.owner ? `<p class="owner">Source account: ${esc(work.owner.name)} (${esc(work.owner.kind)}).</p>` : ''}
    ${account ? `<p class="owner">GitHub namespace: ${link(account.href, account.login)} · observed ${time(account.observedDate)}</p>` : ''}
    <section aria-labelledby="regional-heading">
      <h2 id="regional-heading">Regional connection</h2>
      ${regions.map(region => regionHtml(region, true)).join('')}
    </section>
    ${relations.length ? `<section aria-labelledby="related-heading"><h2 id="related-heading">Related works</h2><ul>${relations.join('')}</ul></section>` : ''}
    <details class="source-disclosure"><summary>Sources and review</summary>
      <ul>${work.evidence.map(evidence => {
        const method = evidence.method === 'reviewed-observation' && evidence.pointer.startsWith('/packet/facts/')
          ? 'Reviewed metadata observation; original response not retained' : methods[evidence.method];
        return `<li data-evidence-id="${esc(evidence.id)}">${link(evidence.sourceUrl, 'Original evidence source')} · ${esc(method)}
          · observed ${time(evidence.observedDate)}<br>
          <span class="muted">Retained observation <code>${esc(evidence.observationSha256)}</code> · field <code>${esc(evidence.pointer)}</code></span></li>`;
      }).join('')}</ul>
      <h2>Review references</h2>
      <ul class="muted">${work.reviewRefs.map(review => `<li>${esc(review.id)} · <code>${esc(review.receiptSha256)}</code></li>`).join('')}</ul>
    </details>
  </article>`;
}

function searchForm(query: DirectoryQuery, facets: DirectorySearchResult['facets']): string {
  const select = (name: 'kind' | 'topic' | 'county' | 'institution', label: string, anyLabel: string) => {
    const selected = query[name] ?? '';
    const values = [...facets[name]];
    if (selected && !values.some(v => v.value === selected)) values.push({value: selected, count: 0});
    return `<div><label for="research-${name}">${label}</label><select id="research-${name}" name="${name}">
      <option value="">${anyLabel}</option>${values.map(({value, count}) => {
        const display = name === 'topic' ? topicLabels[value] ?? value
          : name === 'county' ? `${value} County`
          : name === 'kind' ? kindLabels[value as DirectoryWork['kind']] ?? value : value;
        return `<option value="${esc(value)}"${selected === value ? ' selected' : ''}>${esc(display)} (${count})</option>`;
      }).join('')}</select></div>`;
  };
  const selectedFilters = [query.topic, query.institution, query.county, query.kind].filter(Boolean).length;
  const sortChanged = query.sort !== 'relevance';
  const option = ([value, title]: string[]) => `<option value="${value}"${query.sort === value ? ' selected' : ''}>${title}</option>`;
  // The cursor belongs only to pagination. Submitting starts a new search.
  return `<form class="search-panel" method="get" action="${catalogPath}" aria-label="Research search">
    <label for="research-query">Search research</label>
    <div class="search-row">
      <input id="research-query" type="search" name="q" value="${esc(query.q)}" maxlength="200" aria-describedby="research-search-help">
      <button type="submit">Search</button>
    </div>
    <p class="help" id="research-search-help">Try sleep AI, Camden County, Rutgers-Camden, a repository name or a DOI.</p>
    <details class="filter-disclosure"${selectedFilters || sortChanged ? ' open' : ''}>
      <summary>Filters and sort${selectedFilters ? ` (${selectedFilters} selected)` : ''}</summary>
      <div class="filter-grid">
        ${select('topic', 'Topic', 'Any topic')}${select('institution', 'Institution', 'Any institution')}
        ${select('county', 'County', 'Any county')}${select('kind', 'Work type', 'Any work type')}
        <div><label for="research-sort">Sort by</label><select id="research-sort" name="sort">${[
          ['relevance', 'Best match'], ['title-asc', 'Title'], ['source-date-desc', 'Source date (unknown last)'],
        ].map(option).join('')}</select></div>
      </div>
      <p class="help">Each facet counts works after the other selected filters. County reflects a documented association.</p>
      <p class="actions filter-actions"><button type="submit">Apply filters</button> ${link(catalogPath, 'Reset filters')}</p>
    </details>
    <input type="hidden" name="limit" value="${query.limit}">
  </form>`;
}

function resultsHtml(result: DirectorySearchResult, works: WorkIndex, url: URL): string {
  const {query} = result;
  const showReasons = !!(query.q.trim() || query.kind || query.topic || query.county || query.institution);
  const matches = new Map(result.matches.map(reason => [reason.workId, reason]));
  const next = new URL(url);
  if (result.nextAfter) next.searchParams.set('after', result.nextAfter);
  const summary = `${result.matchingWorks} matching works in this selected catalog (${result.totalWorks} works total).`;
  return `<section class="results" aria-labelledby="results-title">
    <div class="result-summary"><h2 id="results-title">Results</h2><p class="muted">${summary}</p></div>
    ${result.items.length ? `<div class="cards">${result.items.map(work =>
      workCard(work, showReasons ? matchExplanation(matches.get(work.id), works) : '')).join('')}</div>`
      : result.totalWorks ? `<div class="empty"><p><strong>No matching works.</strong></p><p>Try fewer terms or ${link(catalogPath, 'reset filters')}.</p></div>`
        : '<div class="empty"><p><strong>No works are listed yet.</strong></p></div>'}
    ${result.nextAfter ? `<nav class="pagination" aria-label="Results pages">${link(next.pathname + next.search, 'Next page')}</nav>` : ''}
    ${result.supportItems.length ? `<aside class="related" aria-labelledby="related-evidence">
      <h2 id="related-evidence">Related evidence used</h2>
      <ul>${result.supportItems.map(work => `<li>${link(detailPath(work.id), work.title.value)}</li>`).join('')}</ul>
    </aside>` : ''}
  </section>`;
}

const indexWorks = (snapshot: DirectorySnapshot) => new Map(snapshot.works.map(work => [work.id, work]));
const headers = {'cache-control': 'no-store', 'cdn-cache-control': 'no-store', 'x-robots-tag': 'noindex'};
const browseBack = `<div class="detail-back">${link(catalogPath, '← Browse research')}</div>`;

export async function handleDiscoveryDirectoryPage(
  request: Request, env: DirectoryEnvironment, snapshotInput: unknown, removalInput: unknown,
): Promise<Response> {
  const head = request.method === 'HEAD';
  const enabled = env.DISCOVERY_DIRECTORY_ENABLED === 'true';
  const reply = (status: number, title: string, body: string, extra: Record<string, string> = {}, beforeTitle = '') => {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
      <title>${esc(title)} · The Valley Desk</title><style>${directoryPageStyle}</style></head><body>
      <a class="skip" href="#research-main">Skip to main content</a>
      <header class="masthead"><div class="shell"><a class="wordmark" href="/">The Valley Desk</a>
        ${enabled ? `<nav aria-label="Directory"><a class="section-link" href="${catalogPath}">Research</a></nav>` : ''}
      </div></header>
      <main class="shell" id="research-main" tabindex="-1">${beforeTitle}<h1>${breakableTitle(title)}</h1>${body}</main>
      </body></html>`;
    if (new TextEncoder().encode(html).byteLength > DIRECTORY_RESPONSE_BYTE_LIMIT) {
      return new Response(head ? null : 'Research directory unavailable', {status: 503, headers: {...headers, 'content-type': 'text/plain; charset=utf-8'}});
    }
    return new Response(head ? null : html, {status, headers: {...headers, 'content-type': 'text/html; charset=utf-8', ...extra}});
  };
  if (!enabled) return reply(404, 'Not found', '');
  if (request.method !== 'GET' && !head) return reply(405, 'Method not allowed', '', {allow: 'GET, HEAD'});
  let release: ReturnType<typeof validatedDirectoryRelease>;
  try {
    release = validatedDirectoryRelease(snapshotInput, removalInput);
  } catch {
    return reply(503, 'Research directory unavailable', '');
  }
  const url = new URL(request.url);
  const match = /^\/discover\/work\/([^/]+)$/.exec(url.pathname);
  if (match) {
    let id;
    try {
      if (url.search) throw Error('query');
      id = directoryPathId(match[1]);
    } catch {
      return reply(400, 'Unsupported request', '');
    }
    if (release.removals.removedIds.includes(id)) return reply(410, 'Listing removed', `<p class="intro">${link(catalogPath, 'Browse research')}</p>`);
    const work = readDirectoryDetail(release.snapshot, id);
    return work
      ? reply(200, work.title.value, workDetail(work, indexWorks(release.snapshot)), {}, browseBack)
      : reply(404, 'Not found', '');
  }
  if (!/^\/discover\/works\/?$/.test(url.pathname)) return reply(404, 'Not found', '');
  let query;
  try {
    query = parseDirectoryQuery(url.searchParams);
  } catch {
    return reply(400, 'Unsupported filters', `<p class="intro">${link(catalogPath, 'Reset filters')}</p>`);
  }
  try {
    const result = await readDirectoryList(release.snapshot, query);
    return reply(200, 'Health-tech research', `
      <p class="intro">Search selected research, code and projects with documented connections to Greater Philadelphia.</p>
      ${searchForm(query, result.facets)}${resultsHtml(result, indexWorks(release.snapshot), url)}`);
  } catch (error) {
    return error instanceof Error && error.message.startsWith('directory-cursor-')
      ? reply(409, 'Search changed', `<p class="intro">${link(catalogPath, 'Restart search')}</p>`)
      : reply(503, 'Research directory unavailable', '');
  }
}
