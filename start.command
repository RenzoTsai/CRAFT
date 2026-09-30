#!/bin/zsh
set -e
cd "${0:A:h}"
if [[ ! -x .venv/bin/python ]]; then
  print "Run python3.11 install.py first."
  exit 1
fi
exec .venv/bin/python run.py
