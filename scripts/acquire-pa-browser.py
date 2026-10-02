#!/usr/bin/env python3
"""Disabled by default; enabled execution belongs on the preflighted existing client."""
import json
import sys

if __name__ == '__main__':
    if '--enable-one-shot' not in sys.argv[1:]:
        print(json.dumps({'outcome': 'disabled', 'fetchingEnabled': False, 'schedulingEnabled': False}))
        sys.exit(0)
    # No runtime/network imports or preflight/credential reads on the disabled path.
    from pa_browser.live import cli
    cli(sys.argv[1:])
