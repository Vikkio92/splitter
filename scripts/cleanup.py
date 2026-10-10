"""Nightly clean-up: delete expired bills and anything left over from deleted ones.

Runs from GitHub Actions with a Firebase service-account key (secret FIREBASE_SERVICE_ACCOUNT),
which can read and write the whole database regardless of the security rules.

The repo is public, so its Actions logs are too: this only ever prints counts, never bill ids
or codes (either would let someone open a bill).

Set DRY_RUN=1 to report what would be deleted without deleting anything.
"""
import json
import os
import time

import requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request

DATABASE_URL = "https://bill-splitter-233a5-default-rtdb.europe-west1.firebasedatabase.app"
SCOPES = ["https://www.googleapis.com/auth/firebase.database", "https://www.googleapis.com/auth/userinfo.email"]


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
    live, delete = set(), {}

    # Bills: keep only those with a valid expiry still in the future.
    for bill_id in get("bills", shallow=True):
        meta = get(f"bills/{bill_id}/meta")
        expires = meta.get("expires") if isinstance(meta, dict) else None
        if isinstance(expires, (int, float)) and expires > now:
            live.add(bill_id)
            continue
        delete[f"bills/{bill_id}"] = None
        delete[f"owners/{bill_id}"] = None
        delete[f"secrets/{bill_id}"] = None
        if isinstance(meta, dict) and isinstance(meta.get("code"), str):
            delete[f"codes/{meta['code']}"] = None
    expired = sum(1 for k in delete if k.startswith("bills/"))

    # Leftovers whose bill no longer exists.
    orphans = 0
    for node in ("owners", "secrets"):
        for bill_id in get(node, shallow=True):
            if bill_id not in live and f"{node}/{bill_id}" not in delete:
                delete[f"{node}/{bill_id}"] = None
                orphans += 1
    for code, bill_id in get("codes").items():
        if bill_id not in live and f"codes/{code}" not in delete:
            delete[f"codes/{code}"] = None
            orphans += 1

    print(f"Live bills: {len(live)}. Expired bills: {expired}. Leftover records: {orphans}.")
    if not delete:
        print("Nothing to delete.")
    elif dry_run:
        print(f"Dry run: would delete {len(delete)} entries.")
    else:
        session.patch(f"{DATABASE_URL}/.json", data=json.dumps(delete), timeout=60).raise_for_status()
        print(f"Deleted {len(delete)} entries.")


if __name__ == "__main__":
    main()
