import { redactRegionalContactEmails as redact } from '../regional-privacy';

type Provider = 'github' | 'crossref';
type Reject = (code: string) => never;
type GithubRepositories = 'repository' | 'inventory' | 'search-repositories';

/** Decode the whole bounded representation before projections can discard unsafe fields. */
export function decodeDiscoveryMetadataJson(bytes: Uint8Array, provider: Provider, reject: Reject,
  githubRepositories?: GithubRepositories): unknown {
  let text: string;
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { return reject('json'); }
  let at = 0, nodes = 0;
  const bad = (): never => reject('json');
  const decimalKey = (literal: string) => {
    const [mantissa, exponent = '0'] = literal.toLowerCase().split('e');
    const negative = mantissa.startsWith('-'), unsigned = negative ? mantissa.slice(1) : mantissa;
    const [whole, fraction = ''] = unsigned.split('.');
    let digits = (whole + fraction).replace(/^0+/, '');
    if (!digits) return negative ? '-0' : '0';
    let scale = Number(exponent) - fraction.length;
    if (!Number.isSafeInteger(scale)) return null;
    while (digits.endsWith('0')) { digits = digits.slice(0, -1); scale++; }
    return (negative ? '-' : '') + digits + ':' + scale;
  };
  const whitespace = () => { while (/[\x20\x09\x0a\x0d]/.test(text[at] ?? 'X')) at++; };
  const string = (): string => {
    const start = at++;
    while (at < text.length) {
      const code = text.charCodeAt(at++);
      if (code === 34) {
        let result: string;
        try { result = JSON.parse(text.slice(start, at)); } catch { return bad(); }
        for (let i = 0; i < result.length; i++) {
          const c = result.charCodeAt(i);
          if (c >= 0xd800 && c <= 0xdbff) {
            const next = result.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return bad();
          } else if (c >= 0xdc00 && c <= 0xdfff) return bad();
        }
        return result;
      }
      if (code === 92) at++;
      else if (code < 32) return bad();
    }
    return bad();
  };
  const value = (depth: number): unknown => {
    if (depth > 32 || ++nodes > 20000) return bad();
    whitespace(); const token = text[at];
    if (token === '"') return string();
    if (token === '{' || token === '[') {
      at++; whitespace(); const array = token === '[', end = array ? ']' : '}';
      const result: any = array ? [] : Object.create(null), keys = new Set<string>();
      if (text[at] === end) { at++; return result; }
      for (;;) {
        whitespace(); let key = '';
        if (!array) {
          if (text[at] !== '"') return bad(); key = string();
          if (keys.has(key) || keys.size >= 200) return bad(); keys.add(key);
          whitespace(); if (text[at++] !== ':') return bad();
        }
        const entry = value(depth + 1); if (array) result.push(entry); else result[key] = entry;
        whitespace(); const next = text[at++]; if (next === end) return result; if (next !== ',') return bad();
      }
    }
    for (const [literal, entry] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(literal, at)) { at += literal.length; return entry; }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at));
    if (!number) return bad();
    at += number[0].length; const result = Number(number[0]);
    // Decimal/exponent provider scores are supported when their decimal value survives decoding.
    if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER ||
      Number.isInteger(result) && !Number.isSafeInteger(result) ||
      decimalKey(number[0]) !== decimalKey(JSON.stringify(result))) return bad();
    return result;
  };
  const root = value(0); whitespace(); if (at !== text.length) return bad();

  const restricted = new Set(['email','emails','emailaddress','emailaddresses','phone','phonenumber','telephone',
    'mobile','mobilenumber','fax','contact','contactemail','contactphone','password','passwd','secret','secrets',
    'token','accesstoken','refreshtoken','tempclonetoken','clientsecret','apikey','authorization','cookie','setcookie',
    'credentials','credential','privatekey','ipaddress']);
  const material = new Set(['abstract','fulltext','fulltextxml','fulltexthtml','articlebody']);
  const keyName = (key: string) => key.toLowerCase().replace(/[-_\s]/g, '');
  const empty = (entry: unknown) => entry === null || typeof entry === 'string' && !entry.trim().length ||
    Array.isArray(entry) && entry.length === 0 ||
    !!entry && typeof entry === 'object' && Object.keys(entry).length === 0;
  const stringVariants = (entry: string) => {
    const variants = new Set([entry]);
    let decoded = entry;
    for (let round = 0; round < 3; round++) {
      decoded = decoded.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));?/gi, (match, hex: string | undefined, decimal: string | undefined) => {
          const point = parseInt(hex ?? decimal!, hex ? 16 : 10);
          return point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : match;
        }).replace(/&(commat|period|colon|plus|lpar|rpar);/gi, (_match, name: string) =>
          ({commat:'@',period:'.',colon:':',plus:'+',lpar:'(',rpar:')'}[name.toLowerCase()]!));
      variants.add(decoded);
    }
    return variants;
  };
  const inspectString = (entry: string, safeSsh = false) => {
    for (const decoded of stringVariants(entry)) {
      if (!safeSsh && (redact(decoded) !== decoded || /(?:mailto|tel|sms):/i.test(decoded) ||
        /(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\b\d{3})[ .-]\d{3}[ .-]\d{4}\b/.test(decoded) ||
        /\b(?:phone|telephone|mobile|fax)\s*[:=]\s*\+?[\d(). -]{7,}/i.test(decoded))) return reject('contact-content');
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{16,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bsk-proj-[A-Za-z0-9_-]{16,}|\b(?:Bearer|Basic)\s+[A-Za-z0-9+\/.=_-]{8,}/i.test(decoded))
        return reject('credential-content');
      for (const match of decoded.matchAll(/(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s<>"']+/gi)) {
        let url: URL;
        try { url = new URL(match[0].startsWith('//') ? 'https:' + match[0] : match[0]); } catch { continue; }
        if (url.username || url.password || [...url.searchParams.keys()].some(key => restricted.has(keyName(key)) ||
          ['auth','signature','sig','key'].includes(keyName(key)))) return reject('credential-content');
      }
    }
  };
  const repositoryPath = (path: (string | number)[]) =>
    githubRepositories === 'repository' && path.length === 0 ||
    githubRepositories === 'inventory' && path.length === 1 && typeof path[0] === 'number' ||
    githubRepositories === 'search-repositories' && path.length === 2 && path[0] === 'items' && typeof path[1] === 'number';
  const repositoryAlias = (row: Record<string, unknown>) => {
    const owner = row.owner;
    if (!Number.isSafeInteger(row.id) || (row.id as number) < 1 || row.private !== false ||
      typeof row.name !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(row.name) ||
      !owner || typeof owner !== 'object' || Array.isArray(owner)) return null;
    const account = owner as Record<string, unknown>;
    if (!Number.isSafeInteger(account.id) || (account.id as number) < 1 || typeof account.login !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(account.login) ||
      !['User','Organization'].includes(account.type as string) ||
      row.full_name !== account.login + '/' + row.name) return null;
    return row.full_name;
  };
  const inspect = (entry: unknown, path: (string | number)[] = []) => {
    if (typeof entry === 'string') inspectString(entry);
    else if (Array.isArray(entry)) entry.forEach((child, i) => inspect(child, [...path, i]));
    else if (entry && typeof entry === 'object') {
      const row = entry as Record<string, unknown>;
      const alias = provider === 'github' && repositoryPath(path) ? repositoryAlias(row) : null;
      for (const [key, child] of Object.entries(row)) {
        inspectString(key);
        // A null contact slot contains no contact value; private:false is ordinary repository metadata.
        const keys = [...stringVariants(key)].map(keyName);
        if (keys.some(key => restricted.has(key)) && child !== null) return reject('restricted-field');
        if (provider === 'crossref' && keys.some(key => material.has(key)) && !empty(child)) return reject('unpermitted-material');
        if (key === 'ssh_url' && alias && child === 'git@github.com:' + alias + '.git') inspectString(child, true);
        else inspect(child, [...path, key]);
      }
    }
  };
  inspect(root); return root;
}
