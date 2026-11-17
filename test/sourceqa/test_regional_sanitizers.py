"""Offline regression probes against retained source intakes; no network or source writes."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import re
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'docs/discovery/go-live/evidence/GL05/regional-import-20261117'
SCRIPTS = [ROOT / 'scripts/sanitize-penn-intake.py', ROOT / 'scripts/sanitize-cooper-intake.py']

def load(path):
    spec = importlib.util.spec_from_file_location(path.stem.replace('-', '_'), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def invoke(module, *args):
    with patch.object(sys, 'argv', [str(module.__file__), *map(str, args)]), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        module.main()

def source_hashes(module):
    paths = ([module.SOURCE / f for f in module.FILES] + [module.SOURCE.parent / 'penn-biomedical-github-inventory-20261117-bundle.zip', module.SOURCE.parent / 'penn-biomedical-github-inventory-20261117-bundle.zip.sha256']) if hasattr(module, 'SOURCE') else ([p for d in (module.NETWORK, module.DISCOVERY) for p in d.iterdir() if p.is_file()] + [module.ROOT / 'cooper-research-network-20261117.zip', module.ROOT / 'cooper-research-network-20261117.zip.sha256'])
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}

class SourceQa(unittest.TestCase):
    def test_replay_guards_checksum_and_source_preservation(self):
        for script in SCRIPTS:
            with self.subTest(script=script.name):
                m = load(script)
                before = source_hashes(m)
                invoke(m)
                invoke(m, '--check')
                with self.assertRaises(SystemExit): invoke(m, '--output', '/tmp/invalid-output')
                with self.assertRaises(SystemExit): invoke(m, '--output', EVIDENCE / ('penn' if hasattr(m, 'SOURCE') else 'cooper'))
                with tempfile.TemporaryDirectory(prefix='sourceqa-', dir='/workspace/worktrees/builderbob/thevalleydesk/work') as tmp:
                    os.chmod(tmp, 0o700)
                    out = Path(tmp) / 'new'
                    invoke(m, '--output', out)
                    with self.assertRaises(SystemExit): invoke(m, '--output', out)
                    checksum = (m.SOURCE.parent / 'penn-biomedical-github-inventory-20261117-bundle.zip.sha256') if hasattr(m, 'SOURCE') else (m.ROOT / 'cooper-research-network-20261117.zip.sha256')
                    original_read_text = Path.read_text
                    def wrong_checksum(path, *a, **kw):
                        return '0' * 64 if path == checksum else original_read_text(path, *a, **kw)
                    with patch.object(Path, 'read_text', wrong_checksum):
                        with self.assertRaises(ValueError): invoke(m, '--output', Path(tmp) / 'bad')
                    self.assertFalse((Path(tmp) / 'bad').exists())
                self.assertEqual(before, source_hashes(m))

    def test_forbidden_fields_and_publication_authority(self):
        forbidden = {'abstract', 'articlebody', 'body', 'email', 'contactemail', 'phone', 'signedcommitemail'}
        def visit(value):
            if isinstance(value, dict):
                for key, child in value.items():
                    self.assertNotIn(''.join(c for c in key.lower() if c.isalnum()), forbidden)
                    if key == 'publicationAuthorized': self.assertIs(child, False)
                    visit(child)
            elif isinstance(value, list):
                for child in value: visit(child)
            elif isinstance(value, str):
                self.assertNotRegex(value, r'\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|(?<!\w)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\w)')
        for path in list((EVIDENCE / 'penn').glob('*.json')) + list((EVIDENCE / 'cooper').glob('*.json')):
            with self.subTest(path=path.name): visit(json.loads(path.read_text()))

if __name__ == '__main__': unittest.main()
