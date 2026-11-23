"""Conservative relationship between a dataset and each linked paper.

Classification and listing eligibility are separate from this display claim. A
repository citation or explicit text about data generated/deposited by the
study supports `produced`; other links remain `linked`.
"""
import re

_ORIGINAL = re.compile(
    r"\b(?:data|datasets?|samples?|sequenc(?:es|ing data)|reads|structures?|"
    r"proteom(?:e|ic data)|results?)\b.{0,100}\b(?:generated|produced|collected|"
    r"created|deposited|submitted|uploaded|archived)\b.{0,80}"
    r"\b(?:this|the present|the current|our)\s+(?:study|paper|work|research|article)\b"
    r"|\b(?:generated|produced|collected|created|deposited|submitted|uploaded|archived)\b"
    r".{0,80}\b(?:in|for|by|from|during)\s+(?:this|the present|the current|our)\s+"
    r"(?:study|paper|work|research|article)\b", re.I)
_REUSE = re.compile(r"\b(?:previously|prior(?:ly)?|existing|publicly available|obtained from|downloaded from|retrieved from|reused|re-analys[ei]d)\b", re.I)
_DEPOSIT = re.compile(
    r"\b(?:data|datasets?|reads|measurements|structures)\b.{0,90}\b(?:are|is|were|was|has been|have been) "
    r"(?:deposited|submitted|uploaded|archived)\b", re.I)
_RESOURCE_ROW = re.compile(r"\b(?:data|dataset|reads|structures|recordings)\b.*\|\s*this paper\s*\|", re.I)


def paper_provenance(mentions, decisions):
    """Return per-paper relations for a listing's mentions and reuse decisions.

    Decisions are the output of reuse.adjudicate. Negative reuse decisions take
    precedence over matching prose; repository citations must match the paper.
    Missing evidence never implies production.
    """
    by_key = {(d.get('paper'), d.get('unit_type'), d.get('unit')): d for d in decisions}
    relations = {}
    for mention in mentions:
        paper = mention.get('paper')
        if not paper:
            continue
        decision = by_key.get((paper, mention.get('unit_type'), mention.get('unit')), {})
        text = str(mention.get('clause') or '')
        section = str(mention.get('section') or '')
        exact = str(mention.get('exact') or mention.get('unit') or '')
        in_scope = bool(re.search(r'data.*(?:availab|access|sharing)|methods|materials', section, re.I))
        refers_to_accession = bool(exact and exact.lower() in text.lower())
        deposit_statement = (mention.get('unit_type') in (
                                 'geo', 'pdb', 'emdb', 'pride', 'doi', 'arrayexpress',
                                 'bioproject', 'sra-run', 'sra-study', 'assembly')
                             and re.search(r'data.*(?:availab|access|sharing)', section, re.I)
                             and _DEPOSIT.search(text))
        source_row = 'key resources table' in section.lower() and _RESOURCE_ROW.search(text)
        original_text = ((in_scope and _ORIGINAL.search(text)) or deposit_statement or source_row)
        produced = (mention.get('decision') == 'produced' and decision.get('decision') != 'reused'
                    and (decision.get('citation_match') or (refers_to_accession and original_text and not _REUSE.search(text))))
        if produced or paper not in relations:
            relations[paper] = 'produced' if produced else 'linked'
    return [{'paper': paper, 'relation': relations[paper]} for paper in sorted(relations)]
