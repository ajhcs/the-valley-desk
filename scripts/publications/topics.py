"""Classify publication topics from Europe PMC subject terms."""
import re


OTHER_SCIENCE = 'Other science'

# Prefer explicit, specific classifications over broad disciplinary terms.
RULES = tuple((topic, re.compile(pattern, re.IGNORECASE)) for topic, pattern in (
    ('Research data', r'\b(?:data sets?|datasets?|data descriptors?|data resources?|databases?)\b'),
    ('Medical imaging', r'\b(?:diagnostic imaging|medical imaging|magnetic resonance imaging|mri|radiograph\w*|sonograph\w*|computed tomography|ultrasonograph\w*)\b'),
    ('Rehabilitation and accessibility', r'\b(?:rehabilitation|accessibility|disability|prosthe\w*|assistive technology|speech therapy)\b'),
    ('Neuroscience', r'\b(?:neuroscien\w*|neuropsycholog\w*|brain|cogniti\w*|alzheimer\w*|dementia|neural|parkinson\w*)\b'),
    ('Public health', r'\b(?:public health|epidemiolog\w*|health disparit\w*|disease surveillance|disease prevention|environmental exposure|vaccin\w*|population health)\b'),
    ('Clinical care', r'\b(?:clinical medicine|clinical trials?|patient care|case reports?|surg\w*|treatment|therapy|therapeutics|medical procedures?)\b'),
    ('Disease research', r'\b(?:disease\w*|cancer\w*|tumou?rs?|oncolog\w*|infection\w*|diabet\w*|syndromes?|patholog\w*|immune disorders?)\b'),
    ('Biomedical and life sciences', r'\b(?:biomedic\w*|biology|biochem\w*|genom\w*|proteom\w*|microbiol\w*|physiolog\w*|cells?|enzym\w*|genes?|rna|dna|organisms?)\b'),
))


def publication_topic(terms):
    for topic, pattern in RULES:
        if any(pattern.search(term) for term in terms):
            return topic
    return OTHER_SCIENCE
