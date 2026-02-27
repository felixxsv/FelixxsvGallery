from dataclasses import dataclass
from pathlib import Path
import os


@dataclass(frozen=True)
class FileEntry:
    abs_path: Path
    rel_path: str
    size_bytes: int
    mtime_epoch: int


def scan_recursive(source_root: Path, extensions: list[str]) -> list[FileEntry]:
    ext_set = set(e.lower() for e in extensions)
    out: list[FileEntry] = []

    for root, _, files in os.walk(source_root):
        for name in files:
            p = Path(root) / name
            if p.suffix.lower() not in ext_set:
                continue
            st = p.stat()
            rel = str(p.relative_to(source_root)).replace("\\", "/")
            out.append(
                FileEntry(
                    abs_path=p,
                    rel_path=rel,
                    size_bytes=int(st.st_size),
                    mtime_epoch=int(st.st_mtime),
                )
            )

    out.sort(key=lambda x: x.rel_path)
    return out
