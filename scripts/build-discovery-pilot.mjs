#!/usr/bin/env node
import { readFile, stat, realpath, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { DiscoveryPilotCatalogSchema, DiscoveryPilotHttpsUrl } from '../src/content/discovery-pilot.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const selectionPath = 'fixtures/discovery-pilot-selection.json';
const catalogPath = 'src/content/discovery-pilot-catalog.json';
const hash = value => createHash('sha256').update(value).digest('hex');
export const canonicalPilotJson = value => Array.isArray(value) ? `[${value.map(canonicalPilotJson).join(',')}]` : value !== null && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalPilotJson(value[key])}`).join(',')}}` : JSON.stringify(value);
const Hash = z.string().regex(/^[a-f0-9]{64}$/),
  Id = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/);
const Field = z.object({
  source: Id,
  pointer: z.string().max(1000),
  value: z.unknown()
}).strict();
const ObservationField = z.object({
  observation: Id,
  pointer: z.string().max(1000),
  value: z.unknown()
}).strict();
const common = {
  nativeId: Field,
  title: Field,
  url: Field
};
const RecordSelection = z.discriminatedUnion('kind', [z.object({
  id: Id,
  kind: z.literal('repository'),
  fields: z.object({
    ...common,
    ownerName: Field,
    ownerId: Field,
    ownerKind: Field,
    createdAt: Field,
    updatedAt: Field,
    pushedAt: Field
  }).strict()
}).strict(), z.object({
  id: Id,
  kind: z.literal('publication'),
  fields: z.object({
    ...common,
    publicationType: Field,
    publishedDateParts: Field,
    authors: z.array(Field).max(8)
  }).strict()
}).strict(), z.object({
  id: Id,
  kind: z.literal('organization'),
  fields: z.object({
    ...common,
    reportedLocations: Field,
    modifiedDate: Field
  }).strict()
}).strict()]);
const Selection = z.object({
  schemaVersion: z.literal('discovery-pilot-selection-v1'),
  version: z.string().min(1).max(100),
  sources: z.record(Id, z.object({
    provider: z.enum(['github', 'crossref', 'ror']),
    bodyPath: z.string().max(1000),
    requestUrl: DiscoveryPilotHttpsUrl,
    observedAt: z.string().datetime({
      offset: true
    }),
    sha256: Hash,
    useBasis: z.object({
      label: z.string().min(1).max(500),
      url: DiscoveryPilotHttpsUrl
    }).strict()
  }).strict()),
  records: z.array(RecordSelection).min(1).max(100),
  observations: z.record(Id, z.object({
    bodyPath: z.string().max(1000),
    sha256: Hash
  }).strict()).default({}),
  relationships: z.array(z.object({
    fromId: Id,
    toId: Id,
    relation: z.literal('cites-publication'),
    edge: ObservationField,
    file: ObservationField,
    observedAt: ObservationField
  }).strict()).max(20).default([])
}).strict();
/** Strict decoded keys and bounded finite JSON, including legitimate metadata decimals. */
export function parsePilotJson(text) {
  const stack = [];
  let prior = '',
    nodes = 0;
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) ?? [];
  for (const token of tokens) {
    if (++nodes > 200000) throw Error('json-bound');
    if (token === '{' || token === '[') {
      stack.push(token === '{' ? new Set() : null);
      if (stack.length > 32) throw Error('json-depth');
    } else if (token === '}' || token === ']') stack.pop();else if (token.startsWith('"') && stack.at(-1) instanceof Set && (prior === '{' || prior === ',')) {
      const key = JSON.parse(token);
      if (stack.at(-1).has(key)) throw Error('duplicate-json-key');
      stack.at(-1).add(key);
    }
    prior = token;
  }
  const value = JSON.parse(text);
  const check = v => {
    if (typeof v === 'number' && !Number.isFinite(v)) throw Error('nonfinite-json');
    if (typeof v === 'string' && /[\uD800-\uDFFF]/u.test(v)) throw Error('invalid-unicode');
    if (v && typeof v === 'object') Object.values(v).forEach(check);
  };
  check(value);
  return value;
}
export function pilotPointer(value, pointer) {
  if (pointer === '') return value;
  if (!pointer.startsWith('/')) throw Error('pointer');
  for (const raw of pointer.slice(1).split('/')) {
    if (/~(?:[^01]|$)/.test(raw)) throw Error('pointer');
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key) || Array.isArray(value) && !/^(?:0|[1-9]\d*)$/.test(key)) throw Error('pointer');
    value = value[key];
  }
  return value;
}
const text = z.string().min(1).max(4000).refine(value => !/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(value));
const numberId = z.number().int().positive().safe();
function dateParts(raw) {
  const parts = z.array(z.array(z.number().int().min(1)).min(1).max(3)).length(1).parse(raw)[0];
  return {
    label: 'Published',
    value: parts.map((part, index) => index ? String(part).padStart(2, '0') : String(part).padStart(4, '0')).join('-'),
    precision: ['year', 'month', 'day'][parts.length - 1]
  };
}
function utcCheckpoint(value) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/.test(value)) throw Error('derived-time');
  return value.replace(' ', 'T').replace(' UTC', 'Z');
}
function crossrefRequestMatches(value, doi) {
  const url = new URL(value);
  if (url.origin !== 'https://api.crossref.org' || url.hash) return false;
  if (url.pathname.toLowerCase() === `/works/${doi}`.toLowerCase()) return !url.search;
  const keys = [...url.searchParams.keys()];
  return url.pathname === '/v1/works' && keys.length === 3 && new Set(keys).size === 3 && keys.every(key => ['filter', 'rows', 'select'].includes(key)) && url.searchParams.get('filter')?.toLowerCase() === `doi:${doi}`.toLowerCase() && url.searchParams.get('rows') === '1' && url.searchParams.get('select') === 'DOI,title,type,author,published,URL,publisher,relation,license';
}
async function readLocal(path, limit = 2000000) {
  if (typeof path !== 'string' || isAbsolute(path) || path.includes('\\') || !path.startsWith('docs/discovery/qualification/evidence/')) throw Error('source-path');
  const absolute = resolve(root, path);
  if (relative(root, absolute) !== path || (await realpath(absolute)) !== absolute) throw Error('source-path');
  const info = await stat(absolute);
  if (!info.isFile() || info.size > limit) throw Error('source-size');
  const data = await readFile(absolute);
  if (data.length > limit) throw Error('source-size');
  return data;
}
/** Deterministic offline projection. The loader is explicit and never fetches. */
export async function buildDiscoveryPilotCatalog(input, loadBytes = readLocal) {
  const inputSnapshot = structuredClone(input),
    selection = Selection.parse(inputSnapshot),
    bodies = new Map(),
    observations = new Map();
  let totalBytes = 0;
  if (Object.keys(selection.sources).length > 100 || Object.keys(selection.observations).length > 20) throw Error('source-count');
  for (const [key, source] of Object.entries(selection.sources)) {
    const bytes = await loadBytes(source.bodyPath);
    totalBytes += bytes.length;
    if (bytes.length > 2000000 || totalBytes > 8000000 || hash(bytes) !== source.sha256) throw Error('source-hash');
    bodies.set(key, {
      source,
      body: parsePilotJson(new TextDecoder('utf-8', {
        fatal: true
      }).decode(bytes))
    });
  }
  for (const [key, source] of Object.entries(selection.observations)) {
    const bytes = await loadBytes(source.bodyPath);
    totalBytes += bytes.length;
    if (bytes.length > 2000000 || totalBytes > 8000000 || hash(bytes) !== source.sha256) throw Error('observation-hash');
    observations.set(key, {
      source,
      body: parsePilotJson(new TextDecoder('utf-8', {
        fatal: true
      }).decode(bytes))
    });
  }
  const records = [];
  for (const selected of selection.records) {
    const sourceKey = selected.fields.nativeId.source,
      loaded = bodies.get(sourceKey);
    if (!loaded) throw Error('unknown-source');
    const {
      source,
      body
    } = loaded;
    const expectedProvider = {
      repository: 'github',
      publication: 'crossref',
      organization: 'ror'
    }[selected.kind];
    if (source.provider !== expectedProvider) throw Error('provider');
    const publicationRoot = source.provider === 'crossref' && Array.isArray(body?.message?.items) ? '/message/items/0' : '/message';
    if (source.provider === 'crossref' && publicationRoot === '/message/items/0' && body.message.items.length !== 1) throw Error('publication-item-count');
    const expectedPointers = selected.kind === 'repository' ? {
      nativeId: '/id',
      title: '/full_name',
      url: '/html_url',
      ownerName: '/owner/login',
      ownerId: '/owner/id',
      ownerKind: '/owner/type',
      createdAt: '/created_at',
      updatedAt: '/updated_at',
      pushedAt: '/pushed_at'
    } : selected.kind === 'publication' ? {
      nativeId: `${publicationRoot}/DOI`,
      title: `${publicationRoot}/title`,
      url: `${publicationRoot}/URL`,
      publicationType: `${publicationRoot}/type`,
      publishedDateParts: `${publicationRoot}/published/date-parts`
    } : {
      nativeId: '/id',
      url: '/id',
      reportedLocations: '/locations',
      modifiedDate: '/admin/last_modified/date'
    };
    for (const [name, pointer] of Object.entries(expectedPointers)) if (selected.fields[name]?.pointer !== pointer) throw Error('semantic-pointer');
    if (selected.kind === 'organization') {
      const match = /^\/names\/(0|[1-9][0-9]*)\/value$/.exec(selected.fields.title.pointer);
      if (!match || !Array.isArray(body.names) || !body.names[Number(match[1])]?.types?.includes('ror_display')) throw Error('organization-name-pointer');
    }
    const provenance = [];
    const field = (name, entry = selected.fields[name]) => {
      if (!entry || entry.source !== sourceKey || canonicalPilotJson(pilotPointer(body, entry.pointer)) !== canonicalPilotJson(entry.value)) throw Error('field-disagreement');
      provenance.push({
        field: name,
        pointer: entry.pointer
      });
      return entry.value;
    };
    const rawId = field('nativeId'),
      nativeId = selected.kind === 'repository' ? String(numberId.parse(rawId)) : text.parse(rawId);
    if (selected.kind === 'publication' && !/^10\.\d{4,9}\/\S+$/.test(nativeId)) throw Error('doi');
    if (selected.kind === 'organization' && !/^https:\/\/ror\.org\/[0-9a-z]{9}$/.test(nativeId)) throw Error('ror');
    const rawTitle = field('title'),
      title = text.parse(Array.isArray(rawTitle) ? rawTitle[0] : rawTitle),
      url = DiscoveryPilotHttpsUrl.parse(field('url'));
    const record = {
      id: selected.id,
      kind: selected.kind,
      provider: source.provider,
      nativeId,
      title,
      url,
      owner: null,
      authors: [],
      sourceDate: null,
      additionalDates: [],
      geography: {
        basis: 'not-established',
        reportedLocations: [],
        county: null
      },
      source: {
        url: source.requestUrl,
        observedAt: source.observedAt,
        sha256: source.sha256,
        useBasis: source.useBasis
      },
      provenance,
      relatedLinks: []
    };
    if (selected.kind === 'repository') {
      if (selected.id !== `github:${nativeId}` || url !== `https://github.com/${title}` || source.requestUrl !== `https://api.github.com/repos/${title}`) throw Error('repository-identity');
      record.owner = {
        id: String(numberId.parse(field('ownerId'))),
        name: text.parse(field('ownerName')),
        kind: z.enum(['Organization', 'User']).parse(field('ownerKind'))
      };
      record.sourceDate = {
        label: 'Repository pushed',
        value: z.string().parse(field('pushedAt')),
        precision: 'instant'
      };
      record.additionalDates = [{
        label: 'Repository created',
        value: z.string().parse(field('createdAt')),
        precision: 'instant'
      }, {
        label: 'Repository updated',
        value: z.string().parse(field('updatedAt')),
        precision: 'instant'
      }];
    } else if (selected.kind === 'publication') {
      if (selected.id !== `crossref:${nativeId}` || new URL(url).hostname !== 'doi.org' || !crossrefRequestMatches(source.requestUrl, nativeId) || decodeURIComponent(new URL(url).pathname.slice(1)).toLowerCase() !== nativeId.toLowerCase()) throw Error('publication-identity');
      text.parse(field('publicationType'));
      record.sourceDate = dateParts(field('publishedDateParts'));
      record.authors = selected.fields.authors.map((author, index) => {
        const raw = field(`authors/${index}`, author),
          authorPrefix = `${publicationRoot}/author/`,
          tail = author.pointer.slice(authorPrefix.length);
        if (!author.pointer.startsWith(authorPrefix) || !/^(?:0|[1-9]\d*)$/.test(tail)) throw Error('author-pointer');
        const value = z.object({
          given: z.string().optional(),
          family: z.string().optional(),
          name: z.string().optional(),
          affiliation: z.array(z.object({
            name: text
          }).passthrough()).max(20).optional()
        }).passthrough().parse(raw);
        const name = text.parse([value.given, value.family].filter(Boolean).join(' ') || value.name);
        const affiliations = (value.affiliation ?? []).map(row => row.name);
        return {
          sourceIndex: Number(tail),
          name,
          affiliations
        };
      });
      if (new Set(record.authors.map(author => author.sourceIndex)).size !== record.authors.length) throw Error('duplicate-author');
      record.geography = {
        basis: 'publication-reported-affiliation',
        reportedLocations: [...new Set(record.authors.flatMap(author => author.affiliations))],
        county: null
      };
    } else {
      if (selected.id !== `ror:${nativeId.split('/').at(-1)}` || url !== nativeId || source.requestUrl !== `https://api.ror.org/v2/organizations/${nativeId.split('/').at(-1)}`) throw Error('organization-identity');
      const locations = z.array(z.object({
        geonames_details: z.object({
          name: text,
          country_name: text
        }).passthrough()
      }).passthrough()).max(20).parse(field('reportedLocations'));
      record.geography = {
        basis: 'registry-reported-location',
        reportedLocations: locations.map(row => `${row.geonames_details.name}, ${row.geonames_details.country_name}`),
        county: null
      };
      record.sourceDate = {
        label: 'Registry modified',
        value: z.string().parse(field('modifiedDate')),
        precision: 'day'
      };
    }
    records.push(record);
  }
  if (new Set(records.map(record => `${record.provider}:${record.nativeId.toLowerCase()}`)).size !== records.length) throw Error('duplicate-native-identity');
  for (const relation of selection.relationships) {
    const from = records.find(record => record.id === relation.fromId),
      to = records.find(record => record.id === relation.toId);
    if (!from || !to || from.kind !== 'repository' || to.kind !== 'publication') throw Error('relation-endpoints');
    const observationKey = relation.edge.observation,
      loaded = observations.get(observationKey);
    if (!loaded) throw Error('relation-source');
    for (const field of [relation.edge, relation.file, relation.observedAt]) if (field.observation !== observationKey || canonicalPilotJson(pilotPointer(loaded.body, field.pointer)) !== canonicalPilotJson(field.value)) throw Error('relation-disagreement');
    const edge = z.object({
      repository: text,
      commit: z.string().regex(/^[a-f0-9]{40}$/),
      paths: z.array(text).min(1).max(10),
      doi: text
    }).strict().parse(relation.edge.value);
    const file = z.object({
      repository: text,
      commit: z.string(),
      path: text,
      permalink: DiscoveryPilotHttpsUrl,
      tool_success: z.literal(true),
      doi_mentions: z.array(text)
    }).passthrough().parse(relation.file.value);
    const expected = `https://github.com/${edge.repository}/blob/${edge.commit}/${file.path}`;
    if (!/^\/explicit_repository_publication_edges\/(0|[1-9]\d*)$/.test(relation.edge.pointer) || !/^\/file_observation_batch\/files\/(0|[1-9]\d*)$/.test(relation.file.pointer) || relation.observedAt.pointer !== '/file_observation_batch/ended_at_utc') throw Error('relation-semantic-pointer');
    if (edge.repository !== from.title || file.repository !== edge.repository || file.commit !== edge.commit || !edge.paths.includes(file.path) || file.permalink !== expected || edge.doi.toLowerCase() !== to.nativeId.toLowerCase() || !file.doi_mentions.some(doi => doi.toLowerCase() === to.nativeId.toLowerCase())) throw Error('relation-binding');
    if (from.relatedLinks.some(link => link.targetId === to.id)) throw Error('duplicate-relation');
    from.relatedLinks.push({
      targetId: to.id,
      targetTitle: to.title,
      url: to.url,
      relation: 'cites-publication',
      evidence: {
        url: file.permalink,
        observedAt: utcCheckpoint(z.string().parse(relation.observedAt.value)),
        sha256: loaded.source.sha256,
        pointer: relation.edge.pointer,
        filePointer: relation.file.pointer,
        method: 'derived-connector-observation'
      }
    });
  }
  return DiscoveryPilotCatalogSchema.parse({
    schemaVersion: 'discovery-pilot-catalog-v1',
    catalogVersion: selection.version,
    selectionSha256: hash(canonicalPilotJson(inputSnapshot)),
    records: records.sort((a, b) => a.id.localeCompare(b.id))
  });
}
export async function runDiscoveryPilotBuild(args) {
  let temporary;
  try {
    if (args.length > 1 || args.length === 1 && args[0] !== '--check') throw Error('arguments');
    const selectionBytes = await readFile(resolve(root, selectionPath));
    if (selectionBytes.length > 2000000) throw Error('selection-size');
    const catalog = await buildDiscoveryPilotCatalog(parsePilotJson(new TextDecoder('utf-8', {
      fatal: true
    }).decode(selectionBytes)));
    const bytes = JSON.stringify(catalog, null, 2) + '\n',
      output = resolve(root, catalogPath);
    if (args[0] === '--check') {
      if ((await readFile(output, 'utf8')) !== bytes) throw Error('projection-drift');
      process.stdout.write('pilot_projection_current\n');
      return 0;
    }
    temporary = join(dirname(output), `.discovery-pilot-${randomBytes(8).toString('hex')}.tmp`);
    await writeFile(temporary, bytes, {
      flag: 'wx'
    });
    await rename(temporary, output);
    temporary = undefined;
    process.stdout.write('pilot_projection_written\n');
    return 0;
  } catch {
    process.stderr.write('invalid_pilot_projection\n');
    return 1;
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
  }
}
const invoked = process.argv[1] ? await realpath(resolve(process.argv[1])).catch(() => null) : null;
if (invoked === fileURLToPath(import.meta.url)) process.exitCode = await runDiscoveryPilotBuild(process.argv.slice(2));
