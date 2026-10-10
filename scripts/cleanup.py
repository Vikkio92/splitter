"""Nightly clean-up: delete expired bills and anything left over from deleted ones.

Runs from GitHub Actions with a Firebase service-account key (secret FIREBASE_SERVICE_ACCOUNT),
which can read and write the whole database regardless of the security rules.

The repo is public, so its Actions logs are too: this only ever prints counts, never bill ids,
join codes or error details (an error message can contain a URL with a bill id in it).
Keys in the database can be written by anyone within the rules, so they are never put into
URLs unless they look like a real bill id; anything else is deleted via the request body.

Set DRY_RUN=1 to report what would be deleted without deleting anything.

If there are more live bills than MAX_LIVE_BILLS (default 200), or more junk than MAX_JUNK
(default 2000), the run fails on purpose after cleaning up, so GitHub emails the repo owner
about possible spam.
"""
import json
import os
import re
import sys
import time

import requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request

DATABASE_URL = "https://bill-splitter-233a5-default-rtdb.europe-west1.firebasedatabase.app"
SCOPES = ["https://www.googleapis.com/auth/firebase.database", "https://www.googleapis.com/auth/userinfo.email"]
BILL_ID = re.compile(r"^[a-z0-9]{16,32}$")
BATCH = 500


def main():
    creds = service_account.Credentials.from_service_account_info(
        json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT"]), scopes=SCOPES)
    creds.refresh(Request())
    session = requests.Session()
    session.headers["Authorization"] = "Bearer " + creds.token
    dry_run = os.environ.get("DRY_RUN") == "1"

    def get(path, shallow=False):
        r = session.get(f"{DATABASE_URL}/{path}.json", params={"shallow": "true"} if shallow else None, timeout=30)
        r.raise_for_status()
        return r.json() or {}

    now = int(time.time() * 1000)
    live, delete, read_errors = set(), {}, 0

    # Bills: keep only real bill ids with a valid expiry still in the future.
    for bill_id in get("bills", shallow=True):
        if not BILL_ID.match(bill_id):
            delete[f"bills/{bill_id}"] = None   # junk key: never put it in a URL
            continue
        try:
            meta = get(f"bills/{bill_id}/meta")
        except Exception:
            read_errors += 1
            live.add(bill_id)   # can't tell, so leave it (and its records) alone tonight
            continue
        expires = meta.get("expires") if isinstance(meta, dict) else None
        if isinstance(expires, (int, float)) and expires > now:
            live.add(bill_id)
        else:
            delete[f"bills/{bill_id}"] = None
    expired = len(delete)

    # Leftovers whose bill isn't live. Codes are judged by where they point, not by the bill's meta,
    # so a bill can't get someone else's code deleted.
    for node in ("owners", "secrets"):
        for bill_id in get(node, shallow=True):
            if bill_id not in live:
                delete[f"{node}/{bill_id}"] = None
    for code, bill_id in get("codes").items():
        if bill_id not in live:
            delete[f"codes/{code}"] = None
    leftovers = len(delete) - expired

    print(f"Live bills: {len(live)}. Expired or junk bills: {expired}. Leftover records: {leftovers}."
          + (f" Bills that couldn't be read: {read_errors}." if read_errors else ""))
    if not delete:
        print("Nothing to delete.")
    elif dry_run:
        print(f"Dry run: would delete {len(delete)} entries.")
    else:
        paths = list(delete)
        for i in range(0, len(paths), BATCH):
            chunk = {p: None for p in paths[i:i + BATCH]}
            session.patch(f"{DATABASE_URL}/.json", data=json.dumps(chunk), timeout=60).raise_for_status()
        print(f"Deleted {len(delete)} entries.")

    if len(live) > int(os.environ.get("MAX_LIVE_BILLS", "200")) or len(delete) > int(os.environ.get("MAX_JUNK", "2000")):
        print("ALERT: far more bills or junk than normal. Someone may be spamming the database.")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        # Never print the message or traceback: they can contain URLs with bill ids.
        print(f"Clean-up failed ({type(e).__name__}).")
        sys.exit(1)
