#!/usr/bin/env python3
"""
Dolibarr survey: READ-ONLY. Counts what is in Dolibarr before the move to ICAPROC.

    DOLIBARR_API_KEY=... python3 scripts/dolibarr-survey.py [--out DIR] [--url URL] [--page N]

The Indodaya API lives under /dolibarr (https://erp.indodaya.co.id/dolibarr/api/
index.php); the web root itself answers 403. That is the default.

Writes two files into DIR (default ./dolibarr-survey-YYYY-MM-DD):

  survey.json   counts, open vs closed, date ranges, documents per month,
                money totals per status, bank accounts, users and their rights.
                No customer data beyond counts.
  keys.json     what the import needs to MATCH rather than duplicate: product
                refs, third-party names and codes, and the open documents
                (ref, customer id, date, total, status).

Both files are rewritten after every section, so a run that dies half-way
still leaves everything read so far (`"complete": false` says it is partial).

Standard library only, so it runs anywhere python3 does: the sandbox, the
Jakarta VPS (MIRA: /opt/hermes/.venv/bin/python3), a laptop.

Rules this script keeps, and lib/dolibarrSurvey.test.ts asserts:
  * Every request is a GET. There is exactly one function that talks to
    Dolibarr, `get()`, and it hard-codes the method. Nothing is created,
    changed or deleted in Dolibarr. Ever.
  * The API key is read from the environment and sent only as the DOLAPIKEY
    header. It is never printed, logged or written to the output files.
"""
import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

PAGE = 25           # small pages: the server resets long responses (orders carry their lines)
PAUSE = 0.05        # be gentle with a production server
RETRIES = 5         # a dropped connection is retried, waiting 2, 4, 8, 16, 32 s

# ── Status words (Dolibarr's numeric codes) ──────────────────────────────────
PROPOSAL = {-1: 'cancelled', 0: 'draft', 1: 'open', 2: 'signed', 3: 'not signed', 4: 'billed'}
ORDER = {-1: 'cancelled', 0: 'draft', 1: 'validated', 2: 'shipping', 3: 'delivered'}
INVOICE = {0: 'draft', 1: 'unpaid', 2: 'paid', 3: 'abandoned'}
INVOICE_TYPE = {0: 'standard', 1: 'replacement', 2: 'credit note', 3: 'deposit', 4: 'proforma', 5: 'situation'}
SHIPMENT = {0: 'draft', 1: 'validated', 2: 'closed'}
SUPPLIER_ORDER = {0: 'draft', 1: 'validated', 2: 'approved', 3: 'ordered', 4: 'partly received',
                  5: 'received', 6: 'cancelled', 7: 'refused', 9: 'cancelled'}
SUPPLIER_PROPOSAL = {0: 'draft', 1: 'validated', 2: 'signed', 3: 'not signed', 4: 'closed'}
RECEPTION = {0: 'draft', 1: 'validated', 2: 'closed'}

# Which statuses are still WORK (they belong in the "open work" batch)
OPEN = {
    'proposals': {'draft', 'open', 'signed'},
    'orders': {'draft', 'validated', 'shipping'},
    'invoices': {'draft', 'unpaid'},
    'shipments': {'draft', 'validated'},
    'supplierproposals': {'draft', 'validated', 'signed'},
    'supplierorders': {'draft', 'validated', 'approved', 'ordered', 'partly received'},
    'supplierinvoices': {'draft', 'unpaid'},
    'receptions': {'draft', 'validated'},
}

# name, endpoint, status map, date fields (first present wins), money field
DOCUMENTS = [
    ('proposals', 'proposals', PROPOSAL, ['date', 'datep', 'date_creation'], 'total_ttc'),
    ('orders', 'orders', ORDER, ['date_commande', 'date', 'date_creation'], 'total_ttc'),
    ('invoices', 'invoices', INVOICE, ['date', 'date_creation'], 'total_ttc'),
    ('shipments', 'shipments', SHIPMENT, ['date_shipping', 'date_delivery', 'date_creation', 'date'], None),
    ('supplierproposals', 'supplierproposals', SUPPLIER_PROPOSAL, ['date', 'datep', 'date_creation'], 'total_ttc'),
    ('supplierorders', 'supplierorders', SUPPLIER_ORDER, ['date_commande', 'date', 'date_creation'], 'total_ttc'),
    ('supplierinvoices', 'supplierinvoices', INVOICE, ['date', 'date_creation'], 'total_ttc'),
    ('receptions', 'receptions', RECEPTION, ['date_reception', 'date_creation', 'date'], None),
]

# Modules we only need to know are used (count + date range)
OTHERS = [
    ('projects', 'projects', ['date_start', 'date_c', 'date_creation']),
    ('interventions', 'interventions', ['datec', 'date_creation', 'dateo']),
    ('contracts', 'contracts', ['date_contrat', 'date_creation']),
    ('tickets', 'tickets', ['datec', 'date_creation']),
    ('expensereports', 'expensereports', ['date_debut', 'date_create', 'date_creation']),
    ('agendaevents', 'agendaevents', ['datep', 'datec']),
    ('categories', 'categories', []),
]


class Dolibarr:
    def __init__(self, base, key, page=PAGE):
        self.base = base.rstrip('/')
        self.key = key
        self.page = page
        self.calls = 0
        self.retries = 0

    def get(self, path, params=None):
        """The ONLY function that talks to Dolibarr. GET, always.

        Returns (status, data). data is parsed JSON, or the error text.
        A connection the server drops part-way (reset, short read, cut-off
        JSON) is retried RETRIES times; a GET is safe to repeat."""
        url = f'{self.base}/{path.lstrip("/")}'
        if params:
            url += '?' + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, method='GET', headers={
            'DOLAPIKEY': self.key,
            'Accept': 'application/json',
            'User-Agent': 'icaproc-dolibarr-survey/1 (read-only)',
        })
        for attempt in range(RETRIES + 1):
            self.calls += 1
            time.sleep(PAUSE)
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    body = r.read().decode('utf-8', 'replace')
                    return r.status, (json.loads(body) if body.strip() else None)
            except urllib.error.HTTPError as e:
                if e.code in (429, 502, 503, 504) and attempt < RETRIES:
                    self._wait(attempt, f'HTTP {e.code}', path)
                    continue
                text = e.read().decode('utf-8', 'replace')[:300]
                try:
                    text = json.loads(text)
                except ValueError:
                    pass
                return e.code, text
            except Exception as e:  # reset, short read, timeout, cut-off JSON
                if attempt < RETRIES:
                    self._wait(attempt, type(e).__name__, path)
                    continue
                return 0, f'{type(e).__name__}: {getattr(e, "reason", e)}'

    def _wait(self, attempt, why, path):
        self.retries += 1
        delay = 2 ** (attempt + 1)
        print(f'    {why} on {path}; retrying in {delay}s ({attempt + 1}/{RETRIES})', flush=True)
        time.sleep(delay)

    def list_all(self, endpoint, extra=None):
        """Every row of a list endpoint. Returns (rows, note).

        Dolibarr answers an empty list with 404 "No … found" on older versions
        and [] on newer ones; both mean "nothing here". 401/403 means this key
        may not read it; 501 or a 404 on the endpoint itself means the module
        is off."""
        rows, page = [], 0
        while True:
            params = {'limit': self.page, 'page': page, 'sortfield': 't.rowid', 'sortorder': 'ASC'}
            params.update(extra or {})
            status, data = self.get(endpoint, params)
            if status == 200 and isinstance(data, list):
                rows.extend(data)
                if len(data) < self.page:
                    return rows, 'ok'
                page += 1
                continue
            if status == 404 and page > 0:
                return rows, 'ok'
            if status == 404:
                msg = json.dumps(data).lower() if not isinstance(data, str) else data.lower()
                return rows, ('empty' if ('no ' in msg and 'found' in msg) else 'not available (404)')
            if status in (401, 403):
                return rows, f'forbidden for this key ({status})'
            if status == 501:
                return rows, 'module off (501)'
            if status == 0:
                return rows, f'stopped after {len(rows)} rows: {str(data)[:120]}'
            return rows, f'error {status}: {str(data)[:120]}'


# ── Small helpers ────────────────────────────────────────────────────────────

def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def intval(v, default=None):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def when(obj, fields):
    """First usable date among `fields`. Dolibarr sends unix seconds (int or
    string) or ''. Returns a date or None."""
    for f in fields:
        v = obj.get(f)
        if v in (None, '', 0, '0'):
            continue
        n = intval(v)
        if n and n > 86400:
            return dt.datetime.fromtimestamp(n, dt.timezone.utc).date()
        try:
            return dt.date.fromisoformat(str(v)[:10])
        except ValueError:
            continue
    return None


def status_of(obj, names):
    code = intval(obj.get('statut', obj.get('status')))
    return names.get(code, f'code {code}')


def span(dates):
    dates = [d for d in dates if d]
    return {'first': min(dates).isoformat(), 'last': max(dates).isoformat()} if dates else None


def per_month(dates):
    c = Counter(d.strftime('%Y-%m') for d in dates if d)
    return dict(sorted(c.items()))


# ── Survey sections ──────────────────────────────────────────────────────────

def survey_documents(api, name, endpoint, names, date_fields, money):
    rows, note = api.list_all(endpoint)
    out = {'note': note, 'count': len(rows)}
    keys = []
    if not rows:
        return out, keys
    by_status, money_by_status = Counter(), defaultdict(float)
    dates = []
    for r in rows:
        s = status_of(r, names)
        by_status[s] += 1
        if money:
            money_by_status[s] += num(r.get(money))
        d = when(r, date_fields)
        dates.append(d)
        if s in OPEN.get(name, set()):
            keys.append({
                'id': r.get('id'), 'ref': r.get('ref'), 'socid': r.get('socid'),
                'date': d.isoformat() if d else None, 'status': s,
                'total_ttc': num(r.get('total_ttc')) if money else None,
                'lines': len(r.get('lines') or []),
            })
    open_n = sum(n for s, n in by_status.items() if s in OPEN.get(name, set()))
    out.update({
        'by_status': dict(by_status),
        'open': open_n,
        'closed': len(rows) - open_n,
        'dates': span(dates),
        'per_month': per_month(dates),
        'lines': sum(len(r.get('lines') or []) for r in rows),
    })
    if money:
        out['total_ttc_by_status'] = {k: round(v, 2) for k, v in money_by_status.items()}
    if name in ('invoices', 'supplierinvoices'):
        out['by_type'] = dict(Counter(INVOICE_TYPE.get(intval(r.get('type')), str(r.get('type'))) for r in rows))
        out['unpaid_total_ttc'] = round(sum(num(r.get('total_ttc')) for r in rows
                                            if status_of(r, names) == 'unpaid'), 2)
    if name == 'orders':
        out['billed'] = sum(1 for r in rows if intval(r.get('billed'), 0) == 1)
    currencies = Counter(r.get('multicurrency_code') or '' for r in rows)
    if len(currencies) > 1 or '' not in currencies:
        out['currencies'] = dict(currencies)
    return out, keys


def survey_products(api):
    rows, note = api.list_all('products')
    out = {'note': note, 'count': len(rows)}
    if not rows:
        return out, []
    out.update({
        'by_type': dict(Counter('service' if intval(r.get('type')) == 1 else 'product' for r in rows)),
        'for_sale': sum(1 for r in rows if intval(r.get('status'), 0) == 1),
        'for_purchase': sum(1 for r in rows if intval(r.get('status_buy'), 0) == 1),
        'with_stock': sum(1 for r in rows if num(r.get('stock_reel')) > 0),
        'with_price': sum(1 for r in rows if num(r.get('price')) > 0),
        'with_cost': sum(1 for r in rows if num(r.get('cost_price')) > 0 or num(r.get('pmp')) > 0),
        'with_barcode': sum(1 for r in rows if r.get('barcode')),
        'stock_value_pmp': round(sum(num(r.get('stock_reel')) * num(r.get('pmp')) for r in rows), 2),
        'dates': span([when(r, ['date_creation', 'datec']) for r in rows]),
        'changed': span([when(r, ['date_modification', 'tms']) for r in rows]),
    })
    keys = [{
        'id': r.get('id'), 'ref': r.get('ref'), 'label': r.get('label'),
        'type': intval(r.get('type')), 'tosell': intval(r.get('status')), 'tobuy': intval(r.get('status_buy')),
        'price': num(r.get('price')), 'pmp': num(r.get('pmp')), 'stock': num(r.get('stock_reel')),
        'barcode': r.get('barcode') or None,
    } for r in rows]
    return out, keys


def survey_thirdparties(api):
    rows, note = api.list_all('thirdparties')
    out = {'note': note, 'count': len(rows)}
    if not rows:
        return out, []
    cust = [r for r in rows if intval(r.get('client'), 0) in (1, 3)]
    prospect = [r for r in rows if intval(r.get('client'), 0) in (2, 3)]
    supp = [r for r in rows if intval(r.get('fournisseur'), 0) == 1]
    out.update({
        'customers': len(cust), 'prospects': len(prospect), 'suppliers': len(supp),
        'both_customer_and_supplier': sum(1 for r in cust if intval(r.get('fournisseur'), 0) == 1),
        'neither': sum(1 for r in rows if intval(r.get('client'), 0) == 0 and intval(r.get('fournisseur'), 0) == 0),
        'active': sum(1 for r in rows if intval(r.get('status'), 1) == 1),
        'with_tax_id': sum(1 for r in rows if (r.get('tva_intra') or r.get('idprof1') or '').strip()),
        'with_email': sum(1 for r in rows if (r.get('email') or '').strip()),
        'with_price_level': dict(Counter(str(r.get('price_level') or '') for r in cust)),
        'dates': span([when(r, ['date_creation', 'datec']) for r in rows]),
        'changed': span([when(r, ['date_modification', 'tms']) for r in rows]),
    })
    keys = [{
        'id': r.get('id'), 'name': r.get('name'), 'name_alias': r.get('name_alias') or None,
        'code_client': r.get('code_client') or None, 'code_fournisseur': r.get('code_fournisseur') or None,
        'client': intval(r.get('client'), 0), 'fournisseur': intval(r.get('fournisseur'), 0),
        'status': intval(r.get('status'), 1), 'tax_id': (r.get('tva_intra') or r.get('idprof1') or None),
        'email': r.get('email') or None, 'town': r.get('town') or None,
    } for r in rows]
    return out, keys


def survey_contacts(api):
    rows, note = api.list_all('contacts')
    out = {'note': note, 'count': len(rows)}
    if rows:
        out.update({
            'attached_to_company': sum(1 for r in rows if intval(r.get('socid'), 0) > 0),
            'with_email': sum(1 for r in rows if (r.get('email') or '').strip()),
            'with_phone': sum(1 for r in rows if (r.get('phone_pro') or r.get('phone_mobile') or '').strip()),
            'active': sum(1 for r in rows if intval(r.get('statut', r.get('status')), 1) == 1),
            'dates': span([when(r, ['date_creation', 'datec']) for r in rows]),
        })
    return out


def survey_stock(api):
    wh, wh_note = api.list_all('warehouses')
    mv, mv_note = api.list_all('stockmovements')
    dates = [when(r, ['datem', 'date_creation']) for r in mv]
    return {
        'warehouses': {'note': wh_note, 'count': len(wh),
                       'names': [w.get('label') or w.get('ref') or w.get('libelle') for w in wh]},
        'movements': {'note': mv_note, 'count': len(mv), 'dates': span(dates), 'per_month': per_month(dates),
                      'in': sum(1 for r in mv if num(r.get('qty')) > 0),
                      'out': sum(1 for r in mv if num(r.get('qty')) < 0),
                      'products_touched': len({r.get('product_id') for r in mv})},
    }


def survey_bank(api):
    accts, note = api.list_all('bankaccounts')
    out = {'note': note, 'count': len(accts), 'accounts': []}
    for a in accts:
        lines, lnote = api.list_all(f'bankaccounts/{a.get("id")}/lines')
        dates = [when(r, ['dateo', 'datev', 'datec']) for r in lines]
        amounts = [num(r.get('amount')) for r in lines]
        out['accounts'].append({
            'label': a.get('label'), 'bank': a.get('bank'), 'currency': a.get('currency_code'),
            'closed': intval(a.get('clos'), 0) == 1,
            'lines': len(lines), 'note': lnote, 'dates': span(dates),
            'money_in': round(sum(x for x in amounts if x > 0), 2),
            'money_out': round(-sum(x for x in amounts if x < 0), 2),
            'balance_from_lines': round(sum(amounts), 2),
            'reconciled': sum(1 for r in lines if intval(r.get('rappro'), 0) == 1),
            'by_type': dict(Counter(r.get('fk_type') or '' for r in lines)),
            'per_month': per_month(dates),
        })
    return out


def survey_users(api):
    users, note = api.list_all('users')
    out = {'note': note, 'count': len(users), 'users': []}
    for u in users:
        uid = u.get('id')
        status, full = api.get(f'users/{uid}', {'includepermissions': 1})
        rights = full.get('rights') if status == 200 and isinstance(full, dict) else None
        status, groups = api.get(f'users/{uid}/groups')
        modules = {}
        if isinstance(rights, dict):
            for module, perms in rights.items():
                granted = sorted(k for k, v in _flatten(perms) if v)
                if granted:
                    modules[module] = granted
        out['users'].append({
            'login': u.get('login'),
            'name': ' '.join(x for x in (u.get('firstname'), u.get('lastname')) if x),
            'email': u.get('email') or None,
            'active': intval(u.get('statut', u.get('status')), 1) == 1,
            'admin': intval(u.get('admin'), 0) == 1,
            'employee': intval(u.get('employee'), 0) == 1,
            'last_login': _iso(when(u, ['datelastlogin'])),
            'groups': [g.get('name') or g.get('nom') for g in groups] if isinstance(groups, list) else [],
            'rights': modules if rights is not None else 'not readable with this key',
        })
    return out


def _iso(d):
    return d.isoformat() if d else None


def _flatten(perms, prefix=''):
    if isinstance(perms, dict):
        for k, v in perms.items():
            yield from _flatten(v, f'{prefix}{k}.' if isinstance(v, dict) else f'{prefix}{k}')
    elif isinstance(perms, (bool, int, str)):
        yield prefix, perms in (True, 1, '1')


# ── Main ─────────────────────────────────────────────────────────────────────

def api_base(url):
    url = (url or 'https://erp.indodaya.co.id/dolibarr').rstrip('/')
    return url if url.endswith('/api/index.php') else url + '/api/index.php'


def main(argv=None):
    p = argparse.ArgumentParser(description='Read-only survey of a Dolibarr instance.')
    p.add_argument('--url', default=os.environ.get('DOLIBARR_URL'), help='Dolibarr URL (default $DOLIBARR_URL)')
    p.add_argument('--out', default=f'dolibarr-survey-{dt.date.today().isoformat()}')
    p.add_argument('--page', type=int, default=PAGE, help=f'rows per request (default {PAGE})')
    a = p.parse_args(argv)

    key = os.environ.get('DOLIBARR_API_KEY', '')
    if not key:
        print('DOLIBARR_API_KEY is not set.', file=sys.stderr)
        return 2
    api = Dolibarr(api_base(a.url), key, max(1, a.page))

    status, info = api.get('status')
    if status != 200:
        print(f'Cannot read Dolibarr: HTTP {status} from {api.base}/status. Nothing else was tried.', file=sys.stderr)
        return 1
    version = (info or {}).get('success', {}).get('dolibarr_version') if isinstance(info, dict) else None
    print(f'Connected: Dolibarr {version or "?"}')

    survey = {'generated_at': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
              'dolibarr': {'base': api.base, 'version': version}, 'complete': False}
    keys = {}
    os.makedirs(a.out, exist_ok=True)

    def save():
        survey['api_calls'], survey['retries'] = api.calls, api.retries
        for name, obj in (('survey.json', survey), ('keys.json', keys)):
            tmp = os.path.join(a.out, name + '.tmp')
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(obj, f, ensure_ascii=False, indent=1)
            os.replace(tmp, os.path.join(a.out, name))

    status, mods = api.get('setup/modules')
    survey['modules_enabled'] = sorted(mods) if status == 200 and isinstance(mods, list) else f'not readable ({status})'

    save()

    def step(label, fn):
        print(f'  reading {label} …', flush=True)
        fn()
        save()

    def products():
        survey['products'], keys['products'] = survey_products(api)

    def thirdparties():
        survey['thirdparties'], keys['thirdparties'] = survey_thirdparties(api)

    def contacts():
        survey['contacts'] = survey_contacts(api)

    step('products', products)
    step('thirdparties', thirdparties)
    step('contacts', contacts)
    keys['open_documents'] = {}
    for name, endpoint, names, dates, money in DOCUMENTS:
        def doc(name=name, endpoint=endpoint, names=names, dates=dates, money=money):
            survey[name], keys['open_documents'][name] = survey_documents(api, name, endpoint, names, dates, money)
        step(name, doc)
    step('stock', lambda: survey.__setitem__('stock', survey_stock(api)))
    step('bank', lambda: survey.__setitem__('bank', survey_bank(api)))
    step('users', lambda: survey.__setitem__('users', survey_users(api)))
    survey['other_modules'] = {}
    for name, endpoint, dates in OTHERS:
        def other(name=name, endpoint=endpoint, dates=dates):
            rows, note = api.list_all(endpoint)
            survey['other_modules'][name] = {'note': note, 'count': len(rows),
                                             'dates': span([when(r, dates) for r in rows]) if dates else None}
        step(name, other)
    survey['complete'] = True
    save()

    print(f'\n{"what":<20}{"count":>8}{"open":>8}  dates')
    for name in ['products', 'thirdparties', 'contacts'] + [d[0] for d in DOCUMENTS]:
        s = survey[name]
        d = s.get('dates') or {}
        print(f'{name:<20}{s.get("count", 0):>8}{s.get("open", ""):>8}  '
              f'{d.get("first", "")} → {d.get("last", "")}  {"" if s.get("note") == "ok" else s.get("note")}')
    print(f'{"stock movements":<20}{survey["stock"]["movements"]["count"]:>8}')
    print(f'{"bank accounts":<20}{survey["bank"]["count"]:>8}')
    print(f'{"users":<20}{survey["users"]["count"]:>8}')
    print(f'\n{api.calls} GET requests ({api.retries} retried), nothing written to Dolibarr. Files in {a.out}/')
    return 0


if __name__ == '__main__':
    sys.exit(main())
