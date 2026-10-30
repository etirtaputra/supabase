#!/usr/bin/env python3
"""drive_order_folder — find the ONE order folder, and refuse a duplicate before it is made.

Companion script to PURCHASING-SYNC-RUNBOOK §11.5 (ICAPROC agent packs). The
runbook is the rule; this script is how the rule is checked. Installed in an
agent's skill as `scripts/drive_order_folder.py` (the repo and Drive copy carry
the version in the name: drive_order_folder_v<N>_<date>.py).

WHY IT EXISTS (EPSIVO PIO-016-ISL-09-2026, Sep–Oct 2026): the agent filed the
PO, an invoice and slips into its own price-list folder, while the person had
already opened the real order folder named by PI. Same files in two folders for
five weeks. Four causes, each closed here:
  1. one link (ICAPROC document_url) was trusted as the only order folder
     -> find lists EVERY folder of the supplier, and adds the linked ones;
  2. a quote folder became the order folder
     -> a folder that holds a file naming the PI or PO counts as a candidate;
  3. "PIO/016" never matched "PIO-016-ISL-09-2026"
     -> numbers are matched in all their written forms (runbook §2);
  4. the md5 check ran after the upload, in one folder
     -> it runs BEFORE, across the supplier's whole tree.

Commands (JSON on stdout; exit 0 = go on, 2 = STOP AND ASK ERIC, 1 = error):
  find      --supplier-folder ID [--pi X] [--po X] [--invoice X] [--term X] [--link URL]
  existing  --supplier-folder ID FILE [FILE ...]
  upload    --supplier-folder ID --target ID --name NAME FILE  (+ the find options)
            [--accounting-copy] [--dry-run]

Everything is read-only except `upload` without --dry-run. Credentials: the
service-account file in $GDRIVE_SA_FILE, else /opt/data/.hermes/credentials/gdrive.json.
Nothing from it is ever printed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from typing import Iterable, Optional

VERSION = "v1_2026-10-30"
DEFAULT_SA_FILE = "/opt/data/.hermes/credentials/gdrive.json"
FOLDER_MIME = "application/vnd.google-apps.folder"
FIELDS = "id,name,mimeType,md5Checksum,size,createdTime,modifiedTime,webViewLink,parents,trashed"
MAX_DEPTH = 6

EXIT_OK, EXIT_ERROR, EXIT_STOP = 0, 1, 2


# --------------------------------------------------------------------------- names

def norm(text: str) -> str:
    """Upper case, every run of non-letters/digits to ONE space. 'PIO/016' -> 'PIO 016'."""
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", text.upper()).split())


def compact(text: str) -> str:
    """Upper case, letters and digits only. 'PI-2026092101' -> 'PI2026092101'."""
    return re.sub(r"[^A-Z0-9]+", "", text.upper())


_ISL_STYLE = re.compile(r"^([A-Z]+)\s?0*(\d{1,4})\s([A-Z]{2,4})\s(\d{1,2})\s(\d{4})$")
_YEAR_STYLE = re.compile(r"^([A-Z]+)\s?(20\d{2})\s?0*(\d{1,4})$")


def number_patterns(kind: str, value: str) -> list[re.Pattern]:
    """Every written form of one PI / PO / invoice number, as patterns on norm(name).

    Runbook §2: `PIO-016-ISL-09-2026` is also written `PIO/016`, `PIO-016`,
    `PIO 016`. `PIO-2026016` is a DIFFERENT order (the other numbering scheme)
    and must never match it.
    """
    n = norm(value)
    if not n:
        return []
    pats = [re.compile(r"(?<![A-Z0-9])" + re.escape(n).replace(r"\ ", r"\s?") + r"(?![A-Z0-9])")]
    if kind == "po":
        m = _ISL_STYLE.match(n)
        if m:  # PIO-016-ISL-09-2026 -> PIO 016 / PIO016, not followed by another digit
            prefix, seq = m.group(1), int(m.group(2))
            pats.append(re.compile(rf"(?<![A-Z0-9]){prefix}\s?0*{seq}(?![0-9])"))
        m = _YEAR_STYLE.match(n)
        if m:  # PIO-2026016 -> PIO 2026016 / PIO 2026 016
            prefix, year, seq = m.group(1), m.group(2), int(m.group(3))
            pats.append(re.compile(rf"(?<![A-Z0-9]){prefix}\s?{year}\s?0*{seq}(?![0-9])"))
    if kind == "pi":
        m = re.match(r"^[A-Z]{1,4}\s?(\d{8,})$", n)
        if m:  # PI-2026092101 is also written 2026092101
            pats.append(re.compile(rf"(?<![0-9]){m.group(1)}(?![0-9])"))
    return pats


def term_matches(term: str, name: str) -> bool:
    """An item model or free term: letters and digits only, contained. 'EPV300-4T7.5G' in '... EPV300-4T7.5G]'."""
    t = compact(term)
    return len(t) >= 4 and t in compact(name)


# Thousands-grouped numbers and currency + number are amounts; dates (2026-09-21),
# PI numbers (2026092101) and model sizes (7.5G) are not.
_AMOUNT = re.compile(
    r"(?:(?<![A-Za-z])(?:IDR|USD|RP|CNY|RMB|EUR|SGD)[\s_]?\d[\d.,]{3,})"
    r"|(?:(?<![\d-])\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?(?![\d-]))",
    re.IGNORECASE,
)


def name_problems(name: str) -> list[str]:
    """Runbook §11.1 checks that a script can make. A person still judges the rest."""
    problems = []
    if _AMOUNT.search(name):
        problems.append("the name holds an amount; names reach Basecamp, which never shows amounts (§10, §11.1)")
    if not re.match(r"^\d+[a-z]?\.(?:[a-z]\.)? \S", name):
        problems.append("the name does not start with its number, e.g. '9. ' or '2b. ' (§11.1)")
    if not re.search(r"\.[A-Za-z0-9]{2,5}$", name):
        problems.append("the name has no file extension (§11.2)")
    if re.search(r"_\d{8}(?:\D|$)", name):
        problems.append("a date without hyphens; write YYYY-MM-DD (§11.2)")
    return problems


def folder_id_from(link: str) -> str:
    """A Drive id from a folder or file link, or the id itself."""
    for pat in (r"/folders/([A-Za-z0-9_-]{10,})", r"/d/([A-Za-z0-9_-]{10,})", r"[?&]id=([A-Za-z0-9_-]{10,})"):
        m = re.search(pat, link)
        if m:
            return m.group(1)
    return link.strip()


def md5_of(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# --------------------------------------------------------------------------- Drive

def drive_service():
    """The Drive v3 client from the service-account file. The key never leaves this function."""
    from google.oauth2 import service_account  # imported here so the pure parts test without Google libs
    from googleapiclient.discovery import build

    sa_file = os.environ.get("GDRIVE_SA_FILE", DEFAULT_SA_FILE)
    creds = service_account.Credentials.from_service_account_file(
        sa_file, scopes=["https://www.googleapis.com/auth/drive"])
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def list_children(service, folder_id: str) -> list[dict]:
    out, token = [], None
    while True:
        resp = service.files().list(
            q=f"'{folder_id}' in parents and trashed = false",
            fields=f"nextPageToken, files({FIELDS})",
            supportsAllDrives=True, includeItemsFromAllDrives=True,
            pageSize=1000, pageToken=token,
        ).execute()
        out.extend(resp.get("files", []))
        token = resp.get("nextPageToken")
        if not token:
            return out


def walk(service, folder_id: str, path: str = "", depth: int = 0) -> list[dict]:
    """Every file and folder under folder_id, each with its path below it."""
    items = []
    for f in list_children(service, folder_id):
        f = dict(f, path=f"{path}/{f['name']}" if path else f["name"])
        items.append(f)
        if f["mimeType"] == FOLDER_MIME and depth < MAX_DEPTH:
            items.extend(walk(service, f["id"], f["path"], depth + 1))
    return items


def get_file(service, file_id: str) -> Optional[dict]:
    try:
        return service.files().get(fileId=file_id, fields=FIELDS, supportsAllDrives=True).execute()
    except Exception:  # noqa: BLE001 — a dead link is a finding, not a crash
        return None


# --------------------------------------------------------------------------- the checks

def find_order_folders(service, supplier_folder_id: str, pis: Iterable[str] = (), pos: Iterable[str] = (),
                       invoices: Iterable[str] = (), terms: Iterable[str] = (), links: Iterable[str] = ()) -> dict:
    """Every folder that may be THIS order's folder, newest first.

    `candidates` (strong): the folder's name, or the name of a file inside it,
    carries the PI, the PO or an invoice number — or ICAPROC links to it
    (pass every document_url: the PO's AND the quote's). More than one
    candidate means two folders for one order: stop and ask.
    `related` (weak): only an item model or a free term matches. Repeat orders
    of the same model are normal, so these never stop the run; read them.
    """
    pats = ([("PI", p, pat) for p in pis for pat in number_patterns("pi", p)]
            + [("PO", p, pat) for p in pos for pat in number_patterns("po", p)]
            + [("invoice", p, pat) for p in invoices for pat in number_patterns("invoice", p)])
    tree = walk(service, supplier_folder_id)
    top = [f for f in tree if f["mimeType"] == FOLDER_MIME and "/" not in f["path"]]

    def hits(name: str) -> list[str]:
        n = norm(name)
        return sorted({f"{kind} {value}" for kind, value, pat in pats if pat.search(n)})

    candidates, related = {}, {}
    for folder in top:
        reasons = [f"folder name: {h}" for h in hits(folder["name"])]
        for f in tree:
            if f["path"].startswith(folder["name"] + "/"):
                reasons += [f"holds '{f['path']}': {h}" for h in hits(f["name"])]
        if reasons:
            candidates[folder["id"]] = {"folder": folder, "why": reasons}
            continue
        weak = [t for t in terms if term_matches(t, folder["name"])]
        if weak:
            related[folder["id"]] = {"folder": folder, "why": [f"folder name: term {t}" for t in weak]}

    warnings = []
    for link in links:
        fid = folder_id_from(link)
        item = get_file(service, fid)
        if item is None:
            warnings.append(f"ICAPROC link {link} does not open for this account")
            continue
        if item.get("trashed"):
            warnings.append(f"ICAPROC link {link} points to '{item['name']}', which is in the TRASH — fix that document_url")
            continue
        if item["mimeType"] != FOLDER_MIME:  # a link to a file: its folder is the candidate
            parent = (item.get("parents") or [None])[0]
            item = get_file(service, parent) if parent else None
            if item is None:
                warnings.append(f"ICAPROC link {link} points to a file whose folder does not open")
                continue
        entry = candidates.setdefault(item["id"], {"folder": dict(item, path=item["name"]), "why": []})
        entry["why"].append(f"ICAPROC document_url links here ({link})")
        related.pop(item["id"], None)
        if supplier_folder_id not in (item.get("parents") or []) and not any(
                f["id"] == item["id"] for f in top):
            warnings.append(f"'{item['name']}' is linked from ICAPROC but is NOT a folder of this supplier")

    def shape(entries: dict) -> list[dict]:
        rows = [{"id": e["folder"]["id"], "name": e["folder"]["name"],
                 "created": e["folder"].get("createdTime"), "link": e["folder"].get("webViewLink"),
                 "why": e["why"]} for e in entries.values()]
        return sorted(rows, key=lambda r: r["created"] or "", reverse=True)

    return {"candidates": shape(candidates), "related": shape(related), "warnings": warnings,
            "folders_searched": len(top)}


def find_existing(service, scope_folder_id: str, local_paths: Iterable[str], tree: Optional[list] = None) -> dict:
    """Each local file's md5 against EVERY file under scope_folder_id (all subfolders)."""
    tree = walk(service, scope_folder_id) if tree is None else tree
    by_md5: dict[str, list[dict]] = {}
    for f in tree:
        if f.get("md5Checksum"):
            by_md5.setdefault(f["md5Checksum"], []).append(f)
    result = {}
    for p in local_paths:
        digest = md5_of(p)
        result[p] = {"md5": digest, "matches": [
            {"path": f["path"], "id": f["id"], "link": f.get("webViewLink")} for f in by_md5.get(digest, [])]}
    unchecked = sum(1 for f in tree if f["mimeType"].startswith("application/vnd.google-apps.")
                    and f["mimeType"] != FOLDER_MIME)
    return {"files": result, "drive_files_compared": sum(len(v) for v in by_md5.values()),
            "google_docs_not_compared": unchecked}


def safe_upload(service, supplier_folder_id: str, target_folder_id: str, local_path: str, name: str,
                pis=(), pos=(), invoices=(), terms=(), links=(), accounting_copy=False, dry_run=False) -> tuple[int, dict]:
    """Upload ONE file only when every check passes. Returns (exit code, report)."""
    report: dict = {"file": local_path, "name": name, "target": target_folder_id, "stop": []}
    if not os.path.isfile(local_path):
        return EXIT_ERROR, dict(report, error="local file not found")

    report["name_problems"] = name_problems(name)
    if report["name_problems"]:
        report["stop"].append("fix the name first (runbook §11.1)")

    if accounting_copy:
        # §11.4: the accounting folder is checked on its own; its copies of
        # order-folder files are deliberate, never duplicates.
        scope = target_folder_id
    else:
        scope = supplier_folder_id
        found = find_order_folders(service, supplier_folder_id, pis, pos, invoices, terms, links)
        report["order_folders"] = found
        ids = [c["id"] for c in found["candidates"]]
        if len(ids) > 1:
            report["stop"].append(f"{len(ids)} folders for one order — stop and ask Eric which one is the order folder")
        elif not ids:
            report["stop"].append("no order folder found — create the PI folder by §11.5 first, then run again")
        elif ids[0] != target_folder_id:
            report["stop"].append("the target is not the order folder that was found — stop and ask Eric")

    tree = walk(service, scope)
    existing = find_existing(service, scope, [local_path], tree=tree)
    report["already_on_drive"] = existing["files"][local_path]["matches"]
    if report["already_on_drive"]:
        report["stop"].append("the same file (same md5) is already on Drive — do not upload; check its name instead (§11.3)")
    same_name = [f["path"] for f in tree if f["name"] == name and target_folder_id in (f.get("parents") or [])]
    if same_name:
        report["stop"].append("a file with this name is already in the target folder — never overwrite (§5-C)")

    if report["stop"]:
        return EXIT_STOP, report
    if dry_run:
        return EXIT_OK, dict(report, dry_run=True, verdict="all checks pass; nothing uploaded")

    from googleapiclient.http import MediaFileUpload
    created = service.files().create(
        body={"name": name, "parents": [target_folder_id]},
        media_body=MediaFileUpload(local_path, resumable=True),
        fields=FIELDS, supportsAllDrives=True).execute()
    back = get_file(service, created["id"]) or {}
    local_md5 = existing["files"][local_path]["md5"]
    ok = back.get("md5Checksum") == local_md5 and target_folder_id in (back.get("parents") or [])
    report.update(uploaded={"id": created["id"], "name": back.get("name"), "link": back.get("webViewLink")},
                  read_back="md5 and folder match" if ok else "READ-BACK FAILED — report it; do not upload again")
    return (EXIT_OK if ok else EXIT_ERROR), report


# --------------------------------------------------------------------------- CLI

def main(argv: Optional[list] = None, service=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    def ids(p):
        p.add_argument("--supplier-folder", required=True, help="the supplier's folder id or link")
        p.add_argument("--pi", action="append", default=[])
        p.add_argument("--po", action="append", default=[])
        p.add_argument("--invoice", action="append", default=[])
        p.add_argument("--term", action="append", default=[], help="an item model; weak match only")
        p.add_argument("--link", action="append", default=[],
                       help="every ICAPROC document_url of the order: the PO's AND the quote's")

    ids(sub.add_parser("find", help="list every folder that may be this order's folder"))
    pe = sub.add_parser("existing", help="is this file already anywhere under the supplier folder?")
    pe.add_argument("--supplier-folder", required=True)
    pe.add_argument("files", nargs="+")
    pu = sub.add_parser("upload", help="upload one file, only when every check passes")
    ids(pu)
    pu.add_argument("--target", required=True, help="the order folder (or accounting folder) id or link")
    pu.add_argument("--name", required=True, help="the file's name on Drive, by §11.1")
    pu.add_argument("--accounting-copy", action="store_true", help="an ISL accounting copy (§11.4)")
    pu.add_argument("--dry-run", action="store_true")
    pu.add_argument("file")
    a = ap.parse_args(argv)

    try:
        service = service or drive_service()
        supplier = folder_id_from(a.supplier_folder)
        if a.cmd == "find":
            out = find_order_folders(service, supplier, a.pi, a.po, a.invoice, a.term, a.link)
            n = len(out["candidates"])
            code = EXIT_STOP if n > 1 else EXIT_OK
            out["verdict"] = ("STOP: more than one folder for this order — ask Eric" if n > 1 else
                              "one order folder" if n == 1 else
                              "no order folder yet — create it by §11.5")
        elif a.cmd == "existing":
            out = find_existing(service, supplier, a.files)
            dup = [p for p, r in out["files"].items() if r["matches"]]
            code = EXIT_STOP if dup else EXIT_OK
            out["verdict"] = (f"STOP: {len(dup)} file(s) already on Drive" if dup else "none of these files is on Drive")
        else:
            code, out = safe_upload(service, supplier, folder_id_from(a.target), a.file, a.name,
                                    a.pi, a.po, a.invoice, a.term, a.link, a.accounting_copy, a.dry_run)
            if code == EXIT_STOP:
                out["verdict"] = "STOP — " + "; ".join(out["stop"])
            elif code == EXIT_ERROR:
                out["verdict"] = "ERROR — " + out.get("error", out.get("read_back", ""))
            else:
                out.setdefault("verdict", "uploaded and read back")
    except Exception as exc:  # noqa: BLE001 — report the class and message, never a credential
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}", "version": VERSION}))
        return EXIT_ERROR
    out["version"] = VERSION
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return code


if __name__ == "__main__":
    sys.exit(main())
