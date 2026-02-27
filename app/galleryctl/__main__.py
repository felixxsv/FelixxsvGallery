import argparse
import sys

from galleryctl.sync_full import run_sync_full
from galleryctl.rebuild_colors import run_rebuild_colors


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="galleryctl")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("sync-full")
    s.add_argument("--config", required=True)
    s.add_argument("--dry-run", action="store_true")
    s.add_argument("--workers", type=int, default=None)

    r = sub.add_parser("rebuild-colors")
    r.add_argument("--config", required=True)
    r.add_argument("--dry-run", action="store_true")
    r.add_argument("--all", action="store_true")
    r.add_argument("--from-id", type=int, default=None)
    r.add_argument("--to-id", type=int, default=None)
    r.add_argument("--limit", type=int, default=None)

    return p


def main(argv: list[str]) -> int:
    p = build_parser()
    args = p.parse_args(argv)

    if args.cmd == "sync-full":
        return run_sync_full(
            config_path=args.config,
            dry_run=bool(args.dry_run),
            workers_override=args.workers,
        )

    if args.cmd == "rebuild-colors":
        return run_rebuild_colors(
            config_path=args.config,
            dry_run=bool(args.dry_run),
            rebuild_all=bool(args.all),
            from_id=args.from_id,
            to_id=args.to_id,
            limit=args.limit,
        )

    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
