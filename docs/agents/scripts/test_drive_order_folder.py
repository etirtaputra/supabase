"""Tests for drive_order_folder, against a fake Drive that replays the EPSIVO PIO-016 case.

Run: python3 -m unittest docs/agents/scripts/test_drive_order_folder.py
(No Google libraries needed; the Drive client is faked.)
"""
import glob
import hashlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
_path = sorted(glob.glob(os.path.join(HERE, "drive_order_folder_v*.py")))[-1]
_spec = importlib.util.spec_from_file_location("drive_order_folder", _path)
dof = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dof)

FOLDER = dof.FOLDER_MIME
SUPPLIER = "sup"


class FakeDrive:
    """Just enough of files().list/get/create for the script."""

    def __init__(self, items):
        self.items = {i["id"]: dict(i) for i in items}
        self.created = []

    def files(self):
        return self

    def list(self, q, **_):
        parent = q.split("'")[1]
        rows = [i for i in self.items.values() if parent in i.get("parents", []) and not i.get("trashed")]
        return _Exec({"files": rows})

    def get(self, fileId, **_):
        if fileId not in self.items:
            raise KeyError(fileId)
        return _Exec(self.items[fileId])

    def create(self, body, **_):
        raise AssertionError("create must not run in these tests")


class _Exec:
    def __init__(self, value):
        self.value = value

    def execute(self):
        return self.value


def md5(b):
    return hashlib.md5(b).hexdigest()


PO_BYTES = b"%PDF the PO PIO-016-ISL-09-2026"
SLIP_BYTES = b"jpeg the DP slip"


def epsivo(merged=False):
    """Epsivo Dongguan as it stood on 22 Sep (two folders) or on 30 Oct (merged)."""
    items = [
        {"id": "pi_folder", "name": "20260921 PI-2026092101, PIO-016-ISL-09-2026 [solar pump inverter EPV300-4T7.5G]",
         "mimeType": FOLDER, "parents": [SUPPLIER], "createdTime": "2026-09-22T02:08:22Z"},
        {"id": "f_pi", "name": "1. PI_PI-2026092101_2026-09-21.pdf", "mimeType": "application/pdf",
         "parents": ["pi_folder"], "md5Checksum": md5(b"pi")},
        {"id": "f_po", "name": "4. PO_PI-2026092101_2026-09-22.pdf", "mimeType": "application/pdf",
         "parents": ["pi_folder"], "md5Checksum": md5(PO_BYTES)},
        {"id": "old_order", "name": "20260709 PI2026070901, LCL, 20pcs ea 22kW - 37kW EPV300-4T7.5G",
         "mimeType": FOLDER, "parents": [SUPPLIER], "createdTime": "2026-07-09T08:40:53Z"},
        {"id": "other_scheme", "name": "20260301 PI2026030101, PIO-2026016", "mimeType": FOLDER,
         "parents": [SUPPLIER], "createdTime": "2026-03-01T00:00:00Z"},
    ]
    if not merged:
        items += [
            {"id": "quote_folder", "name": "20260918 Epsivo VFD Price List single phase", "mimeType": FOLDER,
             "parents": [SUPPLIER], "createdTime": "2026-09-18T23:55:00Z"},
            {"id": "q_po", "name": "PO PIO-016-ISL-09-2026.pdf", "mimeType": "application/pdf",
             "parents": ["quote_folder"], "md5Checksum": md5(PO_BYTES)},
        ]
    return FakeDrive(items)


class Names(unittest.TestCase):
    def test_po_written_forms_match_and_the_other_scheme_does_not(self):
        pats = dof.number_patterns("po", "PIO-016-ISL-09-2026")
        hit = lambda name: any(p.search(dof.norm(name)) for p in pats)
        for name in ("PIO/016", "PIO-016", "PIO 016", "PIO016", "x PIO-016-ISL-09-2026 y", "pio/16"):
            self.assertTrue(hit(name), name)
        for name in ("PIO-2026016", "PIO-0160", "PIO/017", "XPIO016"):
            self.assertFalse(hit(name), name)

    def test_year_scheme_po(self):
        pats = dof.number_patterns("po", "PIO-2026016")
        hit = lambda name: any(p.search(dof.norm(name)) for p in pats)
        self.assertTrue(hit("PIO2026016"))
        self.assertTrue(hit("PIO-2026-016"))
        self.assertFalse(hit("PIO/016"))

    def test_pi_with_and_without_prefix(self):
        pats = dof.number_patterns("pi", "PI-2026092101")
        hit = lambda name: any(p.search(dof.norm(name)) for p in pats)
        for name in ("PI-2026092101", "PI2026092101", "1. PI_2026092101_2026-09-21.pdf"):
            self.assertTrue(hit(name), name)
        self.assertFalse(hit("PI-20260921011"))

    def test_amounts_are_refused_and_dates_models_pis_are_not(self):
        self.assertTrue(any("amount" in p for p in dof.name_problems("15. OPS_IDR 6.000.000_PI-2026092101_2026-10-28.jpg")))
        self.assertTrue(any("amount" in p for p in dof.name_problems("15. OPS_IDR6000000_PI-2026092101_2026-10-28.jpg")))
        for ok in ("15. OPS_IDR_PI-2026092101_2026-10-28.jpg", "2. DP30_USD_PJ-260827-22 V02_2026-09-03.png",
                   "1b. PRICE LIST_Epsivo VFD EPV230-2SS0.75G_2026-09-18.pdf"):
            self.assertEqual(dof.name_problems(ok), [], ok)

    def test_name_shape(self):
        self.assertTrue(dof.name_problems("PO PIO-016.pdf"))            # no number
        self.assertTrue(dof.name_problems("4. PO_PI-2026092101_20260922.pdf"))  # date without hyphens
        self.assertTrue(dof.name_problems("4. PO_PI-2026092101_2026-09-22"))    # no extension

    def test_ids_from_links(self):
        self.assertEqual(dof.folder_id_from("https://drive.google.com/drive/folders/1ZdK17RgDC4w8OI-YaKEfitCVN7ojwO7o"),
                         "1ZdK17RgDC4w8OI-YaKEfitCVN7ojwO7o")
        self.assertEqual(dof.folder_id_from("https://drive.google.com/file/d/1nYasLCqicz21Jhg1qwy0zcyoQ3cW9gvc/view"),
                         "1nYasLCqicz21Jhg1qwy0zcyoQ3cW9gvc")


class Find(unittest.TestCase):
    ARGS = dict(pis=["PI-2026092101"], pos=["PIO-016-ISL-09-2026"], terms=["EPV300-4T7.5G"])

    def test_22_sep_two_folders_for_one_order_is_a_stop(self):
        out = dof.find_order_folders(epsivo(), SUPPLIER, **self.ARGS)
        self.assertEqual({c["id"] for c in out["candidates"]}, {"pi_folder", "quote_folder"})
        quote = next(c for c in out["candidates"] if c["id"] == "quote_folder")
        self.assertTrue(any("holds" in w for w in quote["why"]), "found by the PO file inside it")
        self.assertEqual([r["id"] for r in out["related"]], ["old_order"], "same model, older order: weak only")

    def test_the_quote_link_alone_finds_the_quote_folder(self):
        d = epsivo()
        d.items["q_po"]["name"] = "scan001.pdf"  # nothing in the name gives it away
        out = dof.find_order_folders(d, SUPPLIER, **self.ARGS, links=["https://drive.google.com/drive/folders/quote_folder"])
        self.assertIn("quote_folder", {c["id"] for c in out["candidates"]})

    def test_30_oct_merged_is_one_folder(self):
        out = dof.find_order_folders(epsivo(merged=True), SUPPLIER, **self.ARGS)
        self.assertEqual([c["id"] for c in out["candidates"]], ["pi_folder"])

    def test_trashed_link_is_a_warning_not_a_candidate(self):
        d = epsivo(merged=True)
        d.items["dead"] = {"id": "dead", "name": "20260918 Epsivo VFD Price List", "mimeType": FOLDER,
                           "parents": [SUPPLIER], "trashed": True}
        out = dof.find_order_folders(d, SUPPLIER, **self.ARGS, links=["dead"])
        self.assertEqual([c["id"] for c in out["candidates"]], ["pi_folder"])
        self.assertTrue(any("TRASH" in w for w in out["warnings"]))


class Upload(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def local(self, data, name="f.pdf"):
        p = os.path.join(self.tmp.name, name)
        with open(p, "wb") as fh:
            fh.write(data)
        return p

    def run_upload(self, drive, path, name, target="pi_folder", **kw):
        return dof.safe_upload(drive, SUPPLIER, target, path, name, pis=["PI-2026092101"],
                               pos=["PIO-016-ISL-09-2026"], dry_run=True, **kw)

    def test_the_po_into_the_quote_folder_is_refused(self):
        code, rep = self.run_upload(epsivo(), self.local(PO_BYTES), "4. PO_PI-2026092101_2026-09-22.pdf",
                                    target="quote_folder")
        self.assertEqual(code, dof.EXIT_STOP)
        self.assertTrue(any("folders for one order" in s for s in rep["stop"]))
        self.assertTrue(any("same md5" in s for s in rep["stop"]))

    def test_a_file_already_on_drive_is_refused_even_into_the_right_folder(self):
        code, rep = self.run_upload(epsivo(merged=True), self.local(PO_BYTES), "4b. PO_PI-2026092101_2026-09-22.pdf")
        self.assertEqual(code, dof.EXIT_STOP)
        self.assertEqual(rep["already_on_drive"][0]["id"], "f_po")

    def test_a_new_file_into_the_one_folder_passes(self):
        code, rep = self.run_upload(epsivo(merged=True), self.local(SLIP_BYTES),
                                    "5. DP30_USD_PI-2026092101_2026-09-23.jpg")
        self.assertEqual(code, dof.EXIT_OK, rep["stop"])

    def test_a_wrong_target_is_refused(self):
        code, rep = self.run_upload(epsivo(merged=True), self.local(SLIP_BYTES),
                                    "5. DP30_USD_PI-2026092101_2026-09-23.jpg", target="old_order")
        self.assertEqual(code, dof.EXIT_STOP)

    def test_an_amount_in_the_name_is_refused(self):
        code, rep = self.run_upload(epsivo(merged=True), self.local(SLIP_BYTES),
                                    "15. OPS_IDR 6.000.000_PI-2026092101_2026-10-28.jpg")
        self.assertEqual(code, dof.EXIT_STOP)

    def test_same_name_is_never_overwritten(self):
        code, rep = self.run_upload(epsivo(merged=True), self.local(SLIP_BYTES), "4. PO_PI-2026092101_2026-09-22.pdf")
        self.assertTrue(any("never overwrite" in s for s in rep["stop"]))

    def test_no_order_folder_yet_says_create_it(self):
        d = FakeDrive([])
        code, rep = self.run_upload(d, self.local(SLIP_BYTES), "1. PI_PI-2026092101_2026-09-21.pdf", target="x")
        self.assertEqual(code, dof.EXIT_STOP)
        self.assertTrue(any("create the PI folder" in s for s in rep["stop"]))

    def test_accounting_copy_checks_only_its_own_folder(self):
        d = epsivo(merged=True)
        d.items["acc"] = {"id": "acc", "name": "16 EPSIVO", "mimeType": FOLDER, "parents": ["accroot"]}
        code, rep = dof.safe_upload(d, SUPPLIER, "acc", self.local(PO_BYTES), "4. PO_PI-2026092101_2026-09-22.pdf",
                                    accounting_copy=True, dry_run=True)
        self.assertEqual(code, dof.EXIT_OK, rep["stop"])


class Cli(unittest.TestCase):
    def test_find_exit_codes(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = dof.main(["find", "--supplier-folder", SUPPLIER, "--pi", "PI-2026092101",
                             "--po", "PIO/016-ISL-09-2026"], service=epsivo())
        self.assertEqual(code, dof.EXIT_STOP)
        self.assertIn("STOP", json.loads(buf.getvalue())["verdict"])
        with redirect_stdout(io.StringIO()):
            self.assertEqual(dof.main(["find", "--supplier-folder", SUPPLIER, "--pi", "PI-2026092101"],
                                      service=epsivo(merged=True)), dof.EXIT_OK)


if __name__ == "__main__":
    unittest.main()
