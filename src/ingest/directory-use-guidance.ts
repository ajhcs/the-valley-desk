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
  const repo = dataset.repository.trim().toLowerCase();
  const patterns: Record<string, RegExp> = {
    sra: /^(?:SR[PRSX]|ER[PRSX]|DR[PRSX]|PRJ(?:NA|EB|DB))[0-9]+$/,
    bioproject: /^PRJ(?:NA|EB|DB)[0-9]+$/,
    geo: /^GS[EM][0-9]+$/,
    dbgap: /^phs[0-9]{6}(?:\.v[0-9]+\.p[0-9]+)?$/,
    ega: /^EGA[SD][0-9]{11}$/,
    pride: /^PXD[0-9]{6}$/,
    arrayexpress: /^E-[A-Z]{4}-[0-9]+$/,
    pdb: /^[0-9][A-Za-z0-9]{3}$/,
    emdb: /^EMD-[0-9]+$/,
    dryad: /^10\.5061\/dryad\.[A-Za-z0-9._-]+$/i,
    zenodo: /^10\.5281\/zenodo\.[0-9]+$/i,
    figshare: /^10\.(?:6084|25452)\/[A-Za-z0-9._/-]+$/i,
    osf: /^10\.17605\/[A-Za-z0-9._/-]+$/i,
  };
  const accession = dataset.accessions.find(value => patterns[repo]?.test(value));
  const link = safeHttps(dataset.url);
  const steps: GuidanceStep[] = [{
    text: `Open the repository record${accession ? ` for ${accession}` : ''} and review its metadata and reuse terms.`,
    ...(link ? { links: [{ label: 'Repository record', url: link }] } : {}),
  }];
  const accessGuides: Record<string, { label: string; url: string }> = {
    physionet: { label: 'PhysioNet access guide', url: 'https://physionet.org/about/faqs/' },
    synapse: { label: 'Synapse access guide', url: 'https://docs.synapse.org/synapse-docs/finding-and-downloading-data' },
    'nimh data archive': { label: 'NDA access instructions', url: 'https://nda.nih.gov/ndarpublicweb/Documents/Data_Access_Documents_Completion_Instructions.pdf' },
    icpsr: { label: 'ICPSR access guide', url: 'https://www.icpsr.umich.edu/sites/nacda/posts/shared/how-do-i-access-the-data-is-it-free' },
    dandi: { label: 'DANDI download guide', url: 'https://docs.dandiarchive.org/user-guide-using/accessing-data/downloading/' },
  };
  if (dataset.access === 'controlled') {
    const instructions: Record<string, GuidanceStep> = {
      ega: { text: 'Identify the dataset and apply to its Data Access Committee; download only after approval.', links: [{ label: 'EGA access guide', url: 'https://www.ebi.ac.uk/training/online/courses/ega-quick-tour/accessing-the-data-in-the-ega/' }] },
      dbgap: { text: 'Apply for authorized access through dbGaP; follow its download instructions after approval.', links: [{ label: 'dbGaP download guide', url: 'https://www.ncbi.nlm.nih.gov/sra/docs/sra-dbgap-download/' }] },
    };
    steps.push(instructions[repo] ?? { text: 'Follow the repository’s instructions to request access before downloading.', ...(accessGuides[repo] ? { links: [accessGuides[repo]] } : {}) });
    return steps;
  }
  if (dataset.access === 'registration') steps.push({ text: 'Follow the repository’s registration and access instructions.' });
  if (repo === 'sra' || repo === 'bioproject') {
    const run = dataset.accessions.find(a => /^(?:SRR|ERR|DRR)[0-9]+$/.test(a));
    steps.push({ text: 'Use the SRA Run Selector to select runs, then use the SRA Toolkit to download them.', ...(run ? { command: `prefetch ${run}` } : {}), links: [{ label: 'Run Selector guide', url: 'https://trace.ncbi.nlm.nih.gov/Traces/study1/?go=help' }, { label: 'SRA download guide', url: 'https://trace.ncbi.nlm.nih.gov/sra/docs/sradownload/' }] });
    return steps;
  }
  const templates: Record<string, GuidanceStep> = {
    emdb: { text: 'Use the entry’s downloads tab to obtain released maps.', links: [{ label: 'EMDB map access', url: 'https://www.ebi.ac.uk/emdb/documentation/faq' }] },
    'mendeley data': { text: 'Open the dataset page to view and download available files.', links: [{ label: 'Mendeley Data access', url: 'https://data.mendeley.com/archive-process' }] },
    dataverse: { text: 'Select available files on the dataset page and use its download controls.', links: [{ label: 'Dataverse user guide', url: 'https://guides.dataverse.org/en/4.17/Dataverse.pdf' }] },
    'harvard dataverse': { text: 'Select available files on the dataset page and use its download controls.', links: [{ label: 'Dataverse user guide', url: 'https://guides.dataverse.org/en/4.17/Dataverse.pdf' }] },
    physionet: { text: 'Check the project’s Files section for access requirements and available downloads.', links: [accessGuides.physionet] },
    openneuro: { text: 'Choose a dataset version and download available files from its page.', links: [{ label: 'OpenNeuro user guide', url: 'https://docs.openneuro.org/user_guide.html' }] },
    synapse: { text: 'Check file access and use the project’s Files tab to find available downloads.', links: [accessGuides.synapse] },
    tcia: { text: 'Follow the collection’s download instructions; imaging collections may use the NBIA Data Retriever.', links: [{ label: 'NBIA Data Retriever guide', url: 'https://wiki.cancerimagingarchive.net/display/NBIA/NBIA%2BData%2BRetriever%2BFAQ' }] },
    'nimh data archive': { text: 'Follow the record’s access and download instructions.', links: [accessGuides['nimh data archive']] },
    dandi: { text: 'Use the Dandiset page to select files or see download instructions.', links: [accessGuides.dandi] },
    icpsr: { text: 'Use the study page to select available files and review access requirements.', links: [accessGuides.icpsr] },
    geo: { text: 'Use the GEO record to download the available data and supplementary files.', links: [{ label: 'GEO download guide', url: 'https://www.ncbi.nlm.nih.gov/geo/info/download.html' }] },
    pride: { text: 'Choose files from the PRIDE dataset page.', links: [{ label: 'PRIDE download guide', url: 'https://www.ebi.ac.uk/training/online/courses/pride-quick-tour/downloading-data-using-pride-archive/' }] },
    arrayexpress: { text: 'Download files from the BioStudies study page; sequence reads may be linked through ENA.', links: [{ label: 'ArrayExpress download guide', url: 'https://www.ebi.ac.uk/training/online/courses/arrayexpress-in-biostudies/getting-data-from-the-arrayexpress-collection/' }] },
    pdb: { text: 'Download structure files from the structure summary page.', links: [{ label: 'RCSB PDB downloads', url: 'https://www.rcsb.org/downloads/' }] },
    dryad: { text: 'Use Download dataset on the Dryad record to retrieve its available files.', links: [{ label: 'Dryad publication guide', url: 'https://datadryad.org/help/guides/publication' }] },
    zenodo: { text: 'Choose files or download all available files from the Zenodo record.', links: [{ label: 'Zenodo record features', url: 'https://help.zenodo.org/docs/about/whats-new/' }] },
    figshare: { text: 'Choose the available files from the figshare record.', links: [{ label: 'figshare API documentation', url: 'https://docs.figshare.com/v2/' }] },
    osf: { text: 'Choose available files from the OSF project or component.', links: [{ label: 'OSF download guide', url: 'https://help.osf.io/article/736-download-osf-content' }] },
  };
  steps.push(templates[repo] ?? { text: 'Select the available files and follow the repository’s download instructions.' });
  return steps;
}
