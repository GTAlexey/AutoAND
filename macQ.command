#!/bin/zsh
cd "$(dirname "$0")" || exit 1
npm run dev -- --host 127.0.0.1
