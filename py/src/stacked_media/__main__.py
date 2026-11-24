"""Entry point: `python -m stacked_media <tool>` with JSON on stdin, JSON on stdout.

Tools only read and write local files. They never call model APIs and never write into the
studio's media cache directly: they return file paths under "files", and Node stores them.
"""
import json
import sys
import tempfile
from pathlib import Path

from . import tools


def main() -> int:
    name = sys.argv[1] if len(sys.argv) > 1 else "list"
    raw = sys.stdin.read() or "{}"
    try:
        args = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Bad JSON input: {e}"}))
        return 1
    fn = tools.REGISTRY.get(name)
    if not fn:
        print(json.dumps({"error": f"Unknown media tool '{name}'. Known: {', '.join(sorted(tools.REGISTRY))}"}))
        return 1
    try:
        out_dir = Path(tempfile.mkdtemp(prefix="stacked-media-"))
        result = fn(args, out_dir)
    except tools.MissingExtra as e:
        print(json.dumps({"error": str(e), "fix": e.fix}))
        return 1
    except Exception as e:  # report, never crash with a traceback on stdout
        print(json.dumps({"error": f"{type(e).__name__}: {e}"}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
