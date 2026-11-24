import json
import subprocess
import sys
from pathlib import Path

import pytest

PIL = pytest.importorskip("PIL.Image")


def run(tool, args):
    r = subprocess.run([sys.executable, "-m", "stacked_media", tool], input=json.dumps(args), capture_output=True, text=True)
    return json.loads(r.stdout.strip().splitlines()[-1])


def make(tmp_path: Path) -> Path:
    im = PIL.new("RGB", (40, 20), (200, 30, 30))
    for x in range(20, 40):
        for y in range(20):
            im.putpixel((x, y), (20, 20, 220))
    p = tmp_path / "two.png"
    im.save(p)
    return p


def test_image_info(tmp_path):
    out = run("image_info", {"path": str(make(tmp_path))})
    assert out["width"] == 40 and out["height"] == 20 and out["has_alpha"] is False


def test_palette(tmp_path):
    out = run("palette", {"path": str(make(tmp_path)), "colors": 2})
    hexes = {c["hex"] for c in out["colors"]}
    assert len(hexes) == 2 and abs(sum(c["share"] for c in out["colors"]) - 1) < 0.01


def test_unknown_tool():
    assert "Unknown media tool" in run("nope", {})["error"]


def test_thumbnail_crop_and_layout_guide(tmp_path, monkeypatch):
    src = make(tmp_path)
    monkeypatch.chdir(tmp_path)
    t = run("thumbnail", {"path": str(src), "max": 10})
    assert t["width"] == 10 and t["height"] == 5
    c = run("crop", {"path": str(src), "box": [0.5, 0, 1, 1]})
    assert c["width"] == 20 and c["height"] == 20
    g = run("layout_guide", {"path": str(src)})
    out = PIL.open(g["files"][0]["path"])
    assert out.mode == "L" and out.size == (40, 20)  # greyscale: no colour to copy


def test_rotate_tilts_clockwise(tmp_path):
    out = run("rotate", {"path": str(make(tmp_path)), "degrees": 90})
    assert out["width"] == 20 and out["height"] == 40
