"""Run a throwaway PostgreSQL from a pip wheel, migrate it, and run a command against it.

For machines with no Docker and no system Postgres, which is most locked-down work laptops. The
server is a real PostgreSQL binary shipped inside the `pgserver` wheel; it listens on a unix socket
in the data directory and stops when this process exits.

    .venv/bin/pip install -e ".[dev,localdb]"
    .venv/bin/python scripts/devdb.py pytest -q          # the whole suite, database tests included
    .venv/bin/python scripts/devdb.py uvicorn app.main:app --port 8000
    .venv/bin/python scripts/devdb.py                     # just print the settings and wait

Everything lives under --data-dir (default /tmp/vd-devdb); delete it to start clean.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

DB_NAME = "voicedukan"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="/tmp/vd-devdb")
    ap.add_argument("command", nargs=argparse.REMAINDER,
                    help="command to run with DATABASE_URL set; omit to just hold the server open")
    args = ap.parse_args()

    try:
        import pgserver
    except ImportError:
        print('pgserver is missing. Install it with:  .venv/bin/pip install -e ".[dev,localdb]"',
              file=sys.stderr)
        return 2

    data_dir = Path(args.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    server = pgserver.get_server(str(data_dir))
    try:
        server.psql(f"create database {DB_NAME};")
    except Exception:  # noqa: BLE001
        pass  # already there

    socket_dir = str(data_dir.resolve())
    env = os.environ | {
        # asyncpg reads PGHOST for the socket; the URL itself carries no host on purpose, because
        # config.py strips query parameters it does not recognise.
        "DATABASE_URL": f"postgresql+asyncpg://postgres@/{DB_NAME}",
        "PGHOST": socket_dir,
        "PGUSER": "postgres",
        "APP_SECRET": os.environ.get("APP_SECRET") or "dev-only-secret",
        # A Secure cookie is refused over plain http from a LAN address. localhost is exempt.
        "COOKIE_SECURE": os.environ.get("COOKIE_SECURE", "true"),
    }
    here = Path(__file__).resolve().parents[1]
    venv_bin = here / ".venv" / "bin"

    print(f"postgres socket : {socket_dir}")
    print(f"DATABASE_URL    : {env['DATABASE_URL']}  (PGHOST={socket_dir})")
    subprocess.run([str(venv_bin / "alembic"), "upgrade", "head"], env=env, cwd=here, check=True)

    if not args.command:
        print("\nServer is up. Press Ctrl-C to stop it.")
        try:
            import time

            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            return 0

    cmd = args.command
    exe = venv_bin / cmd[0]
    if exe.exists():
        cmd = [str(exe), *cmd[1:]]
    return subprocess.run(cmd, env=env, cwd=here).returncode


if __name__ == "__main__":
    raise SystemExit(main())
