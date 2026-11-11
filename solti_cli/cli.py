"""Entry point for the `solti` console script.

Runs the vendored Node.js CLI bundle with the Node runtime on PATH.
"""

import shutil
import subprocess
import sys
from pathlib import Path

VENDOR_SCRIPT = Path(__file__).parent / "vendor" / "cli.cjs"
MIN_NODE_MAJOR = 20


def _node_major_version(node: str) -> int:
    try:
        output = subprocess.run(
            [node, "--version"], capture_output=True, text=True, check=True
        ).stdout.strip()
        return int(output.lstrip("v").split(".", 1)[0])
    except (subprocess.CalledProcessError, ValueError):
        return 0


def main() -> int:
    node = shutil.which("node")
    if node is None:
        print(
            "solti (PyPI package) requires Node.js >= 20 on your PATH.\n"
            "Install Node from https://nodejs.org, or use the Homebrew or npm\n"
            "install of the Solti CLI instead:\n"
            "  brew install trysolti/tap/solti\n"
            "  npm install -g @solti/cli",
            file=sys.stderr,
        )
        return 1
    if _node_major_version(node) < MIN_NODE_MAJOR:
        print(
            f"solti requires Node.js >= {MIN_NODE_MAJOR} "
            f"(found: {node} with an incompatible version).",
            file=sys.stderr,
        )
        return 1
    completed = subprocess.run([node, str(VENDOR_SCRIPT), *sys.argv[1:]])
    return completed.returncode


if __name__ == "__main__":
    sys.exit(main())
