import type { DirectoryProject, DirectoryView } from './public-directory-data';

type Query = DirectoryView['query'];
type Facets = DirectoryView['facets'];

const resultsPath = '/discover/works';
const count = new Intl.NumberFormat('en-US');
const date = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});
const facets = [
  { field: 'institution', group: 'institutions', label: 'Institution', all: 'All institutions' },
  { field: 'topic', group: 'topics', label: 'Topic', all: 'All topics' },
  { field: 'county', group: 'counties', label: 'County', all: 'All counties' },
] as const;

const navigation = [
  ['Projects', resultsPath],
] as const;

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function httpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function externalLink(value: string | null, label: string, className = ''): string {
  const url = httpsUrl(value);
  return url ? `<a class="${escapeHtml(className)}" href="${escapeHtml(url)}" rel="noreferrer">${escapeHtml(label)}</a>` : '';
}

function directoryHref(query: Partial<Query>): string {
  const params = new URLSearchParams();
  for (const field of ['q', 'institution', 'topic', 'county'] as const) {
    if (query[field]) params.set(field, query[field]);
  }
  if (query.page && query.page > 1) params.set('page', String(query.page));
  return escapeHtml(params.size ? `${resultsPath}?${params}` : resultsPath);
}

function projectHref(project: DirectoryProject): string {
  return `/discover/work/${encodeURIComponent(project.id)}`;
}

function githubAccount(project: DirectoryProject): string {
  const codeUrl = httpsUrl(project.code);
  if (!codeUrl) return 'GitHub';
  const account = new URL(codeUrl).pathname.split('/')[1];
  return account ? `@${account}` : 'GitHub';
}

function timestamp(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Not available';
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return 'Not available';
  return `<time datetime="${escapeHtml(value)}">${escapeHtml(date.format(parsed))}</time>`;
}

function reportLink(project?: DirectoryProject, label = 'Report an issue'): string {
  const subject = project ? `Directory correction for ${project.name}` : 'Valley Desk directory issue';
  const body = project ? `Project: ${project.name}\nRepository: ${project.code}\n\n` : '';
  const href = `mailto:leads@thevalleydesk.org?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function header(view: DirectoryView): string {
  return `<a class="skip-link" href="#main">Skip to content</a>
    <header class="masthead">
      <div class="frame masthead-inner">
        <a class="brand" href="/"${view.kind === 'home' ? ' aria-current="page"' : ''}>
          <img src="/mark-a-fold.svg" alt="" width="32" height="30">
          <span>The Valley Desk</span>
        </a>
        <nav class="main-nav" aria-label="Primary">
          ${navigation.map(([label, href]) => `<a href="${href}"${label === 'Projects' && view.kind === 'results' ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
        </nav>
        <div class="theme-control" hidden>
          <label for="directory-theme">Theme</label>
          <select id="directory-theme" aria-label="Theme">
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </div>
    </header>`;
}

function footer(): string {
  return `<footer class="site-footer">
    <div class="frame footer-inner">
      <a class="footer-brand" href="/">The Valley Desk</a>
      <nav aria-label="Footer">
        ${reportLink(undefined, 'Directory feedback')}<a href="/feed.json">JSON feed</a><a href="/feed.xml">RSS feed</a>
      </nav>
    </div>
  </footer>`;
}

function search(query: Query, options?: Facets): string {
  return `<form class="search-form" role="search" action="${resultsPath}" method="get">
    <label class="sr-only" for="directory-search">Search projects</label>
    <div class="search-row">
      <input type="search" id="directory-search" name="q" value="${escapeHtml(query.q)}"
        placeholder="Search projects, institutions or topics" maxlength="200">
      <button class="button primary" type="submit">Search</button>
    </div>
    ${options ? `<div class="filters">${facets.map(({ field, group, label, all }) => {
      const selected = query[field];
      const entries = options[group];
      const currentOption = selected && !entries.some(entry => entry.name === selected)
        ? `<option selected value="${escapeHtml(selected)}">${escapeHtml(selected)}</option>` : '';
      return `<label for="directory-${field}">${label}
        <select name="${field}" id="directory-${field}">
          <option value="">${all}</option>${currentOption}
          ${entries.map(({ name, count: matches }) => `<option value="${escapeHtml(name)}"${selected === name ? ' selected' : ''}>${escapeHtml(name)} (${count.format(matches)})</option>`).join('')}
        </select>
      </label>`;
    }).join('')}</div>` : ''}
  </form>`;
}

function regionalLabel(project: DirectoryProject): string {
  const style = project.label === 'Verified' ? 'verified' : 'listed';
  return `<span class="label ${style}">${escapeHtml(project.label)}</span>`;
}

function card(project: DirectoryProject, level: 2 | 3): string {
  const name = escapeHtml(project.name);
  const href = projectHref(project);
  return `<article class="project-card">
    <h${level}><a href="${href}">${name}</a></h${level}>
    <p class="card-purpose">${escapeHtml(project.purpose)}</p>
    <p class="card-institution">
      <span>${escapeHtml(project.institution || githubAccount(project))}</span>
      ${regionalLabel(project)}
    </p>
    <div class="card-meta">
      <span>${escapeHtml(project.language || 'Language not reported')}</span>
      <span>${project.updated ? `Updated ${timestamp(project.updated)}` : 'Update date not available'}</span>
    </div>
  </article>`;
}

function cardGrid(projects: DirectoryProject[], level: 2 | 3): string {
  return `<div class="project-grid">${projects.map(project => card(project, level)).join('')}</div>`;
}

function browse(options: Facets): string {
  return `<section class="frame browse-section" aria-labelledby="browse-title">
    <div class="section-heading"><h2 id="browse-title">Browse projects</h2></div>
    <div class="browse-grid">
      ${facets.map(({ field, group, label, all }) => `<section class="browse-panel" aria-labelledby="browse-${field}">
        <h3 id="browse-${field}">${label}</h3>
        <ul>${options[group].slice(0, 4).map(({ name, count: matches }) => `<li><a href="${directoryHref({ [field]: name })}">
          <span>${escapeHtml(name)}${field === 'county' ? ' County' : ''}</span>
          <span class="facet-count">${count.format(matches)}</span>
        </a></li>`).join('')}</ul>
        <a class="browse-all" href="${resultsPath}#directory-${field}">${all}</a>
      </section>`).join('')}
    </div>
  </section>`;
}

function home(view: DirectoryView): string {
  return `<section class="hero" aria-labelledby="home-title">
    <div class="frame hero-inner">
      <div class="hero-main">
        <h1 id="home-title">Find regional health-tech projects</h1>
        <p>Software, data and research from the nine-county Delaware Valley.</p>
        ${search(view.query)}
      </div>
      <dl class="directory-counts" aria-label="Directory totals">
        <div><dt>Projects</dt><dd>${count.format(view.total)}</dd></div>
        <div><dt>Institutions</dt><dd>${count.format(view.institutionCount)}</dd></div>
      </dl>
    </div>
  </section>
  ${browse(view.facets)}
  ${view.projects.length ? `<section class="frame recent-section" aria-labelledby="recent-title">
    <div class="section-heading"><h2 id="recent-title">Recently added projects</h2><a href="${resultsPath}">View all projects</a></div>
    ${cardGrid(view.projects, 3)}
  </section>` : ''}`;
}

function results(view: DirectoryView): string {
  const page = view.query.page;
  const filtered = view.query.q || view.query.institution || view.query.topic || view.query.county;
  const matches = `${count.format(view.matchCount)} ${view.matchCount === 1 ? 'project' : 'projects'}`;
  return `<div class="frame page">
    <h1>Project directory</h1>
    ${search(view.query, view.facets)}
    <div class="results-bar">
      <p>${matches}${filtered ? ' found' : ' listed'}</p>
      ${filtered ? `<a href="${resultsPath}">Clear search and filters</a>` : ''}
    </div>
    ${view.projects.length ? cardGrid(view.projects, 2) : '<div class="empty"><p>No projects match this search. Try another term or clear the filters.</p></div>'}
    ${view.pageCount > 1 ? `<nav class="pagination" aria-label="Results pages">
      ${page > 1 ? `<a class="button secondary" href="${directoryHref({ ...view.query, page: page - 1 })}">Previous</a>` : ''}
      <span>Page ${count.format(page)} of ${count.format(view.pageCount)}</span>
      ${page < view.pageCount ? `<a class="button secondary" href="${directoryHref({ ...view.query, page: page + 1 })}">Next</a>` : ''}
    </nav>` : ''}
  </div>`;
}

function detail(project: DirectoryProject): string {
  const institution = project.institution
    ? `<a href="${directoryHref({ institution: project.institution })}">${escapeHtml(project.institution)}</a>`
    : escapeHtml(githubAccount(project));
  const county = project.county
    ? `<a href="${directoryHref({ county: project.county })}">${escapeHtml(project.county)} County</a>` : '';
  return `<article class="frame page project-page">
    <nav class="project-back" aria-label="Directory breadcrumb"><a href="${resultsPath}">All projects</a></nav>
    <div class="project-heading">
      <a class="topic-link" href="${directoryHref({ topic: project.topic })}">${escapeHtml(project.topic)}</a>
      <h1>${escapeHtml(project.name)}</h1>
      <p class="project-purpose">${escapeHtml(project.purpose)}</p>
      <div class="project-actions">
        ${externalLink(project.code, 'View code on GitHub', 'button primary')}
        ${externalLink(project.paper, 'Read the paper', 'button secondary')}
      </div>
    </div>
    <div class="project-info">
      <section class="connection-panel" aria-labelledby="connection-title">
        <div class="connection-heading">
          <h2 id="connection-title">Regional connection</h2>
          ${regionalLabel(project)}
        </div>
        <p class="connection-place">${[institution, county].filter(Boolean).join(' · ')}</p>
        <p>${escapeHtml(project.connection)}</p>
        ${externalLink(project.source, 'View regional source', 'connection-source')}
      </section>
      <section class="metadata-panel" aria-labelledby="metadata-title">
        <h2 id="metadata-title">GitHub details</h2>
        <dl class="project-metadata">
          <div><dt>Language</dt><dd>${escapeHtml(project.language || 'Not reported')}</dd></div>
          <div><dt>License</dt><dd>${escapeHtml(project.license || 'Not reported')}</dd></div>
          <div><dt>Last updated</dt><dd>${timestamp(project.updated)}</dd></div>
        </dl>
      </section>
    </div>
    <p class="project-report">${reportLink(project)}</p>
  </article>`;
}

function empty(view: DirectoryView): string {
  const message = view.kind === 'removed' ? 'This project is no longer listed.'
    : view.kind === 'unavailable' ? 'The directory is temporarily unavailable.' : 'We could not find this project.';
  return `<div class="frame page message-page">
    <h1>${escapeHtml(view.title)}</h1>
    <p>${message}</p>
    <a class="button secondary" href="${resultsPath}">Browse projects</a>
  </div>`;
}

export function renderDirectoryPage(view: DirectoryView): string {
  let content: string;
  switch (view.kind) {
    case 'home': content = home(view); break;
    case 'results': content = results(view); break;
    case 'project': content = view.project ? detail(view.project) : empty(view); break;
    default: content = empty(view);
  }
  const title = view.kind === 'home' ? 'The Valley Desk · Regional health-tech directory' : `${view.title} · The Valley Desk`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Find health-tech projects across the nine-county Delaware Valley.">
    <title>${escapeHtml(title)}</title>
    <script src="/theme.js"></script>
    <script src="/directory-theme.js" defer></script>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&amp;family=IBM+Plex+Serif:wght@400;500;600&amp;display=swap">
    <link rel="stylesheet" href="/directory.css">
  </head>
  <body>
    ${header(view)}
    <main id="main" tabindex="-1">${content}</main>
    ${footer()}
  </body>
</html>`;
}
