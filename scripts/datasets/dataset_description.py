"""Source-grounded, conservative dataset descriptions and data types.

An empty summary means the supplied repository metadata did not describe the
recorded data clearly enough to publish. Callers should keep their existing
no-description gate rather than substituting a study conclusion.
"""
import re

from common import one_sentence, strip_markup
from datacite_rules import data_type_for_text

LABEL = re.compile(r"^(?:abstract|summary|description|overview|background|aims?|objectives?|introduction|purpose|context|motivation|rationale|methods?)\s*[:.\-]\s*", re.I)
SKIP = re.compile(r"@|\b(?:please|contact|correspond\w*|requests? for|cite|citation|copyright|licen[cs]e|readme|funded by|grant|e-?mail)\b", re.I)
DATA = re.compile(r"\b(?:data(?:set|sets)?|measurements?|recordings?|images?|sequences?|sequencing|reads|expression profiles?|transcriptom\w*|proteom\w*|metabolom\w*|genom\w*|rna[- ]?seq|atac[- ]?seq|chip[- ]?seq|microarray|survey responses?|questionnaire responses?|clinical records?|patient records?|mass spectra|spectrometry|microscop\w*|mri|fmri|eeg|ecog|ieeg|samples?)\b", re.I)
ACTION = re.compile(r"\b(?:contain\w*|includ\w*|compris\w*|provid\w*|consist\w*|record\w*|collect\w*|measur\w*|obtain\w*|generat\w*|acquir\w*|profil\w*|sequenc\w*|assay\w*|analy[sz]\w*|perform\w*|investigat\w*|exam\w*|data (?:are|were|from|for|of)|dataset (?:is|of|from|for)|study (?:of|on))\b", re.I)


def pick_summary(*texts):
    """Return one complete source sentence describing recorded data, or ''."""
    candidates = []
    for text in texts:
        cleaned = re.sub(r"https?://\S+|doi:\s?\S+", "", strip_markup(text))
        for sentence in re.split(r"(?<=[a-z0-9\)\]%])[.!?]\s+(?=[A-Z])", cleaned):
            sentence = LABEL.sub("", sentence.strip()).strip()
            if (len(sentence) < 25 or SKIP.search(sentence)
                    or re.match(r"(?i)(this (?:sub)?series|this superseries|refer to individual|keywords?:)", sentence)):
                continue
            if DATA.search(sentence) and ACTION.search(sentence):
                # Never publish a sentence truncated in the middle of its claim.
                summary = one_sentence(sentence)
                if summary and not summary.endswith("…"):
                    candidates.append(summary)
    return candidates[0] if candidates else ""


def data_type_for_record(text, prefix="", formats=()):
    """Classify from text first, then unambiguous file-format evidence.

    Generic formats such as CSV, ZIP and PDF do not establish a modality.
    """
    kind = data_type_for_text(text, prefix)
    if kind != "other":
        return kind
    normalized = " ".join(str(f or "").lower() for f in (formats or ()))
    if re.search(r"(?<![a-z0-9])(?:fastq|fq|bam|cram|vcf)(?:\.gz)?(?![a-z0-9])", normalized):
        return "sequencing"
    if re.search(r"(?<![a-z0-9])(?:dicom|nifti|nii)(?:\.gz)?(?![a-z0-9])", normalized):
        return "imaging"
    return "other"
