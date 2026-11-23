"""Run the datasets pipeline stage by stage. Each stage caches to disk and skips finished work.

Usage (from the checkout, Node 24 first on PATH for wrangler):
  TVD_DATASETS_WORK=/workspace/build/builderbob/tvd-datasets-phase1 python3 -I -B scripts/datasets/run.py [stage ...]
Stages: export annotations fulltext classify repos datacite build validate report
"""
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import work_dir

STAGES = [("export", "s1_export.py"), ("annotations", "s2_annotations.py"), ("fulltext", "s3_fulltext.py"),
          ("classify", "s4_classify.py"), ("repos", "s5_repos.py"), ("datacite", "s6_datacite.py"),
          ("build", "build.py"), ("validate", "validate.py"), ("report", "report.py")]


def main():
    want = sys.argv[1:] or [s for s, _ in STAGES]
    w = work_dir()
    rt_path = w / "runtimes.json"
    rt = json.loads(rt_path.read_text()) if rt_path.exists() else {}
    for name, script in STAGES:
        if name not in want:
            continue
        t = time.monotonic()
        print("==", name, flush=True)
        subprocess.run([sys.executable, "-I", "-B", os.path.join(HERE, script)], cwd=os.path.dirname(os.path.dirname(HERE)), check=True)
        rt[name] = round(time.monotonic() - t, 1)
        rt_path.write_text(json.dumps(rt, indent=1))


if __name__ == "__main__":
    main()
