/** Deterministic guidance based on repository documentation; all links are explicit. */
export type GuidanceStep = { text: string; links?: { label: string; url: string }[]; command?: string };
type DatasetInput = { repository: string; accessions: string[]; url: string; access: string };
type SoftwareInput = { code: string; language?: string | null; license?: string | null; readmeUrl?: string | null; citationUrl?: string | null };

function safeHttps(value: string | null | undefined): string | undefined {
  try { const u = new URL(value ?? ''); return u.protocol === 'https:' && !u.username && !u.password ? u.href : undefined; } catch { return undefined; }
}
function observedFile(code: string, value: string | null | undefined): string | undefined {
  const base = safeHttps(code), file = safeHttps(value);
  if (!base || !file) return;
  const b = new URL(base), f = new URL(file);
  if (b.hostname !== 'github.com' || f.hostname !== 'github.com' || f.search || f.hash || !f.pathname.toLowerCase().startsWith(b.pathname.toLowerCase().replace(/\/$/, '') + '/blob/')) return;
  return file;
}
export function softwareUseGuidance(project: SoftwareInput): GuidanceStep[] {
  const code = safeHttps(project.code), readme = observedFile(project.code, project.readmeUrl), citation = observedFile(project.code, project.citationUrl);
  const steps: GuidanceStep[] = [];
  if (code && /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(project.code)) steps.push({ text: 'Clone the repository:', command: `git clone ${project.code}.git` });
  if (readme) steps.push({ text: 'Follow the repository’s setup and usage instructions.', links: [{ label: 'README', url: readme }] });
  else if (code) steps.push({ text: 'Check the repository for setup and usage instructions.', links: [{ label: 'Repository', url: code }] });
  if (project.language) steps.push({ text: `Primary language: ${project.language}.` });
  steps.push({ text: project.license ? `Review the ${project.license} license and repository terms before reuse.` : 'Check the repository for license and reuse terms.' });
  if (citation) steps.push({ text: 'Use the repository’s citation instructions.', links: [{ label: 'CITATION.cff', url: citation }] });
  else steps.push({ text: 'Check the repository for citation instructions.' });
  return steps;
}
export function datasetUseGuidance(dataset: DatasetInput): GuidanceStep[] {
  const link = safeHttps(dataset.url); const steps: GuidanceStep[] = [];
  if (link) steps.push({ text: 'Open the repository record and review its metadata and reuse terms.', links: [{ label: 'Repository record', url: link }] });
  else steps.push({ text: 'Find the repository record and review its metadata and reuse terms.' });
  if (dataset.access === 'controlled') {
    steps.push({ text: dataset.repository === 'EGA' ? 'Identify the dataset and apply to its Data Access Committee; download only after approval.' : dataset.repository === 'dbGaP' ? 'Apply for authorized access through dbGaP; follow its download instructions after approval.' : 'Follow the repository’s instructions to request access before downloading.' });
    return steps;
  }
  const repo = dataset.repository.toLowerCase();
  if (repo === 'sra' || repo === 'bioproject') {
    const run = dataset.accessions.find(a => /^(?:SRR|ERR|DRR)[0-9]+$/.test(a));
    steps.push({ text: 'Select the relevant runs and use the SRA Toolkit to download sequence data.', ...(run ? { command: `prefetch ${run}` } : {}), links: [{ label: 'SRA download guide', url: 'https://trace.ncbi.nlm.nih.gov/sra/docs/sradownload/' }] });
  } else if (repo === 'geo') steps.push({ text: 'Use the GEO record to download the available data and supplementary files.', links: [{ label: 'GEO download guide', url: 'https://www.ncbi.nlm.nih.gov/geo/info/download.html' }] });
  else if (repo === 'pride') steps.push({ text: 'Choose files from the PRIDE dataset page.', links: [{ label: 'PRIDE download guide', url: 'https://www.ebi.ac.uk/training/online/courses/pride-quick-tour/downloading-data-using-pride-archive/' }] });
  else if (repo === 'arrayexpress') steps.push({ text: 'Download files from the BioStudies study page; sequence reads may be linked through ENA.', links: [{ label: 'ArrayExpress download guide', url: 'https://www.ebi.ac.uk/training/online/courses/arrayexpress-in-biostudies/getting-data-from-the-arrayexpress-collection/' }] });
  else if (repo === 'pdb') steps.push({ text: 'Download structure files from the structure summary page.', links: [{ label: 'RCSB PDB downloads', url: 'https://www.rcsb.org/downloads/' }] });
  else steps.push({ text: 'Select the available files and follow the repository’s download instructions.' });
  return steps;
}
