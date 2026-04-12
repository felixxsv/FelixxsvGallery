from __future__ import annotations

import colorsys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image


@dataclass(frozen=True)
class PaletteColor:
    id: int
    name: str
    rgb: tuple[int, int, int]


@dataclass(frozen=True)
class ColorExtractSettings:
    max_dim: int
    other_max_dist: int
    min_ratio: float
    max_colors: int


@dataclass(frozen=True)
class PaletteSample:
    id: int
    name: str
    rgb: tuple[int, int, int]
    hue: float
    saturation: float
    value: float


def _default_palette() -> list[PaletteColor]:
    return [
        PaletteColor(1, "Red", (255, 75, 75)),
        PaletteColor(2, "Orange", (255, 159, 26)),
        PaletteColor(3, "Yellow", (255, 210, 26)),
        PaletteColor(4, "Green", (52, 211, 153)),
        PaletteColor(5, "Cyan", (34, 211, 238)),
        PaletteColor(6, "Blue", (96, 165, 250)),
        PaletteColor(7, "Purple", (167, 139, 250)),
        PaletteColor(8, "Pink", (251, 113, 133)),
        PaletteColor(9, "White", (229, 231, 235)),
        PaletteColor(10, "Black", (17, 24, 39)),
    ]


def load_palette_from_conf(conf: dict[str, Any]) -> list[PaletteColor]:
    colors = conf.get("colors") or {}
    pal = colors.get("palette")
    if not pal:
        return _default_palette()

    out: list[PaletteColor] = []
    for item in pal:
        try:
            cid = int(item["id"])
            name = str(item.get("name") or f"c{cid}")
            rgb = item.get("rgb")
            if not isinstance(rgb, (list, tuple)) or len(rgb) != 3:
                continue
            r = int(rgb[0])
            g = int(rgb[1])
            b = int(rgb[2])
            r = 0 if r < 0 else 255 if r > 255 else r
            g = 0 if g < 0 else 255 if g > 255 else g
            b = 0 if b < 0 else 255 if b > 255 else b
            out.append(PaletteColor(cid, name, (r, g, b)))
        except Exception:
            continue

    if not out:
        return _default_palette()
    return out


def load_settings_from_conf(conf: dict[str, Any]) -> ColorExtractSettings:
    colors = conf.get("colors") or {}
    max_dim = int(colors.get("sample_max_dim") or 320)
    other_max_dist = int(colors.get("other_max_dist") or 170)
    min_ratio = float(colors.get("min_ratio") or 0.08)
    max_colors = int(colors.get("max_colors") or 3)

    if max_dim < 64:
        max_dim = 64
    if max_dim > 1024:
        max_dim = 1024
    if other_max_dist < 0:
        other_max_dist = 0
    if other_max_dist > 441:
        other_max_dist = 441
    if min_ratio < 0:
        min_ratio = 0.0
    if min_ratio > 0.5:
        min_ratio = 0.5
    if max_colors < 1:
        max_colors = 1
    if max_colors > 5:
        max_colors = 5

    return ColorExtractSettings(
        max_dim=max_dim,
        other_max_dist=other_max_dist,
        min_ratio=min_ratio,
        max_colors=max_colors,
    )


def _resize_for_sampling(img: Image.Image, max_dim: int) -> Image.Image:
    w, h = img.size
    m = w if w >= h else h
    if m <= max_dim:
        return img
    scale = max_dim / float(m)
    nw = int(w * scale)
    nh = int(h * scale)
    if nw < 1:
        nw = 1
    if nh < 1:
        nh = 1
    return img.resize((nw, nh), Image.Resampling.BILINEAR)


def _dist2(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    dr = a[0] - b[0]
    dg = a[1] - b[1]
    db = a[2] - b[2]
    return dr * dr + dg * dg + db * db


def _rgb_to_hsv(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    return colorsys.rgb_to_hsv(rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0)


def _palette_samples(palette: list[PaletteColor]) -> list[PaletteSample]:
    out: list[PaletteSample] = []
    for color in palette:
        h, s, v = _rgb_to_hsv(color.rgb)
        out.append(PaletteSample(color.id, color.name.lower(), color.rgb, h, s, v))
    return out


def _find_palette_sample(samples: list[PaletteSample], *names: str) -> PaletteSample | None:
    wanted = {name.casefold() for name in names}
    for sample in samples:
        if sample.name.casefold() in wanted:
            return sample
    return None


def _is_neutral_sample(sample: PaletteSample) -> bool:
    return sample.id in (9, 10) or sample.name.casefold() in {"white", "black"}


def _pick_neutral_color(samples: list[PaletteSample], value: float) -> int | None:
    white = _find_palette_sample(samples, "white") or next(
        (sample for sample in samples if sample.id == 9),
        None,
    )
    black = _find_palette_sample(samples, "black") or next(
        (sample for sample in samples if sample.id == 10),
        None,
    )
    if value >= 0.72 and white is not None:
        return white.id
    if value <= 0.28 and black is not None:
        return black.id
    return None


def _hue_distance(a: float, b: float) -> float:
    diff = abs(a - b)
    return min(diff, 1.0 - diff)


def _color_distance(
    rgb: tuple[int, int, int],
    sample: PaletteSample,
    hue: float,
    saturation: float,
    value: float,
) -> float:
    if _is_neutral_sample(sample):
        return 10.0
    hue_score = _hue_distance(hue, sample.hue) * 5.0
    saturation_score = abs(saturation - sample.saturation) * 0.8
    value_score = abs(value - sample.value) * 0.55
    rgb_score = (_dist2(rgb, sample.rgb) ** 0.5) / 255.0 * 0.2
    return hue_score + saturation_score + value_score + rgb_score


def _classify_pixel(
    rgb: tuple[int, int, int],
    samples: list[PaletteSample],
    other_max_d2: int,
) -> int | None:
    hue, saturation, value = _rgb_to_hsv(rgb)
    if saturation < 0.18:
        return _pick_neutral_color(samples, value)

    best = min(samples, key=lambda sample: _color_distance(rgb, sample, hue, saturation, value))
    if _is_neutral_sample(best):
        return None
    if _dist2(rgb, best.rgb) > other_max_d2 and saturation < 0.28:
        return None
    return best.id


def extract_top_colors(
    image_path: Path,
    palette: list[PaletteColor],
    settings: ColorExtractSettings,
) -> list[dict[str, Any]]:
    pal = palette[:] if palette else _default_palette()
    samples = _palette_samples(pal)

    other_max_d2 = settings.other_max_dist * settings.other_max_dist

    img = Image.open(image_path)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    img = _resize_for_sampling(img, settings.max_dim)

    total = 0
    counts: dict[int, int] = {}
    other_count = 0

    if img.mode == "RGBA":
        px = img.getdata()
        for r, g, b, a in px:
            if a == 0:
                continue
            total += 1
            rgb = (int(r), int(g), int(b))
            cid = _classify_pixel(rgb, samples, other_max_d2)
            if cid is None:
                other_count += 1
                continue
            counts[cid] = counts.get(cid, 0) + 1
    else:
        img = img.convert("RGB")
        px = img.getdata()
        for r, g, b in px:
            total += 1
            rgb = (int(r), int(g), int(b))
            cid = _classify_pixel(rgb, samples, other_max_d2)
            if cid is None:
                other_count += 1
                continue
            counts[cid] = counts.get(cid, 0) + 1

    if total <= 0:
        return []

    items = []
    for cid, c in counts.items():
        items.append((cid, c, c / float(total)))

    items.sort(key=lambda x: x[1], reverse=True)

    kept: list[tuple[int, float]] = []
    for cid, _, ratio in items:
        if ratio >= settings.min_ratio:
            kept.append((cid, ratio))
        if len(kept) >= settings.max_colors:
            break

    if not kept and items:
        kept.append((items[0][0], items[0][2]))

    out: list[dict[str, Any]] = []
    rank = 1
    for cid, ratio in kept[: settings.max_colors]:
        out.append({"rank_no": rank, "color_id": int(cid), "ratio": float(ratio)})
        rank += 1

    return out
