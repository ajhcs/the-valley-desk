import { execFileSync } from 'node:child_process';
const python = 'node_modules/.policy-pdf/bin/python';
const mode = process.argv[2];
if (mode === 'bootstrap') {
  execFileSync('python3',['-m','venv','node_modules/.policy-pdf'],{stdio:'inherit'});
  execFileSync(python,['-m','pip','install','--disable-pip-version-check','--no-cache-dir','--only-binary=:all:','--require-hashes','-r','scripts/requirements-policy-pdf.txt'],{stdio:'inherit'});
} else if (mode === 'test') {
  execFileSync(python,['-m','unittest','discover','-s','test','-p','policy_pdf_test.py'],{stdio:'inherit',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
} else throw Error('Expected bootstrap or test');
