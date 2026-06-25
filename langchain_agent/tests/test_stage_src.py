"""Integration test for `build-codegraph.py --stage-src`."""
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "build-codegraph.py"


def test_stage_src_copies_indexed_files(tmp_path):
    src = tmp_path / "src_repo"
    (src / "demo_api_server").mkdir(parents=True)
    (src / "demo_api_server" / "a.js").write_text("const a = 1;\n")
    (src / "node_modules").mkdir()
    (src / "node_modules" / "b.js").write_text("ignored\n")
    dest = tmp_path / "staged"

    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(src), "--stage-src", str(dest)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    assert (dest / "demo_api_server" / "a.js").is_file()
    assert not (dest / "node_modules" / "b.js").exists()


def test_stage_src_does_not_nest_into_itself(tmp_path):
    # Staging into a dir INSIDE the scanned root, run twice, must not create a
    # recursive repo-src/.../repo-src copy.
    src = tmp_path / "root"
    (src / "demo_api_server").mkdir(parents=True)
    (src / "demo_api_server" / "a.js").write_text("const a = 1;\n")
    dest = src / "repo-src"
    for _ in range(2):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), str(src), "--stage-src", str(dest)],
            capture_output=True, text=True,
        )
        assert result.returncode == 0, result.stderr
    assert (dest / "demo_api_server" / "a.js").is_file()
    assert not (dest / "repo-src").exists()  # no self-nesting


def test_stage_src_includes_jsx_tsx(tmp_path):
    src = tmp_path / "root"
    (src / "ui").mkdir(parents=True)
    (src / "ui" / "App.jsx").write_text("export default function App(){return null}\n")
    (src / "ui" / "types.tsx").write_text("export const X = 1;\n")
    dest = tmp_path / "staged"
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(src), "--stage-src", str(dest)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    assert (dest / "ui" / "App.jsx").is_file()
    assert (dest / "ui" / "types.tsx").is_file()
