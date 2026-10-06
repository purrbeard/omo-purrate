#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "omo 0.0.0-crash (engine: none)"
  exit 0
fi
echo "this is not json"
echo "omo-crash: fatal startup error" >&2
exit 3
