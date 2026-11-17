"""Focused offline intake and boundary checks."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts/sanitize-villanova-intake.py'
SOURCE=Path('/workspace/worktrees/builderbob/thevalleydesk/work/villanova-health-github-research-20261116/README.md')
def run(*args): return subprocess.run(['python3',str(SCRIPT),*map(str,args)],capture_output=True,text=True)

class VillanovaIntakeTest(unittest.TestCase):
    def test_replay_and_isolated_output(self):
        before=SOURCE.read_bytes()
        self.assertEqual(run('--check').returncode,0)
        with tempfile.TemporaryDirectory(dir=ROOT,prefix='villanova-intake-test-') as temp:
            base=Path(temp);out=base/'new'
            self.assertEqual(run('--output',out).returncode,0)
            self.assertNotEqual(run('--output',out).returncode,0)
            data=json.loads((out/'source-assertions.json').read_text())
            self.assertEqual((data['coverage']['accounts'],data['coverage']['repositoryPaths']),(17,66))
            self.assertEqual(len(data['externalResources']),2)
            self.assertTrue(all(not x['publicationAuthorized'] for group in ('accounts','projects','externalResources') for x in data[group]))
            self.assertIn('fork',next(x['reportedRelationship'] for x in data['projects'] if x['id']=='optical-brain-imaging-lab/fnirs'))
            self.assertIn('official move',next(x['reportedRelationship'] for x in data['projects'] if x['id']=='climate-cafe/niehs-ehlc_data_harmonization'))
            self.assertNotEqual(run('--output',base/'..'/'bad').returncode,0)
            (base/'link').symlink_to(out,target_is_directory=True)
            self.assertNotEqual(run('--output',base/'link'/'new').returncode,0)
        self.assertEqual(SOURCE.read_bytes(),before)

if __name__=='__main__': unittest.main()
