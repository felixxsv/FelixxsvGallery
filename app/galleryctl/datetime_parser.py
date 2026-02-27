from dataclasses import dataclass
from datetime import datetime
import re


@dataclass(frozen=True)
class ParsedShotAt:
    shot_at: datetime


_VRCHAT_RE = re.compile(r"^VRChat_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:\.\d+)?_")


def parse_vrchat_shot_at_from_filename(name: str) -> ParsedShotAt | None:
    m = _VRCHAT_RE.match(name)
    if not m:
        return None
    y, mo, d, hh, mm, ss = map(int, m.groups())
    return ParsedShotAt(shot_at=datetime(y, mo, d, hh, mm, ss))
