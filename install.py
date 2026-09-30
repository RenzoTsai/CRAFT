"""Install the Python and React dependencies and build the web interface."""

import os
import shutil
import subprocess
import sys
import venv
from pathlib import Path


def main():
    if not (3, 11) <= sys.version_info[:2] <= (3, 12):
        raise SystemExit('Run this installer with Python 3.11 or 3.12.')
    npm = shutil.which('npm')
    if not npm:
        raise SystemExit('Install Node.js 20.9 or later before running this installer.')
    root = Path(__file__).resolve().parent
    environment = root / '.venv'
    if not environment.exists():
        venv.EnvBuilder(with_pip=True).create(environment)
    python = environment / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(root / 'requirements.txt')], check=True)
    env = os.environ.copy()
    result = subprocess.run([
        str(python), '-c',
        'import json,sys; from dotenv import dotenv_values; print(json.dumps({k:v for k,v in dotenv_values(sys.argv[1]).items() if v is not None}))',
        str(root / '.env'),
    ], capture_output=True, text=True, check=True)
    import json
    for key, value in json.loads(result.stdout).items():
        env.setdefault(key, value)
    subprocess.run([npm, 'ci', '--no-fund', '--no-audit'], cwd=root / 'frontend', env=env, check=True)
    subprocess.run([npm, 'run', 'build'], cwd=root / 'frontend', env=env, check=True)
    print('\nInstalled. Configure .env, then start with:')
    print(f'  {python} {root / "run.py"}')
    print(f'Open http://127.0.0.1:{env.get("CRAFT_WEB_PORT", "3000")}.')


if __name__ == '__main__':
    main()
