import argparse
import sys

from galleryctl.integrity_check import run_integrity_check, run_integrity_dispatch
from galleryctl.sync_full import run_sync_full
from galleryctl.rebuild_colors import run_rebuild_colors
from galleryctl.rebuild_contents import run_rebuild_contents
from galleryctl.wipe_gallery import run_wipe_gallery


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

    rc = sub.add_parser("rebuild-contents")
    rc.add_argument("--config", required=True)
    rc.add_argument("--dry-run", action="store_true")
    rc.add_argument("--all", action="store_true")
    rc.add_argument("--from-id", type=int, default=None)
    rc.add_argument("--to-id", type=int, default=None)
    rc.add_argument("--limit", type=int, default=None)

    ic = sub.add_parser("integrity-check")
    ic.add_argument("--config", required=True)
    ic.add_argument("--run-id", type=int, default=None)
    ic.add_argument("--quiet", action="store_true")

    disp = sub.add_parser("integrity-dispatch")
    disp.add_argument("--config", required=True)
    disp.add_argument("--max-runs", type=int, default=1)

    wipe = sub.add_parser("wipe-gallery")
    wipe.add_argument("--config", required=True)
    wipe.add_argument("--dry-run", action="store_true")
    wipe.add_argument("--delete-storage", action="store_true")
    wipe.add_argument("--delete-source", action="store_true")
    wipe.add_argument("--delete-tags", action="store_true")

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

    if args.cmd == "rebuild-contents":
        return run_rebuild_contents(
            config_path=args.config,
            dry_run=bool(args.dry_run),
            rebuild_all=bool(args.all),
            from_id=args.from_id,
            to_id=args.to_id,
            limit=args.limit,
        )

    if args.cmd == "integrity-check":
        return run_integrity_check(
            config_path=args.config,
            run_id=args.run_id,
            print_summary=not bool(args.quiet),
        )

    if args.cmd == "integrity-dispatch":
        return run_integrity_dispatch(
            config_path=args.config,
            max_runs=max(1, int(args.max_runs or 1)),
        )

    if args.cmd == "wipe-gallery":
        return run_wipe_gallery(
            config_path=args.config,
            dry_run=bool(args.dry_run),
            delete_storage=bool(args.delete_storage),
            delete_source=bool(args.delete_source),
            delete_tags=bool(args.delete_tags),
        )

    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
