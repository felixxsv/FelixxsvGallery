from __future__ import annotations

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


def extract_top_colors(
    image_path: Path,
    palette: list[PaletteColor],
    settings: ColorExtractSettings,
) -> list[dict[str, Any]]:
    pal = palette[:] if palette else _default_palette()
    pal_rgb = [c.rgb for c in pal]
    pal_id = [c.id for c in pal]

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
            best_i = 0
            best_d2 = _dist2(rgb, pal_rgb[0])
            for i in range(1, len(pal_rgb)):
                d2 = _dist2(rgb, pal_rgb[i])
                if d2 < best_d2:
                    best_d2 = d2
                    best_i = i
            if best_d2 > other_max_d2:
                other_count += 1
                continue
            cid = pal_id[best_i]
            counts[cid] = counts.get(cid, 0) + 1
    else:
        img = img.convert("RGB")
        px = img.getdata()
        for r, g, b in px:
            total += 1
            rgb = (int(r), int(g), int(b))
            best_i = 0
            best_d2 = _dist2(rgb, pal_rgb[0])
            for i in range(1, len(pal_rgb)):
                d2 = _dist2(rgb, pal_rgb[i])
                if d2 < best_d2:
                    best_d2 = d2
                    best_i = i
            if best_d2 > other_max_d2:
                other_count += 1
                continue
            cid = pal_id[best_i]
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
