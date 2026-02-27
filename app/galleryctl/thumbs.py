from pathlib import Path
from PIL import Image


def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def image_id_dir(root: Path, image_id: int) -> Path:
    s = f"{image_id:010d}"
    return root / s[0:2] / s[2:4] / s[4:6]


def make_thumb(src: Path, dst: Path, max_width: int, fmt: str) -> None:
    ensure_dir(dst.parent)
    with Image.open(src) as im:
        im = im.convert("RGB")
        w, h = im.size
        new_w = max_width
        new_h = max(1, int(h * (new_w / w)))
        im = im.resize((new_w, new_h), Image.Resampling.LANCZOS)
        im.save(dst, format=fmt.upper())


def make_preview(src: Path, dst: Path, max_edge: int, fmt: str) -> None:
    ensure_dir(dst.parent)
    with Image.open(src) as im:
        im = im.convert("RGB")
        w, h = im.size
        scale = min(1.0, max_edge / max(w, h))
        new_w = max(1, int(w * scale))
        new_h = max(1, int(h * scale))
        im = im.resize((new_w, new_h), Image.Resampling.LANCZOS)
        im.save(dst, format=fmt.upper())
