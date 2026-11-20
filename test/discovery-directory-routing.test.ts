import "./public-directory-research.test";
import "./public-directory-seo.test";
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import {primaryNoscript} from '../src/lib/crawler-html';
import {publicFeaturesFromEnv} from '../src/lib/public-features';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const current=JSON.parse(readFileSync('src/content/discovery-directory-catalog.json','utf8'));

const env=(flag:unknown=undefined)=>({PUBLIC_ORIGIN:'https://thevalleydesk.org',DISCOVERY_DIRECTORY_ENABLED:flag,ASSETS:{fetch:async()=>{throw Error('Directory must not load assets');}},VALLEY_DESK_DB:new Proxy({},{get(){throw Error('Directory must not query a database');}})});
const invoke=(path:string,flag:unknown=undefined,method='GET')=>worker.fetch(new Request('https://thevalleydesk.org'+path,{method}),env(flag),{});
test('actual Worker directory routes close by default without database/assets/source access',async()=>{
 for(const flag of [undefined,false,true,'false','TRUE',' true '])for(const path of ['/api/discovery/v1/works','/api/discovery/v1/works?view=compact','/api/discovery/v1/works/unknown','/discover/works','/discover/work/unknown']){
  for(const method of ['GET','HEAD','POST']){const response=await invoke(path,flag,method);assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'no-store');const body=await response.text();assert.ok(!body.includes('ExerciseCEST'));assert.ok(!body.includes('snapshotVersion'));if(method==='HEAD')assert.equal(body,'');}
 }
});

test('actual Worker serves smaller compact cards with detail links for the same reviewed snapshot',async()=>{
 const full=await invoke('/api/discovery/v1/works','true');
 const compact=await invoke('/api/discovery/v1/works?view=compact','true');
 assert.equal(full.status,200);assert.equal(compact.status,200);
 const fullText=await full.text(),compactText=await compact.text();
 assert.ok(Buffer.byteLength(compactText)<Buffer.byteLength(fullText));
 const list=JSON.parse(compactText), original=JSON.parse(fullText);
 assert.equal(list.schemaVersion,'discovery-directory-list-compact-v1');
 assert.equal(list.snapshotVersion,original.snapshotVersion);
 assert.deepEqual(list.items.map((work:any)=>work.id),original.items.map((work:any)=>work.id));
 for(const item of list.items){
  const detail=await invoke(item.detailHref,'true');
  assert.equal(detail.status,200);
  assert.deepEqual((await detail.json() as any).work,current.works.find((work:any)=>work.id===item.id));
 }
});
test('enabled actual Worker serves the reviewed API and script-free detail HTML',async()=>{
 const response=await invoke('/api/discovery/v1/works','true');assert.equal(response.status,200);assert.match(response.headers.get('x-content-type-options')??'',/nosniff/);
 const result=await response.json() as any;assert.equal(result.totalWorks,current.works.length);
 for(const work of result.items){
  const detail=await invoke('/api/discovery/v1/works/'+encodeURIComponent(work.id),'true');assert.equal(detail.status,200);assert.deepEqual((await detail.json() as any).work,work);
  const html=await invoke('/discover/work/'+encodeURIComponent(work.id),'true');assert.equal(html.status,200);const body=await html.text();assert.ok(body.includes(work.title.value));assert.ok(!body.includes('source-observations.json'));assert.ok(!body.includes('candidateId'));assert.ok(!body.includes('<script'));assert.ok(html.headers.get('content-security-policy'));
  const head=await invoke('/discover/work/'+encodeURIComponent(work.id),'true','HEAD');assert.equal(head.status,200);assert.equal(await head.text(),'');
 }
 const list=await invoke('/discover/works','true');assert.equal(list.status,200);assert.ok((await list.text()).includes(`${current.works.length} matching works`));
 assert.equal((await invoke('/api/discovery/v1/works','true','POST')).status,405);
 assert.equal((await invoke('/api/discovery/v1/works?q=a&q=b','true')).status,400);
 assert.equal((await invoke('/api/discovery/v1/creators/unknown','true')).status,404);
 assert.equal((await invoke('/api/discovery/v1/works/%ZZ','true')).status,400);
});

test('homepage search points to the directory only with the exact Worker setting', () => {
  const copy = (flag: unknown) => primaryNoscript('/', 'https://thevalleydesk.org', [], undefined, undefined,
    publicFeaturesFromEnv({DISCOVERY_DIRECTORY_ENABLED: flag}));
  for (const flag of [undefined, 'false', true]) assert.doesNotMatch(copy(flag), /\/discover\/works/);
  const html = copy('true');
  assert.match(html, /<form role="search" action="\/discover\/works" method="get">/);
  assert.match(html, /name="q" type="search"/);
  assert.doesNotMatch(html, /feed\.(?:json|xml)/);
});

test('the directory uses the same durable removal for listings, details, and historical aliases', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    const table = readFileSync('ops/directory-removals.sql', 'utf8');
    database.exec(table);
    const environment = {
      PUBLIC_ORIGIN: 'https://thevalleydesk.org',
      DIRECTORY_PUBLIC_ENABLED: 'true',
      VALLEY_DESK_DB: {
        prepare: (query: string) => ({ all: async () => ({ results: database.prepare(query).all() }) }),
      },
    };
    const request = (path: string) =>
      worker.fetch(new Request('https://thevalleydesk.org' + path), environment, {});
    const home = await request('/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /action="\/discover\/works"/);
    const before = await request('/discover/work/617168725');
    assert.equal(before.status, 200);
    assert.match(await before.text(), /10\.1007\/s11517-024-03096-x/);
    const alias = '/discover/work/GL05%3Awork%3Acrossref%3Asleepboost';
    assert.equal((await request(alias)).headers.get('location'), '/discover/work/617168725');
    database.exec("INSERT INTO public_directory_removals (github_id) VALUES ('617168725')");
    database.exec(table);
    const search = await request('/discover/works?q=SleepBoost');
    assert.equal(search.status, 200);
    assert.doesNotMatch(await search.text(), /href="\/discover\/work\/617168725"/);
    assert.equal((await request('/discover/work/617168725')).status, 410);
    assert.equal((await request(alias)).status, 410);
    const missing = await worker.fetch(new Request('https://thevalleydesk.org/discover/work/617168725'),
      { ...environment, VALLEY_DESK_DB: undefined }, {});
    assert.equal(missing.status, 503);
    assert.doesNotMatch(await missing.text(), /github\.com\/akibzaman/);
  } finally {
    database.close();
  }
});

const publicOrigin = 'https://thevalleydesk.org';

function publicRequest(path: string, method = 'GET', headers?: HeadersInit) {
  return new Request(publicOrigin + path, { method, headers });
}

const noRemovals = { prepare: () => ({ all: async () => ({ results: [] }) }) };

test('public directory pages, aliases, fragments and metadata preserve their HTTP contracts', async () => {
  const environment = { DIRECTORY_PUBLIC_ENABLED: 'true', PUBLIC_ORIGIN: publicOrigin, VALLEY_DESK_DB: noRemovals,
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) } };
  const get = (path: string, method?: string, headers?: HeadersInit) =>
    worker.fetch(publicRequest(path, method, headers), environment, {});

  const filter = '/discover/works?topic=Medical+imaging&institution=Drexel+University';
  for (const path of ['/', '/discover/works/', filter, '/discover/institution/drexel-university', '/discover/topic/medical-imaging',
    '/discover/lab/wglab', '/discover/county/bucks', '/discover/methodology']) {
    const page = await get(path);
    assert.equal(page.status, 200, path);
    assert.equal(page.headers.get('cache-control'), 'no-store', path);
    assert.equal((await get(path, 'HEAD')).status, 200, path);
  }

  const filtered = await get(filter);
  const text = await filtered.text();
  assert.match(text, /<title>Medical imaging projects at Drexel University · The Valley Desk<\/title>/);
  assert.match(text, /rel="canonical" href="https:\/\/thevalleydesk.org\/discover\/works"/);
  assert.match(text, /property="og:description" content="Medical imaging projects at Drexel University/);
  assert.match(text, /property="og:image" content="https:\/\/thevalleydesk.org\/directory-share.png"/);
  const nonce = /'nonce-([^']+)'/.exec(filtered.headers.get('content-security-policy') ?? '')?.[1];
  assert.ok(nonce);
  assert.ok(text.includes(`type="application/ld+json" nonce="${nonce}"`));

  const fragment = await get(filter, 'GET', { 'X-Valley-Desk-Fragment': 'results' });
  assert.equal(fragment.status, 200);
  assert.equal(fragment.headers.get('vary'), 'X-Valley-Desk-Fragment');
  assert.match(await fragment.text(), /^<div id="directory-results"/);
  const county = await (await get('/discover/county/bucks')).text();
  assert.match(county, /No projects listed yet/);
  assert.match(county, /Suggest a project/);

  const redirect = await get('/discover/?topic=Neuroscience');
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), '/discover/works?topic=Neuroscience');
  assert.equal((await get('/discover/work/GL05%3Awork%3Agithub%3A617168725')).status, 308);
  for (const path of ['/discover/work/1', '/discover/work/%ZZ', '/discover/lab/nonexistent', '/nonexistent']) {
    const response = await get(path);
    assert.equal(response.status, 404, path);
    assert.match(await response.text(), /<h1>Page not found<\/h1>/);
    assert.equal((await get(path, 'HEAD')).status, 404);
  }
  const disallowed = await get('/discover/works', 'POST');
  assert.equal(disallowed.status, 405);
  assert.equal(disallowed.headers.get('allow'), 'GET, HEAD');
});

test('public results combine disjunctive facets, dates and evidence and round-trip URL state', async () => {
  const { createDirectoryCatalog, readDirectoryQuery, directoryParams } = await import('../src/ingest/public-directory-data');
  const item = (id: string, fields: Partial<import('../src/ingest/public-directory-data').DirectoryProject>) => ({
    id, code: `https://github.com/lab/repo-${id}`, name: `Project ${id}`, purpose: 'Research tooling',
    topic: 'Imaging', label: 'Listed' as const, ...fields,
  });
  const catalog = createDirectoryCatalog([
    item('1', { name: 'Imaging Toolkit', language: 'C++', institution: 'Drexel', topic: 'Imaging',
      updated: '2026-11-04', pushed: '2022-01-01', stars: 19, archived: true, topics: ['dicom', 'simulation'] }),
    item('2', { name: 'A Toolkit', purpose: 'Imaging simulation', language: 'C', institution: 'Drexel',
      topic: 'Rehabilitation', pushed: '2026-03-04', archived: false, label: 'Verified',
      papers: [{ doi: '10.1000/research', title: 'Methods' }] }),
    item('3', { name: 'Z Toolkit', language: 'C++', institution: 'Temple', topic: 'Imaging',
      updated: '2026-04-04', added: '2026-11-01', stars: 1 }),
    item('4', { name: 'Robotics', language: 'C', institution: 'Drexel', topic: 'Rehabilitation',
      updated: '2026-10-01', added: '2026-11-03', label: 'Verified', paper: 'https://example.org/demo' }),
  ]);
  const now = new Date('2026-11-18');
  const list = (query: string, removed = new Set<string>()) => catalog.list(removed, new URLSearchParams(query), now);
  const ids = (view: ReturnType<typeof list>) => view.projects.map(project => project.id);
  assert.deepEqual(ids(list('q=imaging&sort=relevance')), ['1', '2', '3']);
  assert.deepEqual(ids(list('sort=name')), ['2', '1', '4', '3']);
  assert.deepEqual(ids(list('sort=stars')), ['1', '3', '4', '2']);
  assert.deepEqual(ids(list('sort=added')), ['4', '3', '2', '1']);
  assert.deepEqual(ids(list('institution=Drexel&topic=Imaging&topic=Rehabilitation&language=C%2B%2B')), ['1']);
  assert.deepEqual(list('institution=Drexel&topic=Imaging&topic=Rehabilitation&language=C%2B%2B').facets.language,
    [{ name: 'C', count: 2 }, { name: 'C++', count: 1 }]);
  assert.deepEqual(ids(list('language=C&label=Verified&paper=1&since=2026-01-01')), ['4', '2']);
  assert.deepEqual(ids(list('since=2026-01-01&tag=dicom')), [], 'last push takes precedence over updated');
  assert.deepEqual(ids(list('archived=Not+archived')), ['2']);
  assert.equal(list('institution=Drexel&language=C%2B%2B', new Set(['1'])).facets.language.find(row => row.name === 'C++')?.count, 0);
  const empty = list('institution=Temple&language=C');
  assert.equal(empty.suggestion?.field, 'institution');
  assert.equal(empty.suggestion?.count, 2);
  assert.deepEqual(ids(list(directoryParams(empty.suggestion!.query).toString())), ['4', '2']);
  const params = new URLSearchParams('q=imaging&county=Mercer&county=Camden&topic=Imaging&label=Listed&language=C%2B%2B&tag=dicom&archived=Archived&year=2026&paper=1&since=2026-01-01&sort=relevance&view=compact&page=17');
  assert.deepEqual(readDirectoryQuery(directoryParams(readDirectoryQuery(params))), readDirectoryQuery(params));
  const firstLab = [item('5', { code: 'https://github.com/research.lab/one' }), item('6', { code: 'https://github.com/research.lab/two' })];
  const secondLab = [item('7', { code: 'https://github.com/research-lab/one' }), item('8', { code: 'https://github.com/research-lab/two' })];
  const expanded = createDirectoryCatalog([...firstLab, ...secondLab]);
  const home = catalog.home(new Set(), now);
  assert.equal(home.verifiedCount, 2);
  assert.deepEqual(home.verified.map(project => project.id), ['4', '2']);
  assert.deepEqual(home.recent.map(project => project.id), ['3', '1']);
  assert.equal(expanded.entityHref('lab', 'research.lab'), createDirectoryCatalog(firstLab).entityHref('lab', 'research.lab'));
  assert.notEqual(expanded.entityHref('lab', 'research.lab'), expanded.entityHref('lab', 'research-lab'));
});

test('six-field and enriched records render safely and the JSON projection excludes unknown fields', async () => {
  const { createDirectoryCatalog } = await import('../src/ingest/public-directory-data');
  const { servePublicDirectory } = await import('../src/ingest/public-directory');
  const hostile = '</script><img src=x onerror=alert(1)>';
  const basic = { id: '101', code: 'https://github.com/Solo/Required', name: 'Required fields only', purpose: 'A research project.',
    topic: 'Research data', label: 'Listed' as const };
  const full = { ...basic, id: '102', code: 'https://github.com/Team/All', name: hostile, purpose: hostile, topic: hostile,
    label: 'Verified' as const, institution: 'Research University', county: 'Bucks', connection: hostile,
    source: 'javascript:alert(1)', paper: 'https://doi.org/10.1000/research', language: 'Python', license: 'MIT',
    updated: '2025-01-02', added: '2026-11-18', lab: 'Imaging Lab',
    owner: { login: 'Team', name: 'Account Name', kind: 'organization' as const, internal: 'private owner field' },
    homepage: 'https://credentials:secret@example.org/', stars: 0, topics: [hostile, 'research'], created: '2023-01-02',
    pushed: '2024-02-02', archived: true, checked: '2026-11-10',
    papers: [{ title: hostile, doi: '10.1000/research', url: 'https://doi.org/10.1000/research', year: 2024, venue: 'A journal',
      internal: 'private paper field' }], internal: 'private project field' };
  const teammate = { ...basic, id: '103', code: 'https://github.com/team/Mate', topic: hostile,
    institution: full.institution, added: '2026-11-11' };
  const catalog = createDirectoryCatalog([basic, full, teammate]);
  const get = (path: string, method?: string) => servePublicDirectory(publicRequest(path, method), noRemovals, publicOrigin, 'nonce', catalog);
  const minimal = await (await get('/discover/work/101')).text();
  assert.match(minimal, /Required fields only/);
  assert.match(minimal, /GitHub: @Solo/);
  assert.match(minimal, /\/discover\/works\?owner=Solo/);
  assert.doesNotMatch(minimal, /Not reported|Repository facts|Last recorded activity|section.*paper-title/);
  const detail = await (await get('/discover/work/102')).text();
  assert.match(detail, /SoftwareSourceCode/);
  assert.match(detail, /Regional connection/);
  assert.match(detail, /Imaging Lab/);
  assert.match(detail, /href="\/discover\/lab\/team"/);
  assert.match(detail, /Archived on GitHub/);
  assert.match(detail, /Last code push/);
  assert.match(detail, /Source checked/);
  assert.match(detail, /GitHub stars at capture<\/dt><dd>0/);
  assert.match(detail, /A journal · 2024 · DOI 10.1000\/research/);
  assert.match(detail, /More from this lab or account/);
  assert.match(detail, /&lt;\/script&gt;&lt;img/);
  assert.match(detail, /\\u003c\/script\\u003e/);
  assert.doesNotMatch(detail, /<img src=x|href="javascript:|credentials:secret|private .* field/);
  const home = await (await get('/')).text();
  assert.match(home, /Recently added projects/);
  const api = await (await get('/api/directory/projects/102')).json() as { project: Record<string, unknown> };
  assert.equal(api.project.name, hostile);
  assert.equal(api.project.stars, 0);
  assert.equal(api.project.source, undefined);
  assert.equal(api.project.homepage, undefined);
  assert.doesNotMatch(JSON.stringify(api), /private .* field/);
  assert.deepEqual(await (await get('/api/directory/projects/101')).json(), { project: basic });
  assert.equal((await get('/api/directory/projects/101', 'HEAD')).status, 200);
  assert.equal(await (await get('/api/directory/projects/101', 'HEAD')).text(), '');
});

test('Worker sitemap, JSON and fragments apply the same fresh removal set and fail closed', async () => {
  let removed: { github_id: string }[] = [];
  let failing = false;
  const seed = readFileSync('public/feed.json', 'utf8');
  const environment = {
    PUBLIC_ORIGIN: publicOrigin, DIRECTORY_PUBLIC_ENABLED: 'true',
    ASSETS: { fetch: async () => new Response(seed) },
    VALLEY_DESK_DB: {
      prepare: (query: string) => ({ all: async () => {
        if (query.includes('public_directory_removals') && failing) throw Error('D1 unavailable');
        return { results: query.includes('public_directory_removals') ? removed : [] };
      } }),
    },
  };
  const get = (path: string, method: string = 'GET', headers?: HeadersInit) =>
    worker.fetch(publicRequest(path, method, headers), environment, {});
  const paths = ['/sitemap.xml', '/api/directory/projects', '/api/directory/projects/617168725'];
  for (const path of paths) {
    const response = await get(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const head = await get(path, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  }
  assert.match(await (await get('/sitemap.xml')).text(), /<sitemapindex/);
  const sitemap = await (await get('/discover/sitemap/directory.xml')).text();
  for (const url of ['/discover/works', '/discover/work/617168725', '/discover/county/bucks', '/discover/lab/wglab',
    '/discover/topic/neuroscience', '/discover/institution/drexel-university', '/discover/methodology', '/discover/new']) {
    assert.ok(sitemap.includes(`<loc>${publicOrigin}${url}</loc>`), url);
  }
  assert.doesNotMatch(sitemap, /\/discover\/works\?/);
  for (const path of ['/sitemap.xml', '/s%69temap.xml', '/sitemap.xml/']) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    const xml = await response.text();
    assert.doesNotMatch(xml, /<loc>[^<]+\/(?:news|events|policy-watch|technology-watch|voices|feed\.(?:json|xml))(?:[</])/);
    assert.ok(!xml.includes(`<loc>${publicOrigin}/lab`), path);
  }
  const previous = await (await get('/api/directory/projects')).json() as { projects: { id: string }[] };
  assert.ok(previous.projects.some(project => project.id === '617168725'));
  removed = [{ github_id: '617168725' }];
  assert.equal((await get('/api/directory/projects/617168725')).status, 410);
  assert.equal((await get('/api/directory/projects/1')).status, 404);
  assert.equal((await get('/api/directory/projects', 'POST')).headers.get('allow'), 'GET, HEAD');
  assert.doesNotMatch(await (await get('/sitemap.xml')).text(), /\/discover\/work\/617168725<\/loc>/);
  assert.doesNotMatch(await (await get('/api/directory/projects')).text(), /617168725/);
  assert.doesNotMatch(await (await get('/discover/works?q=SleepBoost', 'GET', { 'X-Valley-Desk-Fragment': 'results' })).text(), /href="\/discover\/work\/617168725"/);
  failing = true;
  for (const path of [...paths, '/', '/discover/works', '/discover/county/bucks', '/discover/work/617168725', '/discover/methodology']) {
    const response = await get(path);
    assert.equal(response.status, 503, path);
    assert.doesNotMatch(await response.text(), /617168725/, path);
  }
});
