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
            {"name": "blank_check", "does": "flag empty/solid images in a list of paths", "ready": available("media")},
            {"name": "thumbnail", "does": "smaller JPEG copy (longest side <= max)", "ready": available("media")},
            {"name": "crop", "does": "crop a region given as fractions [l, t, r, b]", "ready": available("media")},
            {"name": "rotate", "does": "tilt an image on white (degrees > 0 = top leans right)", "ready": available("media")},
            {"name": "trim", "does": "crop away white margins around a packshot", "ready": available("media")},
            {"name": "dhash", "does": "perceptual fingerprints to match look-alike images", "ready": available("media")},
            {"name": "layout_guide", "does": "composition-only guide (grey, blurred, flat tones) to use as a layout input", "ready": available("media")},
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


def blank_check(args: dict, out_dir: Path) -> dict:
    """Flags near-empty images (solid black/white/flat crops): tiny brightness spread."""
    Image = _pil()
    from PIL import ImageStat

    out = []
    for p in args.get("paths", []):
        try:
            with Image.open(os.path.expanduser(p)) as im:
                g = im.convert("L")
                g.thumbnail((256, 256))
                st = ImageStat.Stat(g)
                std = st.stddev[0]
                out.append({"path": p, "mean": round(st.mean[0], 1), "stddev": round(std, 2), "blank": std < float(args.get("threshold", 4))})
        except Exception as e:  # unreadable files are reported, not fatal
            out.append({"path": p, "error": str(e)})
    return {"results": out}


def thumbnail(args: dict, out_dir: Path) -> dict:
    """A smaller JPEG copy (longest side <= max, default 1400) for decks and previews."""
    Image = _pil()
    p = _input(args)
    size = int(args.get("max", 1400))
    with Image.open(p) as im:
        im = im.convert("RGB")
        im.thumbnail((size, size))
        dest = out_dir / "thumbnail.jpg"
        im.save(dest, "JPEG", quality=int(args.get("quality", 85)), optimize=True)
    return {"files": [{"path": str(dest)}], "width": im.width, "height": im.height}


def crop(args: dict, out_dir: Path) -> dict:
    """Crops a region given as fractions of the image: box = [left, top, right, bottom], each 0-1."""
    Image = _pil()
    p = _input(args)
    l, t, r, b = (float(v) for v in args["box"])
    with Image.open(p) as im:
        w, h = im.size
        out = im.convert("RGB").crop((round(l * w), round(t * h), round(r * w), round(b * h)))
        dest = out_dir / "crop.png"
        out.save(dest)
    return {"files": [{"path": str(dest)}], "width": out.width, "height": out.height}


def layout_guide(args: dict, out_dir: Path) -> dict:
    """A composition-only guide from a reference image: greyscale, heavily blurred and flattened into a
    few tones, so an image model takes placement, scale and depth from it but no colours, textures or
    surfaces: shapes, positions, tilts and depth stay readable."""
    Image = _pil()
    from PIL import ImageFilter, ImageOps

    p = _input(args)
    with Image.open(p) as im:
        g = im.convert("L")
        w, h = g.size
        g = g.resize((max(1, w // 4), max(1, h // 4)))
        out = g.filter(ImageFilter.GaussianBlur(float(args.get("blur", 2.5))))
        out = ImageOps.posterize(ImageOps.autocontrast(out, cutoff=1).convert("RGB"), int(args.get("bits", 3))).convert("L")
        out = out.resize((w, h))
        dest = out_dir / "layout-guide.png"
        out.save(dest)
    return {"files": [{"path": str(dest), "role": "layout"}], "width": w, "height": h}


def trim(args: dict, out_dir: Path) -> dict:
    """Crops away plain white (or transparent) margins around a packshot, keeping a small border."""
    Image = _pil()
    from PIL import ImageChops

    p = _input(args)
    with Image.open(p) as im:
        rgba = im.convert("RGBA")
        flat = Image.new("RGB", rgba.size, (255, 255, 255))
        flat.paste(rgba, mask=rgba.split()[3])
        diff = ImageChops.difference(flat, Image.new("RGB", flat.size, (255, 255, 255))).convert("L").point(lambda v: 255 if v > int(args.get("tolerance", 12)) else 0)
        box = diff.getbbox()
        if not box:
            box = (0, 0, flat.width, flat.height)
        pad = round(max(box[2] - box[0], box[3] - box[1]) * float(args.get("pad", 0.06)))
        l, t, r, b = max(0, box[0] - pad), max(0, box[1] - pad), min(flat.width, box[2] + pad), min(flat.height, box[3] + pad)
        out = flat.crop((l, t, r, b))
        dest = out_dir / "trimmed.png"
        out.save(dest)
    return {"files": [{"path": str(dest), "role": "product"}], "width": out.width, "height": out.height}


def rotate(args: dict, out_dir: Path) -> dict:
    """Rotates an image on a white background. degrees > 0 tilts clockwise (top leans right)."""
    Image = _pil()
    p = _input(args)
    with Image.open(p) as im:
        out = im.convert("RGB").rotate(-float(args.get("degrees", 15)), expand=True, fillcolor=(255, 255, 255), resample=Image.BICUBIC)
        dest = out_dir / "rotated.png"
        out.save(dest)
    return {"files": [{"path": str(dest), "role": "product"}], "width": out.width, "height": out.height}


def dhash(args: dict, out_dir: Path) -> dict:
    """Perceptual fingerprints (64-bit difference hash, hex) for a list of paths and/or shas.
    Similar-looking images have hashes a few bits apart, whatever their size or compression."""
    Image = _pil()
    out = []
    for item in args.get("items", []):
        p = _input(item)
        with Image.open(p) as im:
            g = im.convert("L").resize((9, 8))
            px = list(g.getdata())
        bits = 0
        for row in range(8):
            for col in range(8):
                bits = (bits << 1) | (1 if px[row * 9 + col] > px[row * 9 + col + 1] else 0)
        out.append({**{k: item[k] for k in ("path", "sha") if item.get(k)}, "hash": f"{bits:016x}"})
    return {"hashes": out}


REGISTRY = {"list": list_tools, "dhash": dhash, "rotate": rotate, "thumbnail": thumbnail, "crop": crop, "layout_guide": layout_guide, "trim": trim, "blank_check": blank_check, "image_info": image_info, "palette": palette, "cutout": cutout}
