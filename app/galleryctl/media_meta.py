from dataclasses import dataclass
from pathlib import Path
from PIL import Image


@dataclass(frozen=True)
class ImageMeta:
    width: int
    height: int
    format: str


def read_image_meta(path: Path) -> ImageMeta:
    with Image.open(path) as im:
        w, h = im.size
        fmt = (im.format or path.suffix.lstrip(".")).lower()
        return ImageMeta(width=int(w), height=int(h), format=str(fmt))
