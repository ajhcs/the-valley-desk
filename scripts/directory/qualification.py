"""Apply Valley Desk's purpose and own-work rules to retained GitHub observations."""

import html
import re
from collections.abc import Mapping

TOPICS = (
    ('Public health', r'public health|epidemiolog\w*|covid(?:[- ]?19)?|pandemic\w*|health equity|population health|medicaid|medicare|disease surveillance|wastewater surveillance|temperature[- ]related mortality|extreme temperatures? and mortality|vaccin\w*|infectious disease'),
    ('Medical imaging', r'medical imag\w*|mri\w*|f[ms]ri\w*|dicom|nifti|radiolog\w*|radiom\w*|mammogra\w*|patholog\w*|histo(?:log\w*|path\w*)|microscop\w*|neuroimag\w*|dwi|pet scans?|ct scans?|computed tomography|ultrasound|blood smears?|digital pathology|bioimag\w*'),
    ('Neuroscience', r'neuro(?:scien\w*|physiolog\w*|anatom\w*|cognit\w*|degener\w*|development\w*)|dopamin(?:e|ergic)|brain quick annotations?|brain (?:connect\w*|networks?|roi|tissue|anatomy|imaging|waves?|data|tumou?rs?|atlas|segmentation)|cerebell\w*|cortical|hippocamp\w*|neuron\w*|neural (?:recording\w*|spike\w*|circuit\w*|activity)|electrophysiolog\w*|eeg|ecog|meg recordings?|synap(?:se\w*|tic)|seizure\w*|cognitive neurolog\w*'),
    ('Clinical care', r'health\s?care|clinical|patient\w*|hospital\w*|medical|medicin\w*|telehealth|telemedicine|diagnos(?:is|tic\w*)|prognos\w*|treatment\w*|electronic health records?|ehr|fhir|omop|mimic(?:[- ]?iv|[- ]?iii)|health informatics|nursing|critical care|surgical|surgery|bedside|antibiotic stewardship|symptom\w*|pharmacovigilance|ecg|ekg|electrocardiogr\w*|injur(?:y|ies) (?:predict\w*|risk|prevention)|sports injur\w*|pulse oxim\w*|case[- ]control'),
    ('Disease research', r'cancer|oncolog\w*|tumou?r\w*|cardiovasc\w*|cardiac|heart (?:study|disease|failure)|diabet\w*|sepsis|alzh?eimer\w*|parkinson\w*|leukemia|lymphoma|asthma|stroke|epilep\w*|dementia|inflamma\w*|disease\w*|nephro\w*|ophthalm\w*|glaucoma|metasta\w*|carcinoma|melanoma|glioma|glioblastoma|hepatitis|immune response|autoimmun\w*'),
    ('Rehabilitation and accessibility', r'rehabilitation|prosthe\w*|assistive technol\w*|wheelchair|hearing aids?|speech therap\w*|occupational therap\w*|physical therap\w*|american sign language|augmentative communication|biomechan\w*|motor impair\w*|audiolog\w*'),
    ('Research data', r'clinical trials?|adverse events?|patient data|biomedical data|biological data|clinical data|disease data|medical records?|vital signs?|health records?|physiology data|research cohort|redcap|case report forms?'),
    ('Biomedical and life sciences', r'biomed\w*|bioinformatic\w*|biostat\w*|genom\w*|metagenom\w*|microbiom\w*|transcriptom\w*|proteom\w*|metabolom\w*|epigen\w*|cell biology|molecular biolog\w*|computational biolog\w*|systems biology|gene expression|rdna|mrna|rna[- ]?seq|rna|dna|snps?|single[- ]cell|cell(?:ular)? (?:type\w*|signaling|line\w*|culture|atlas|segmentation)|crispr|chromatin|ribosom\w*|methylation|gene regulat\w*|gene annotat\w*|phylogene\w*|protein\w*|metabol\w*|immun\w*|drug discover\w*|pharmac\w*|physiolog\w*|pharmaceut\w*|mass spectrometr\w*|microb\w*|bioengineer\w*|biotechnolog\w*|bioassay\w*|organism\w*|protease\w*|enzyme\w*|biochem\w*|sequenc(?:ing|e alignment|e variants)|fastq|samtools|transcriptom\w*|genetic\w*|biomarker\w*|gbif|biodivers\w*|ecolog\w*|hyphy|datamonkey|ecosystem\w*|yeast|drosophila|zebrafish|phenotyp\w*|taxonom\w*|lipidom\w*|electrophoresis|viral|bacteri\w*|biophys\w*|glyco\w*|actin|myosin|vesicle\w*|antibod\w*|ligand\w*|alloster\w*'),
)
TOPIC_PATTERNS = tuple((topic, re.compile(rf'\b(?:{pattern})\b', re.I)) for topic, pattern in TOPICS)
OLD_TOPICS = {'care': 'Clinical care', 'public health': 'Public health', 'biomedical': 'Biomedical and life sciences',
              'imaging': 'Medical imaging', 'neuroscience': 'Neuroscience', 'disease research': 'Disease research',
              'rehabilitation and accessibility': 'Rehabilitation and accessibility', 'research data': 'Research data'}

GENERIC_EXACT = frozenset(('python-pillow/pillow', 'numpy/numpy', 'pandas-dev/pandas', 'scipy/scipy',
                           'pytorch/pytorch', 'tensorflow/tensorflow', 'scikit-learn/scikit-learn',
                           'matplotlib/matplotlib', 'twbs/bootstrap', 'facebook/react', 'nodejs/node'))
GENERIC_DESCRIPTION = re.compile(
    r'^(?:(?:the|a) )?(?:python imaging library|python data analysis library|a generic (?:library|framework)|'
    r'curated list of awesome (?:python|javascript|html)|collection of (?:awesome|useful) (?:python|javascript|html)|'
    r'collection of summer \d{4} tech internships|javascript library for building user interfaces|'
    r'fundamental package for scientific computing|deep learning framework|'
    r'tensors? and dynamic neural networks|data structures (?:and|&) algorithms|'
    r'collection of papers and books that [\w -]+ lab members should read)\b', re.I)
OFF_SCOPE = re.compile(
    r'\b(?:stock markets?|asset pric(?:e|ing)|buy and hold|trading strateg\w*|'
    r'aws iam|iam security lab|capture the flag|cloud[- ]security challenges?|'
    r'neolithic (?:age|agricultur\w*|expansion)|archaeolog\w*|'
    r'(?:run|running|set up) rstudio (?:on|in)|'
    r'(?:record|capture) (?:generic )?video(?: input)? (?:via|using) ffmpeg)\b', re.I)
LINK_COLLECTION = re.compile(
    r'^(?:(?:a|an) )?(?:list of (?:links|resources)|(?:link|bookmark) collection|'
    r'(?:links|resources|papers)(?: collected)? from (?:the )?(?:internet|web)|'
    r'collection of links|bookmarks for)\b', re.I)
WORKSHOP_LABEL = re.compile(r'^[\w .&-]{0,55}\bworkshop\s*(?:[-:—–]\s*)?(?:[a-z]+\s+)?\d{4}[.!]?$', re.I)
CITATION_TAIL = re.compile(r'\b(?:please cite|citation:|how to cite|bibtex:|cite this (?:work|repository))', re.I)
RESEARCH_CONTEXT = re.compile(
    r'\b(?:analys\w*|research|study|studies|study data|cohort|experimen\w*|'
    r'processing|prediction|simulation|data|models?|pipeline|reproduc\w*|models?|annotation|workflow)\b', re.I)

COURSE = re.compile(
    r'\b(?:(?:class|course|homework|laboratory|lab)\s+assignments?|assignments? (?:for|from) (?:the |my )?'
    r'(?:class|course)|(?:my|student|semester|final class|school|class|course)\s+projects?|'
    r'course\s+(?:materials|exercises|notes|solutions|resources)|coursework|my homework|textbook resources|course:[ ]*[a-z]|'
    r'(?:for|source code (?:repository )?for) (?:the |my |this )?(?:course|class)[ .!]|'
    r'for (?:my|our) (?:capstone course|senior design course)|'
    r'(?:project|assignment|homework)\s+(?:for |of )?(?:cs|cis|cse|dsci|bme|bio|biol|bioe|beng|ece|'
    r'info|biost|mse|chem|stat|math|it|cmpsc|engr|cogs)\s*[- ]?\d{2,4}|'
    r'(?:cs|cis|cse|dsci|bme|bio|biol|bioe|beng|ece|info|biost|mse|chem|stat|math|it|cmpsc|engr|cogs)\s*'
    r'[- ]?\d{2,4}\s+(?:assignment|project|homework|course)|you.ll learn about|this course is designed|classwork)\b',
    re.I)
COURSE_NAME = re.compile(r'(?:homework|hw|assignment|lab|cp|mp)[-_]?\d+|'
                         r'(?:cs|cis|cse|dsci|bme|biol|bioe|beng|ece|info|biost|mse|chem|stat|math|cmpsc|engr|cogs)'
                         r'[-_]?\d{3,4}(?:[-_]?(?:project|hw|lab|final|assignments?)(?:[-_]\d*)?)?', re.I)
PERSONAL = re.compile(r'\b(?:my dotfiles|personal (?:configuration|dotfiles|website|resume|portfolio|blog|vimrc)|'
                      r'(?:bash|vim|emacs|neovim|terminal|zsh|tmux) (?:dotfiles|config(?:uration)? files?)|'
                      r'profile readme|my github (?:profile|readme)|my portfolio|personal homepage)\b', re.I)
PERSONAL_NAME = re.compile(r'\.?dotfiles|\.?vimrc|\.?emacs(?:\.d)?|nvim(?:[-_]?config)?|zsh[-_]?config|'
                           r'homebrew[-_]?bundle|(?:windows|linux)[-_](?:settings|setup)|'
                           r'awesome[-_]dotfiles|(?:my[-_])?(?:resume|cv|portfolio|blog|jekyll|homepage)', re.I)
EMPTY = re.compile(r'^(?:(?:a|my|just|this is (?:a|my))\s+)*(?:test|testing|starter|template|placeholder|'
                   r'demo(?:nstration)?|sample|empty|playground|example)\s*(?:repo(?:sitory)?|project|only)?[ .!]*$', re.I)
NONPURPOSE = re.compile(
    r'^(?:below is a .{0,50}readme|authors?\s*:|co-?authors?\s*:|'
    r'(?:\d+\.\s+)?(?:publication or dataset title|publication title|citation|references?)\s*:|'
    r'(?:url|homepage|website|link|application url)\s*:[ .-]*$|install(?:ation)?\s*:|to (?:install|begin|get started)\b|for more (?:information|details)\b|'
    r'how to (?:install|cite)\b|please (?:cite|refer to)|click here|welcome(?: to .*)?$|'
    r'you can (?:download|find|access)\b|all codes? for the website are here[.!]?$|the (?:u[.]s[.] )?(?:federal )?government declared)', re.I)
OWN_FORK = re.compile(
    r'\b(?:(?:our|my) (?:modified|custom(?:ized)?|adapted|extended|enhanced) (?:fork|version|implementation)|'
    r'(?:modified|customized|adapted|extended) (?:fork|version|implementation) (?:for|with|to support|of)|'
    r'fork of [^.;]{2,120} (?:with (?:new|added|additional|specific|custom|modified)|adapted|extended|modified)\b|'
    r'adapted from [^.;]{2,120} (?:for|with|to support)\b|'
    r'(?:new|additional) (?:methods?|features?|analysis|support|functionality) (?:added|implemented) (?:in|for) this fork)',
    re.I)
MIRROR = re.compile(r'\b(?:(?:read[- ]only|git|github|unofficial|official|backup|automatic(?:ally maintained)?)\s+mirror|'
                    r'mirror(?:ed)? (?:of|from) (?:the |an? )?|upstream mirror|verbatim copy|'
                    r'unmodified (?:fork|copy))\b', re.I)
LINK_OWN = re.compile(r'\b(?:we (?:release|provide|publish|have released) (?:our |the )?(?:source |analysis )?(?:code|software)|'
                      r'(?:our|this study.s|the study.s) (?:source |analysis )?(?:code|software|implementation)|'
                      r'(?:the|all|custom) (?:analysis |modeling |source |software )?(?:code|scripts?) (?:for|used in|used for|supporting) '
                      r'(?:this|the) (?:study|paper|analysis|work|publication)|'
                      r'code (?:generated|developed|written|created) (?:in|for|as part of)|'
                      r'(?:all|the) (?:source |software )?code for the (?:new|proposed)|'
                      r'code to run|custom [a-z-]+(?: [a-z-]+){0,5} (?:code|scripts?) (?:is|are) available)\b', re.I)
SECRET = re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|'
                    r'AKIA[A-Z0-9]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|'
                    r'(?:token|password|api[-_ ]?key|secret)\s*[:=]\s*[A-Za-z0-9_-]{16,})\b|'
                    r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----', re.I)
NATIVE_HEALTH_TITLE = re.compile(r'(?:RNA|DNA)[-_]?(?:seq|methyl|map|genom)|rna[-_]?seq|brain[-_]?age|genom|'
                                r'neuro(?:imaging|signal|physiology)|mri(?:[_-]|\b)', re.I)
RARELY_SPECIFIC = frozenset(('biological', 'biology', 'brain', 'clinical', 'medical', 'treatment', 'stroke',
                             'species', 'organisms', 'pathology', 'infection', 'diagnostic'))

def compact_text(value):
    """Remove markup and URLs while keeping the source's wording."""
    if not isinstance(value, str) or not value.strip() or SECRET.search(value):
        return None
    text = html.unescape(value[:1200])
    text = re.sub(r'<[^>]{1,250}>', ' ', text)
    text = re.sub(r'!?\[([^\]]+)\]\([^)]{1,350}\)', r'\1', text)
    text = re.sub(r'(?i)\bhttps?://[^\s<>]+', ' ', text)
    text = re.sub(r':(?:[a-z][a-z_+-]{2,24}):', ' ', text)
    text = re.sub(r'[`*_~]+', '', text)
    text = ' '.join(text.split()).strip('# ~|>–—')
    if not text or not re.search(r'[A-Za-z\u00C0-\uFFFF]{2}', text) or SECRET.search(text):
        return None
    return text


def short_text(text, max_length=180):
    if len(text) <= max_length:
        return text
    sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text, maxsplit=1)
    if 25 <= len(sentences[0]) <= max_length:
        return sentences[0]
    clip = text[:max_length - 1].rsplit(' ', 1)[0].rstrip(',;:- ')
    return (clip or text[:max_length - 1]) + '…'


def scope_line(text):
    if not text:
        return None
    text = CITATION_TAIL.split(text, maxsplit=1)[0].strip()
    return text if text and not NONPURPOSE.match(text) else None


def scoped_title(text, name, repo):
    text = scope_line(compact_text(text))
    # A saved README heading can state purpose when an opening is just a URL
    # or metadata. Require meaningful wording, not a repository slug.
    if (not text or text.casefold() in (name.casefold(), repo.casefold()) or
            len(text.split()) < 4 or not topic_for(text)):
        return None
    return text


def topic_for(text):
    if not text:
        return None
    return next((topic for topic, pattern in TOPIC_PATTERNS if pattern.search(text)), None)


def readme_sources(raw):
    if not isinstance(raw, str):
        return []
    sources = []
    in_code = False
    for line in raw[:12000].splitlines():
        line = line.strip()
        if line.startswith(('```', '~~~')):
            in_code = not in_code
            continue
        if in_code or len(line) < 22 or line.startswith(('#', '<', '![', '[![', 'http', '|', '>')):
            continue
        sources.append(line)
        if len(sources) >= 20:
            break
    return sources


def canonical_source(followup, name):
    excerpt = followup.get('excerpt')
    if not isinstance(excerpt, str):
        return None
    exact = followup.get('exact_repository_link') or followup.get('exactRepositoryMention') or followup.get('exactRepositoryLink')
    repository_url = re.compile(r'(?i)github\.com/' + re.escape(name) + r'(?:\.git)?(?=$|[\s,/)?#])')
    match = repository_url.search(excerpt)
    if (not exact and not match) or re.search(r'\b(?:dependencies|compared with|baseline tool|was downloaded from)\b',
                                              excerpt, re.I):
        return None
    before = excerpt[:match.start()] if match else excerpt
    if not LINK_OWN.search(before):
        return None
    before = re.sub(r'^(?:.*?\bCode and data availability|.*?\bCode availability|.*?\bData availability)\s+', '',
                    before, flags=re.I)
    before = re.sub(r'\s+(?:(?:is|are|was|were) (?:publicly |freely |openly )?(?:available|published|released)|'
                    r'can be (?:downloaded|found)|has been deposited).*$',
                    '', before, flags=re.I).strip(' :.,(/')
    return before if len(before.split()) >= 4 else None


def substantive_commit(compare):
    commits = compare.get('commits') or {}
    for item in commits.get('nodes') or []:
        heading = item.get('messageHeadline') or ''
        if re.search(r'(?i)^(?:merge|bump|release|update (?:readme|docs?|license|badges?|copyright|citations?)|'
                     r'fix (?:typos?|punctuation|formatting)|(?:add|create) (?:readme|license|badges?|gitignore)|'
                     r'initial commit)', heading.strip()):
            continue
        if heading and (item.get('additions') or item.get('deletions')):
            return True
    return False


def result(purpose=None, topic=None, code=None, reason=None):
    return {'purpose': purpose, 'topic': topic, 'reasonCode': code, 'reason': reason}


def classify(row):
    """Assess one repository and tie every decline to its observed content or identity."""
    name = row['name']
    owner, repo = name.split('/', 1)
    metadata = row.get('metadata') or {}
    native = row.get('native') or {}
    if not isinstance(native, Mapping):
        native = {}
    followup = row.get('followup') or {}
    if not isinstance(followup, Mapping):
        followup = {}

    description = scope_line(compact_text(native.get('description') or metadata.get('description')))
    opening = scope_line(compact_text(row.get('purpose_excerpt')))
    readme = native.get('readme') or row.get('readme')
    readme_lines = [scope_line(compact_text(line)) for line in readme_sources(readme)]
    tied_text = canonical_source(followup, name)
    linked = scope_line(compact_text(row.get('source_purpose') or followup.get('purpose') or tied_text))
    heading = scoped_title(row.get('title'), name, repo)
    options = [text for text in dict.fromkeys([description, opening, *readme_lines, linked, heading])
               if text and not NONPURPOSE.match(text)
               and text.casefold() not in (name.casefold(), repo.casefold())]
    useful = [text for text in options if not EMPTY.fullmatch(text)]
    purpose = short_text(useful[0]) if useful else None

    if native.get('private') is True or native.get('isPrivate') is True or native.get('status') == 404:
        return result(code='not public', reason=f'{name} was unavailable as a public repository.')
    root_text = ' '.join(filter(None, (description, opening, ' '.join(filter(None, readme_lines[:3])))))[:1600]
    sample = short_text(description or opening or repo, 115).rstrip('.!?')

    if native.get('isEmpty') is True:
        return result(code='empty project', reason=f'GitHub identifies {name} as an empty repository.')
    if purpose and WORKSHOP_LABEL.fullmatch(purpose) and not any(topic_for(text) for text in readme_lines if text):
        return result(purpose=purpose, code='no description',
                      reason=f'The saved description for {name} names a workshop but gives no project purpose.')
    if LINK_COLLECTION.match(description or opening or ''):
        return result(purpose=purpose, code='no distinct project work',
                      reason=f'Its description presents {name} as collected links or resources: {sample}.')
    if OFF_SCOPE.search(' '.join(filter(None, (repo.replace('-', ' ').replace('_', ' '), purpose)))):
        # An explicitly different purpose beats health keywords elsewhere in
        # the repository, such as examples or words in the owner name.
        direct = next((text for text in [*readme_lines, linked] if text and topic_for(text)
                       and not OFF_SCOPE.search(text)), None)
        if not direct:
            return result(purpose=purpose, code='no plausible health or life-science purpose',
                          reason=f'Its stated purpose is outside health and life sciences: {sample}.')
        purpose = short_text(direct)
    if name.casefold() in GENERIC_EXACT or GENERIC_DESCRIPTION.match(root_text):
        return result(purpose=purpose, code='general-purpose project',
                      reason=f'Its own description identifies general-purpose work: {sample}.')
    if PERSONAL_NAME.fullmatch(repo) or PERSONAL.search(root_text) or (
            owner.casefold() == repo.casefold() and not topic_for(description or opening)):
        return result(purpose=purpose, code='personal profile or configuration',
                      reason=f'{name} is presented as a personal profile, site or configuration: {sample}.')
    if root_text.casefold().startswith('course:') or COURSE_NAME.fullmatch(repo) or re.match(r'^(?:bmin|epid|pbhl|dsci)[-_]?[0-9]{3,4}(?:[-_]+|$)', repo, re.I) or COURSE.search(root_text):
        return result(purpose=purpose, code='coursework',
                      reason=f'Its repository name or documentation identifies coursework: {sample}.')
    if native.get('isMirror') or (MIRROR.search(root_text) and not OWN_FORK.search(root_text)):
        return result(purpose=purpose, code='mirror or unmodified fork',
                      reason=f'{name} is marked or described as a mirror: {sample}.')

    fork = native.get('fork', native.get('isFork', metadata.get('fork')))
    compare = row.get('comparison') or row.get('compare') or row.get('fork_compare') or native.get('comparison') or {}
    ahead = native.get('ahead_by', native.get('aheadBy', row.get('ahead_by', compare.get('aheadBy'))))
    parent = native.get('parent')
    parent = parent if isinstance(parent, Mapping) else {}
    upstream = parent.get('nameWithOwner') or parent.get('full_name') or 'its upstream'
    branch = (native.get('defaultBranchRef') or {}).get('target') or {}
    upstream_branch = (parent.get('defaultBranchRef') or {}).get('target') or {}
    tree = (branch.get('tree') or {}).get('oid')
    upstream_tree = (upstream_branch.get('tree') or {}).get('oid')
    if fork and (ahead == 0 or compare.get('sameTree') or tree and tree == upstream_tree):
        return result(purpose=purpose, code='mirror or unmodified fork',
                      reason=f'{name} matches {upstream} or has no commits ahead of it.')
    own_work = (row.get('own_work') or native.get('own_work') or native.get('ownWork')
                or OWN_FORK.search(root_text) or tied_text
                or isinstance(ahead, int) and ahead > 0 and substantive_commit(compare))
    if fork and not own_work:
        return result(purpose=purpose, code='fork lacks distinct work',
                      reason=f'{name} is a fork of {upstream}; retained evidence does not identify work of its own.')

    if not purpose:
        if description and EMPTY.fullmatch(description) or opening and EMPTY.fullmatch(opening):
            return result(code='empty project',
                          reason=f'{name} is described as a test or placeholder: {sample}.')
        return result(code='no description', reason=f'No usable description explains the purpose of {name}.')

    qualifier = next((text for text in useful if topic_for(text)), None)
    topic = topic_for(qualifier) or topic_for(repo.replace('_', ' ').replace('-', ' '))
    if not topic and NATIVE_HEALTH_TITLE.search(repo):
        topic = 'Biomedical and life sciences'
    if not topic:
        raw_topics = native.get('topics') or metadata.get('topics') or []
        topic = topic_for(' '.join(str(text).replace('-', ' ') for text in raw_topics))
    if not topic and RESEARCH_CONTEXT.search(purpose):
        signals = row.get('health_signals')
        if isinstance(signals, Mapping):
            for key, signal in signals.items():
                if not isinstance(signal, Mapping):
                    continue
                specific = [str(term).casefold() for term in signal.get('terms', [])
                            if str(term).casefold() not in RARELY_SPECIFIC]
                if specific and (signal.get('where') != 'later README text' or len(specific) >= 2):
                    topic = OLD_TOPICS.get(key)
                    if topic:
                        break
    if not topic and linked:
        clues = followup.get('health_clues') or followup.get('healthClues') or []
        if isinstance(clues, list):
            topic = next((OLD_TOPICS[key] for key in clues if key in OLD_TOPICS), None)
    if not topic:
        return result(purpose=purpose, code='no plausible health or life-science purpose',
                      reason=f'Its retained description does not suggest a health or life-science use: {short_text(purpose, 115).rstrip(".!?")}.')
    if qualifier and purpose != short_text(qualifier) and not topic_for(purpose):
        purpose = short_text(qualifier)
    return result(purpose=purpose, topic=topic)
