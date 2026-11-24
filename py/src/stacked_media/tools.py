"""The media tools. Add one by writing a function (args, out_dir) -> dict and registering it."""
from __future__ import annotations

import os
from pathlib import Path


class MissingExtra(Exception):
    def __init__(self, msg: str, extra: str):
        super().__init__(msg)
        self.fix = f"./setup.sh --with-media   (this tool also needs: uv sync --project py --extra {extra})"


def _pil():
    try:
        from PIL import Image  # noqa: F401
        return Image
    except ImportError as e:
        raise MissingExtra("This tool needs Pillow.", "media") from e


def _input(args: dict) -> Path:
    """An input is a path, or a sha in the studio's media cache."""
    if args.get("path"):
        p = Path(os.path.expanduser(args["path"]))
    elif args.get("sha"):
        sha = args["sha"]
        d = Path(os.environ.get("STACKED_MEDIA_DIR", "")) / sha[:2]
        hits = sorted(d.glob(sha + ".*")) if d.exists() else []
        if not hits:
            raise FileNotFoundError(f"{sha[:12]}… is not in the media cache")
        p = hits[0]
    else:
        raise ValueError("Pass 'path' or 'sha'.")
    if not p.exists():
        raise FileNotFoundError(str(p))
    return p


def list_tools(args: dict, out_dir: Path) -> dict:
    def available(extra: str) -> bool:
        try:
            if extra == "media":
                import PIL  # noqa: F401
            elif extra == "cutout":
                import rembg  # noqa: F401
            return True
        except ImportError:
            return False

    return {
        "tools": [
            {"name": "image_info", "does": "size, mode, format, transparency", "ready": available("media")},
            {"name": "palette", "does": "dominant colours as hex with shares", "ready": available("media")},
            {"name": "cutout", "does": "remove the background, transparent PNG", "ready": available("cutout")},
        ]
    }


def image_info(args: dict, out_dir: Path) -> dict:
    Image = _pil()
    p = _input(args)
    with Image.open(p) as im:
        return {"width": im.width, "height": im.height, "mode": im.mode, "format": im.format, "has_alpha": "A" in im.getbands()}


def palette(args: dict, out_dir: Path) -> dict:
    Image = _pil()
    p = _input(args)
    k = int(args.get("colors", 6))
    with Image.open(p) as im:
        im = im.convert("RGB")
        im.thumbnail((256, 256))
        q = im.quantize(colors=k, method=Image.Quantize.MEDIANCUT)
        pal = q.getpalette()[: k * 3]
        counts = sorted(q.getcolors(), reverse=True)
        total = sum(c for c, _ in counts) or 1
        out = []
        for count, idx in counts:
            r, g, b = pal[idx * 3 : idx * 3 + 3]
            out.append({"hex": f"#{r:02X}{g:02X}{b:02X}", "share": round(count / total, 3)})
    return {"colors": out}


def cutout(args: dict, out_dir: Path) -> dict:
    Image = _pil()
    try:
        from rembg import remove
    except ImportError as e:
        raise MissingExtra("Cutouts need rembg.", "cutout") from e
    p = _input(args)
    with Image.open(p) as im:
        res = remove(im.convert("RGBA"))
        if args.get("trim", True):
            bbox = res.getbbox()
            if bbox:
                res = res.crop(bbox)
        dest = out_dir / "cutout.png"
        res.save(dest)
    return {"files": [{"path": str(dest), "role": "product"}], "width": res.width, "height": res.height}


REGISTRY = {"list": list_tools, "image_info": image_info, "palette": palette, "cutout": cutout}
