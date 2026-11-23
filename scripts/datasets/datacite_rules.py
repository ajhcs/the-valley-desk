"""DataCite record rules: supplements, health/life-science filter, topic, data type, access, licence, release date.

The publication topic rules in scripts/publications/ rely on indexed MeSH-like terms plus a model step, so they do
not apply to DataCite titles and descriptions. This module uses a keyword rule instead (recorded as
topic_rule = "keyword-v1" in the report).
"""
import re

SUPP = re.compile(r"^(additional file \d+|supplementa(?:ry|l)\b|supporting information|table s\d|figure s\d|fig\. ?s\d|"
                  r"data sheet \d|movie s\d|video s\d|appendix\b|s\d+ (?:table|fig|file|data|text|appendix)|"
                  r"(?:data_sheet|table|image|presentation|video|audio|supplementary_material|figure|datasheet)_\d+_|"
                  r"moesm|mmc\d)", re.I)
SUPP_ANY = re.compile(r"\bAdditional file \d+ of\b|\bSupplementa(?:l|ry) material for\b|\bMOESM\d|^sj-[a-z]+-\d", re.I)

FOS_HEALTH = re.compile(r"FOS: (biological sciences|health sciences|clinical medicine|basic medicine|medical and health sciences|"
                        r"medical biotechnology|health biotechnology|psychology|veterinary science|agricultural biotechnology|"
                        r"other medical science)", re.I)
FOS_OTHER = re.compile(r"FOS: (physical sciences|earth and related environmental sciences|chemical sciences|mathematics|"
                       r"computer and information sciences|electrical engineering|mechanical engineering|civil engineering|"
                       r"materials engineering|chemical engineering|environmental engineering|nano-technology|economics|"
                       r"political science|law|languages|history|philosophy|arts|media and communications|"
                       r"social and economic geography|other engineering|environmental biotechnology|industrial biotechnology)", re.I)
NON_HEALTH_PUBLISHERS = re.compile(r"seismolog|space physics|ncei|noaa|pangaea|earthchem|iris dmc|unavco|nasa|"
                                   r"atmospheric|ocean|ice core|geoscience|plasma physics|woods hole|geological survey|"
                                   r"fairsharing", re.I)

HEALTH = re.compile(
    r"\b(patients?|clinical|clinic|hospital\w*|disease\w*|disorders?|cancer\w*|tumou?r\w*|oncolog\w*|carcinoma\w*|"
    r"leukemi\w*|lymphoma\w*|diabet\w*|obes\w*|cardi\w*|heart|vascular|stroke|alzheimer\w*|parkinson\w*|dementia|"
    r"autism|schizophren\w*|depress\w*|anxiety|psychiatr\w*|mental health|health\w*|medic\w*|surg\w*|therap\w*|"
    r"drug\w*|pharmac\w*|vaccin\w*|infect\w*|viral|virus\w*|bacteri\w*|pathogen\w*|antibiot\w*|antimicrob\w*|"
    r"covid\w*|sars-cov-2|hiv|malaria|tubercul\w*|immun\w*|inflamm\w*|mortality|epidemiolog\w*|pediatric\w*|"
    r"paediatric\w*|maternal|pregnan\w*|neonat\w*|nutrition\w*|diet\w*|opioid\w*|overdose|substance use|smoking|"
    r"tobacco|alcohol|injur\w*|trauma\w*|rehabilit\w*|nurs\w*|mri|fmri|eeg|ct scans?|radiolog\w*|"
    r"genes?|genom\w*|genetic\w*|rna|dna|rna-seq|scrna-seq|transcriptom\w*|proteom\w*|protein\w*|metabol\w*|cells?|"
    r"cellular|tissues?|organoid\w*|mouse|mice|murine|rats?|zebrafish|drosophila|c\. elegans|yeast|microbio\w*|"
    r"neuro\w*|neural|neurons?|brain|cortex|cortical|hippocamp\w*|synap\w*|cognit\w*|behavio\w*|physiolog\w*|"
    r"biolog\w*|biomedic\w*|enzym\w*|antibod\w*|receptor\w*|mutation\w*|sequencing|microscop\w*|"
    r"species|ecolog\w*|evolution\w*|organism\w*|plants?|insects?|birds?|fish|mammal\w*|primate\w*|population genetic\w*|"
    r"phylogen\w*|biodivers\w*|microbiome|gut|blood|serum|liver|kidney|lung\w*|bone|muscle\w*|skin|"
    r"survey of (?:adults|patients|parents|youth)|public health|health policy|cohort)\b", re.I)
# Strongly non-health topics; checked against the title only.
NON_HEALTH = re.compile(
    r"\b(seismic\w*|earthquake\w*|galax\w*|stellar|astrophys\w*|cosmolog\w*|magnetospher\w*|solar wind|plasma physics|"
    r"climate model\w*|ocean\w*|sediment\w*|glacier\w*|catalys\w*|polymer\w*|batter(?:y|ies)|quantum|photonic\w*|"
    r"semiconductor\w*|superconduct\w*|thin films?|alloy\w*|turbulen\w*|aerosol\w*|atmospher\w*|precipitation|"
    r"election\w*|voting|congress\w*|legislat\w*|macroeconom\w*|stock market|hydrolog\w*|geolog\w*|mineral\w*|"
    r"tectonic\w*|volcan\w*|lidar|radar|satellite|wind turbine\w*|combustion|fusion reactor|tokamak|"
    r"graphene|crystal growth|perovskite\w*|lattice|spectroscop\w* of (?:molecules|gases)|lithium|carbonates?|alumina|"
    r"tungsten|etching|silicon|diamond|molten|mars|martian|glacial|sinter\w*|alkalinity|inorganic carbon|"
    r"deep potential|ab[- ]?initio|density functional|interatomic|vapor-liquid)\b", re.I)
# Plasma physics uses "plasma": do not count "plasma" as health when physics words are present.
PHYSICS_CTX = re.compile(r"\b(tokamak|fusion|magnet\w*|ionospher\w*|laser|electron density|ion temperature)\b", re.I)


GENERIC_SUPPLEMENT = re.compile(
    r"^(?:supplementa(?:ry|l)(?: (?:data|material|materials|information|files?))?|"
    r"supporting (?:data|information|material|materials)|additional (?:data|files?))(?:\s*\.[a-z0-9]+)?$", re.I)
GENERIC_CODE_AND_DATA = re.compile(r"^(?:code and data|data and code)(?:\s*\.[a-z0-9]+)?$", re.I)
NUMBERED_SUPPLEMENT = re.compile(
    r"^(?:table|fig(?:ure)?\.?)\s*s\s*\d+[a-z]?(?:\s*\.[a-z0-9]+)?$", re.I)


def generic_supplement_decision(title, descriptions=None):
    """Return (drop, reason) for generic supplemental titles shared by both sources."""
    title = " ".join((title or "").split()).strip()
    if NUMBERED_SUPPLEMENT.fullmatch(title):
        return True, "numbered supplement title"
    if GENERIC_SUPPLEMENT.fullmatch(title):
        return True, "generic supplement title"
    if isinstance(descriptions, str):
        descriptions = [descriptions]
    has_description = any(str(x or "").strip() for x in (descriptions or []))
    if GENERIC_CODE_AND_DATA.fullmatch(title) and not has_description:
        return True, "generic supplement title without description"
    return False, None


def is_supplement(title, d):
    if generic_supplement_decision(title, d.get("descriptions"))[0]:
        return True
    return bool(SUPP.search(title.strip()) or SUPP_ANY.search(title))


NEURAL_NET = re.compile(r"\b(?:deep |artificial |graph |convolutional )?neural[- ]networks?\b|\bmolecular dynamics\b|\bplasmas?\b", re.I)

# Generic biology and molecular methods alone do not establish biomedical purpose.
BIOMEDICAL = re.compile(
    r"\b(?:patients?|clinical|clinic|hospital\w*|disease\w*|disorders?|cancer\w*|tumou?r\w*|"
    r"oncolog\w*|carcinoma\w*|diabet\w*|cardiovascular|stroke|dementia|psychiatr\w*|"
    r"health\w*|medical|medicine|"
    r"biomedic\w*|surg\w*|therap\w*|treatment\w*|diagnos\w*|pharmac\w*|"
    r"vaccin\w*|epidemiolog\w*|nurs\w*|rehabilit\w*|radiolog\w*|"
    r"human health|human disease|drug discovery|drug development|drug resistance|"
    r"patient care|clinical trial\w*|electronic health records?|medical imaging)\b", re.I)
FOS_BIOMEDICAL = re.compile(
    r"\bFOS:\s*(?:health sciences|clinical medicine|basic medicine|medical and health sciences|"
    r"medical biotechnology|health biotechnology|other medical science)\b", re.I)


def health_decision(d):
    """Return evidence-based (keep, rule) for health or biomedical scope."""
    title = NEURAL_NET.sub(" ", d.get("title") or "")
    descriptions = d.get("descriptions") or []
    if isinstance(descriptions, str):
        descriptions = [descriptions]
    desc = NEURAL_NET.sub(" ", " ".join(str(x or "") for x in descriptions)[:12000])
    subjects = " ; ".join(str(x or "") for x in (d.get("subjects") or []))
    for label, text in (("title", title), ("description", desc), ("subjects", subjects)):
        if BIOMEDICAL.search(text) or (label == "subjects" and FOS_BIOMEDICAL.search(text)):
            return True, "health or biomedical evidence in " + label
    return False, "no health or biomedical evidence"


TOPIC_RULES = [
    ("Medical imaging", r"\b(mri|fmri|magnetic resonance|ct scans?|computed tomography|pet imaging|positron emission|ultrasound|"
                        r"radiograph\w*|radiolog\w*|mammogra\w*|x-ray imaging|medical imag\w*|histopatholog\w* images?|"
                        r"optical coherence tomography|angiogra\w*)\b"),
    ("Rehabilitation and accessibility", r"\b(rehabilit\w*|prosthe\w*|assistive|disabilit\w*|wheelchair|gait|amput\w*|"
                                         r"accessib\w*|physical therapy|occupational therapy|exoskeleton\w*)\b"),
    ("Neuroscience", r"\b(neuro\w*|neural|neurons?|brain|cortex|cortical|hippocamp\w*|synap\w*|cognit\w*|eeg|"
                     r"spinal cord|glia\w*|dopamin\w*|memory|perception|decision[- ]making|olfact\w*|taste|"
                     r"electrophysiolog\w*|calcium imaging|optogenet\w*)\b"),
    ("Public health", r"\b(public health|epidemiolog\w*|surveillance|population[- ]based|prevalence|incidence|"
                      r"disparit\w*|equity|health polic\w*|polic(?:y|ies)|laws?|legal|neighborhood\w*|"
                      r"survey\w*|census|mortality rates?|overdose|opioid\w*|vaccination coverage|social determinants|"
                      r"environmental exposure|air pollution|firearm\w*|violence|tobacco|smoking)\b"),
    ("Clinical care", r"\b(patients?|clinical trial\w*|randomi[sz]ed|treatment\w*|therap\w*|surg\w*|hospital\w*|"
                      r"diagnos\w*|clinic\w*|nurs\w*|care delivery|emergency department|intensive care|"
                      r"electronic health record\w*|ehr|physicians?|guideline\w*|prognos\w*)\b"),
    ("Disease research", r"\b(cancer\w*|malignan\w*|tumou?r\w*|carcinoma\w*|leukemi\w*|lymphoma\w*|disease\w*|infect\w*|"
                         r"diabet\w*|alzheimer\w*|fibros\w*|pathogen\w*|virus\w*|viral|covid\w*|sars-cov-2|hiv|"
                         r"malaria|tubercul\w*|sepsis|autoimmun\w*|inflammat\w*)\b"),
    ("Biomedical and life sciences", r"\b(cells?|cellular|genes?|genom\w*|genetic\w*|rna|dna|protein\w*|transcriptom\w*|"
                                     r"proteom\w*|metabol\w*|mouse|mice|rats?|zebrafish|drosophila|yeast|bacteri\w*|"
                                     r"microb\w*|species|ecolog\w*|evolution\w*|organism\w*|plants?|insects?|birds?|"
                                     r"fish|molecular|enzym\w*|biolog\w*|physiolog\w*|behavio\w*|tissue\w*|immun\w*)\b"),
]
TOPIC_RULES = [(t, re.compile(p, re.I)) for t, p in TOPIC_RULES]


def topic_for_text(text, title=None):
    title = title if title is not None else text[:200]
    for topic, rx in TOPIC_RULES:
        if rx.search(title[:300]):
            return topic
    for topic, rx in TOPIC_RULES:
        if rx.search(text):
            return topic
    return "Other science"


def data_type_for_text(text, prefix=""):
    t = text or ""
    if prefix in ("10.18112", "10.7937", "10.48324") and re.search(r"\b(mri|fmri|imag\w*|ct|pet|eeg|ecog|ieeg|microscop\w*)\b", t, re.I):
        return "imaging"
    if re.search(r"single[- ]cell|scrna|snrna|single[- ]nucle", t, re.I):
        return "single-cell"
    if re.search(r"\b(proteom\w*|mass spectrometry|phosphoproteom\w*|peptid\w* identification)\b", t, re.I):
        return "proteomics"
    if re.search(r"\b(metabolom\w*|lipidom\w*|metabolite profil\w*)\b", t, re.I):
        return "metabolomics"
    if re.search(r"\b(rna-?seq|transcriptom\w*|gene expression|microarray)\b", t, re.I):
        return "gene expression"
    if re.search(r"\b(sequencing|genom\w* assembl\w*|whole[- ]genome|exome|16s|amplicon|metagenom\w*|reads)\b", t, re.I):
        return "sequencing"
    if re.search(r"\b(cryo-?em|crystal structure|x-ray crystallograph\w*|atomic model|structure of the)\b", t, re.I):
        return "structure"
    if re.search(r"\b(mri|fmri|ct scans?|microscop\w*|images|imaging|histolog\w* slides?|whole[- ]slide)\b", t, re.I):
        return "imaging"
    if re.search(r"\b(survey\w*|questionnaire\w*|interview\w*|clinical trial\w*|patients?|cohort|participants|"
                 r"electronic health record\w*|registry|claims data)\b", t, re.I):
        return "clinical and survey"
    return "other"


RESTRICTED = re.compile(r"info:eu-repo/semantics/(restricted|closed|embargoed)Access|restricted access|closed access|"
                        r"embargoed access|controlled access", re.I)


def datacite_access(d, prefix):
    rights = " ; ".join(" ".join(str(v) for v in r.values()) for r in d.get("rights") or [])
    if prefix in ("10.15154", "10.26300"):
        return "registration"
    if prefix == "10.13026" and re.search(r"credential", rights, re.I):
        return "registration"
    if RESTRICTED.search(rights):
        return "registration" if prefix in ("10.7303", "10.13026") else "controlled"
    return "open"


def datacite_license(d):
    for r in d.get("rights") or []:
        uri = (r.get("rightsUri") or "")
        if "info:eu-repo" in uri:
            continue
        name = r.get("rights") or r.get("rightsIdentifier") or ""
        if name and not re.search(r"(open|restricted|closed|embargoed) access", name, re.I):
            return name[:120]
    return None


def datacite_released(d):
    for want in ("Available", "Issued"):
        for x in d.get("dates") or []:
            v = (x.get("date") or "").strip()
            if x.get("dateType") == want and re.fullmatch(r"\d{4}(-\d{2}(-\d{2})?)?", v[:10]):
                return v[:10] if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v[:10]) else v[:7] if re.fullmatch(r"\d{4}-\d{2}", v[:7]) else v[:4]
    if d.get("published") and re.fullmatch(r"\d{4}", str(d["published"])):
        return str(d["published"])
    if d.get("year"):
        return str(d["year"])
    return None
