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
    r"^(?:table|fig(?:ure)?\.?)\s*s?\s*\d+[a-z]?(?:(?:\s*\.[a-z0-9]+)|(?:\s+of\b.*))?$", re.I)
GENERIC_FILE_OF = re.compile(r"^additional file(?:\s+\d+)?(?:\s+of\b.*)?$", re.I)


def generic_supplement_decision(title, descriptions=None):
    """Return (drop, reason) for generic supplemental titles shared by both sources."""
    title = " ".join((title or "").split()).strip()
    if NUMBERED_SUPPLEMENT.fullmatch(title):
        return True, "numbered supplement title"
    if GENERIC_SUPPLEMENT.fullmatch(title) or GENERIC_FILE_OF.fullmatch(title):
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

# Evidence must name a medical research context; words such as "disease",
# "health", "treatment", and "diagnosis" have broad nonmedical uses.
MEDICAL_CONTEXT = re.compile(
    r"\b(?:clinical (?:trial\w*|stud\w*|research|care|outcomes?|data|patients?|practice|cohort\w*|"
    r"diagnos\w*|treatment\w*|assessment\w*|sample\w*|records?)|"
    r"patients?(?:'s|')? (?:with|diagnos\w*|receiv\w*|undergo\w*|treat\w*|care|outcomes?|samples?|records?)|"
    r"(?:hospital|healthcare|health care) (?:patients?|admissions?|care|records?|data|services?|settings?)|"
    r"(?:human|public|population) health (?:research|study|studies|outcomes?|data|survey\w*|care|intervention\w*|policy|policies)|"
    r"(?:medical|biomedical) (?:research|stud\w*|data|science\w*|imaging|care|treatment\w*|diagnos\w*|device\w*|applications?)|"
    r"(?:cancer|oncology|cardiovascular|diabetes|dementia) (?:research|stud\w*|patients?|treatment\w*|therapy|therapies|diagnos\w*|care|risk|outcomes?|data|cohort\w*)|"
    r"(?:human|patient) (?:disease\w*|patients?|clinical samples?|health records?)|"
    r"(?:drug discovery|drug development|pharmaceutical research|clinical pharmacology|"
    r"electronic health records?|public health surveillance|medical imaging|patient care|"
    r"clinical medicine|health sciences|health policy|healthcare delivery))\b", re.I)
# In a title or controlled subject label, these disease-specific terms are
# meaningful evidence. Avoid single ambiguous words in free-text descriptions.
MEDICAL_LABEL = re.compile(
    r"\b(?:cancer|oncolog\w*|carcinoma\w*|diabet\w*|cardiovascular|dementia|"
    r"psychiatr\w*|clinical medicine|medical science\w*|biomedical science\w*|"
    r"medical research|health sciences|public health|clinical trial\w*|patient care)\b", re.I)
FOS_BIOMEDICAL = re.compile(
    r"\bFOS:\s*(?:health sciences|clinical medicine|basic medicine|medical and health sciences|"
    r"medical biotechnology|health biotechnology|other medical science)\b", re.I)
NONMEDICAL_TITLE = re.compile(
    r"\b(?:ecolog\w*|ecosystem\w*|biodivers\w*|plants?|crop\w*|forest\w*|"
    r"wildlife|animal movement\w*|bird\w*|geophys\w*|seismic\w*|earthquake\w*|"
    r"geolog\w*|ocean\w*|climate|atmospher\w*|agricultur\w*)\b", re.I)


# These terms describe biomedical measurements but are too broad to establish
# medical scope on their own. Only use them with a corroborated medical creator.
MEDICAL_MEASUREMENT = re.compile(
    r"\b(?:m?eeg|electroencephalograph\w*|magnetoencephalograph\w*|"
    r"dna methylation|methylation (?:array|profil\w*|data)|"
    r"(?:illumina )?(?:infinium )?(?:humanmethylation450|hm450|450k)|"
    r"(?:human|patient|clinical) (?:biospecimens?|tissue samples?|blood samples?|imaging|records?)|"
    r"single[- ]cell(?:ular)?|gene expression|(?:protein|cell) profil\w*|"
    r"(?:neuro|brain|cardiac|retinal|diagnostic) imaging|magnetic resonance imaging|"
    r"immune (?:cell|response|profil)\w*|patient (?:cohort|outcome|data)\w*)\b", re.I)

# Only drop generic publication containers when no description supplies context.
GENERIC_JUNK = re.compile(
    r"^(?:(?:annual|quarterly|monthly) report(?:\s+\d{4})?|"
    r"(?:volume|vol\.?|issue|no\.?)\s*\d+(?:\s*[,/:-]\s*\d+)?|"
    r"(?:dataset|data|report|publication|journal|newsletter)(?:\s+\d+)?)$", re.I)
SERIAL_CODE = re.compile(r"^[A-Z]{1,12}[- ]?\d{1,8}[A-Za-z]?$")
SERIAL_REPORT = re.compile(r"^(?:[A-Z]{1,4} ){1,3}Reports? [A-Za-z]?\d{1,8}$")


def generic_junk_decision(title, descriptions=None):
    """Identify a narrow generic title without descriptive context."""
    title = " ".join((title or "").split()).strip()
    if SERIAL_CODE.fullmatch(title) or SERIAL_REPORT.fullmatch(title):
        return True, "serial or report code title"
    if isinstance(descriptions, str):
        descriptions = [descriptions]
    if not any(str(x or "").strip() for x in (descriptions or [])):
        if GENERIC_JUNK.fullmatch(title) or len(re.findall(r"\b\w+(?:[-’']\w+)*\b", title)) < 4:
            return True, "short or generic title without description"
    return False, None


# Negative study context wins over incidental model-organism vocabulary.
EXCLUDED_CONTEXT = re.compile(
    r"\b(?:ecolog\w*|ecosystem\w*|biodivers\w*|wild(?:life|[- ]population|[- ]caught)|"
    r"field (?:stud\w*|survey\w*|observations?|sampling)|natural populations?|"
    r"population genetics?|phylogeograph\w*|environmental microbi\w*|soil|sediment\w*|"
    r"agricultur\w*|crops?|plants?|arabidopsis|nicotiana|oryza sativa|zea mays|"
    r"forest\w*|animal movement|predation|predator|foraging)\b", re.I)
PRIMARY_HEALTH = re.compile(
    r"\b(?:clinical (?:trial\w*|stud\w*|research|care|outcomes?|data|patients?|cohort\w*)|"
    r"patient(?:s|'s)? (?:with|care|samples?|outcomes?|cohort|treatment)|"
    r"(?:human|public) health (?:research|study|studies|outcomes?|data|survey\w*|policy)|"
    r"(?:cancer|oncology|cardiovascular|diabetes|dementia) (?:research|study|patients?|treatment|data|cohort)|"
    r"(?:medical|biomedical) (?:research|study|studies|data|care)|human disease|clinical medicine|patient care|"
    r"clinical (?:isolates?|specimens?|diagnos\w*)|infectious disease|vaccine(?: development| efficacy)?|"
    r"(?:preclinical|subclinical) \w+ disease)\b", re.I)
LAB_EVIDENCE = re.compile(
    r"\b(?:cell lines?|cell cultures?|cultured cells?|stem cells?|organoids?|single[- ]cell|"
    r"gene expression|rna[- ]seq|transcriptom\w*|proteom\w*|chromatin|histone\w*|"
    r"protein structure|(?:protein|enzyme|ribosome) crystal structure|molecular biology|cell biology|"
    r"developmental biology|structural biology|crystal structure|cryogenic electron microscopy|"
    r"embryo\w*|neurons?|neuroscience|immun\w*|genome[- ]wide|genomic sequencing|"
    r"rna sequencing|dna sequencing|transcription factor|gene silencing|"
    r"gene regulation|ribosom\w*|methylom\w*|epigen\w*|"
    r"molecular structure|cell differentiation|b cell|t cell|hepatocyte\w*|"
    r"neural circuits?|brain imaging|eeg|meeg|electroencephalograph\w*|dna methylation|"
    r"humanmethylation450|hm450|laboratory (?:experiments?|stud\w*|samples?|data)|in vitro|"
    r"(?:mouse|mice|murine|rats?|zebrafish|drosophila|c\. elegans|yeast|bacteri\w*|virus\w*|viral)"
    r"\b[^.!?]{0,80}\b(?:cells?|embryo\w*|genes?|genom\w*|proteins?|neurons?|"
    r"laboratory|experiments?|expression|development|imaging|microscop\w*)|"
    r"(?:genes?|genom\w*|proteins?|cells?|neurons?)\b[^.!?]{0,80}\b"
    r"(?:mouse|mice|murine|rats?|zebrafish|drosophila|c\. elegans|yeast|bacteri\w*|virus\w*|viral))\b", re.I)


def _scope_text(title, descriptions):
    if isinstance(descriptions, str):
        descriptions = [descriptions]
    return NEURAL_NET.sub(" ", " ".join([title or ""] + [str(x or "") for x in (descriptions or [])])[:12000])


def nonmedical_recovery_decision(title, descriptions=None):
    """Reject explicit excluded contexts unless primary health evidence is present."""
    text = _scope_text(title, descriptions)
    if EXCLUDED_CONTEXT.search(text) and not PRIMARY_HEALTH.search(re.sub(r"\b(?:implications?|relevance|potential|may be relevant)\b[^.!?]*", " ", text, flags=re.I)):
        return True, "excluded field, environmental, agriculture or plant context"
    return False, None


def health_decision(d, medical_creator=False):
    """Return (keep, evidence location) for health and laboratory life sciences."""
    title = NEURAL_NET.sub(" ", d.get("title") or "")
    text = _scope_text(title, d.get("descriptions") or [])
    subjects = d.get("subjects") or []
    if isinstance(subjects, str):
        subjects = [subjects]
    subjects = " ; ".join(str(x or "") for x in subjects)
    primary = PRIMARY_HEALTH.search(re.sub(
        r"\b(?:implications?|relevance|potential|may be relevant)\b[^.!?]*", " ", text, flags=re.I))
    strong_title = bool(MEDICAL_CONTEXT.search(title) or MEDICAL_LABEL.search(title) or LAB_EVIDENCE.search(title))
    if (EXCLUDED_CONTEXT.search(title) or (EXCLUDED_CONTEXT.search(text) and not strong_title)) and not primary:
        return False, "excluded field, environmental, agriculture or plant context"
    if NON_HEALTH.search(title) and not (primary or strong_title):
        return False, "non-biological research title"
    if MEDICAL_CONTEXT.search(title) or MEDICAL_LABEL.search(title):
        return True, "health or biomedical evidence in title"
    if MEDICAL_CONTEXT.search(text):
        return True, "health or biomedical evidence in description"
    if LAB_EVIDENCE.search(title):
        return True, "laboratory life-science evidence in title"
    if LAB_EVIDENCE.search(text):
        return True, "laboratory life-science evidence in description"
    if LAB_EVIDENCE.search(subjects):
        return True, "laboratory life-science evidence in subjects"
    if FOS_BIOMEDICAL.search(subjects) or MEDICAL_CONTEXT.search(subjects) or MEDICAL_LABEL.search(subjects):
        return True, "health or biomedical evidence in subjects"
    return False, "no health, biomedical or laboratory life-science evidence"


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
