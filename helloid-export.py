#!/usr/bin/env python3
"""Pull Service Automation products and product assignments out of a HelloID tenant.

The dashboard reads exports rather than calling HelloID itself: the page is served
publicly, an API key that can read a whole tenant does not belong in a browser's local
storage, and the page's own CSP forbids the call anyway. So the credential stays here,
on a machine you control, and the dashboard imports what this writes.

    cp .env.example .env      # fill in tenant URL, key and secret
    python3 helloid-export.py

Writes, next to this script unless -o says otherwise:

    product-assignments.csv   who holds which product, since when, approved by whom
    products.json             the products themselves, including their tasks

Why both: the assignment says a person has "Adobe Illustrator"; only the product's tasks
say which group that turns into. Together they answer the question a reconciliation
export cannot — "why does this person hold this group" — with "they requested it on this
date and their manager approved it".

Authentication is the documented scheme: Authorization: Basic base64(key:secret).
Nothing is written to the terminal that carries the credential.
"""
import argparse
import base64
import csv
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request

PAGE = 500          # skip/take paging; the API takes both as query parameters


def load_env(path):
    """Minimal .env reader — no dependency, and it only has to handle KEY=value."""
    values = {}
    if not os.path.exists(path):
        return values
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


class HelloID:
    def __init__(self, base, key, secret, insecure=False):
        self.base = base.rstrip('/')
        if not self.base.endswith('/api/v1'):
            self.base += '/api/v1'
        pair = f'{key}:{secret}'.encode('ascii')
        self.auth = 'Basic ' + base64.b64encode(pair).decode('ascii')
        self.ctx = ssl._create_unverified_context() if insecure else None

    def get(self, path, params=None):
        url = self.base + path
        if params:
            url += '?' + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={
            'Authorization': self.auth,
            'Accept': 'application/json',
            'User-Agent': 'helloid-sidekick-export/1.0'
        })
        try:
            with urllib.request.urlopen(req, context=self.ctx, timeout=120) as res:
                return json.loads(res.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', 'replace')[:400]
            raise SystemExit(f'{path} -> HTTP {e.code} {e.reason}\n{body}')
        except urllib.error.URLError as e:
            raise SystemExit(f'{path} -> {e.reason}')

    def paged(self, path):
        """skip/take until a page comes back short. Some endpoints wrap the array once.
        Says where it is after every page: a big tenant takes a while, and silence reads
        as a hang."""
        out, skip = [], 0
        while True:
            page = self.get(path, {'skip': skip, 'take': PAGE})
            if isinstance(page, dict):
                page = page.get('data') or page.get('items') or []
            # The assignments endpoint documents an array wrapped in an array.
            if len(page) == 1 and isinstance(page[0], list):
                page = page[0]
            out.extend(page)
            print(f'  {path}: {len(out):,} so far …', end='\r' if sys.stdout.isatty() else '\n', flush=True)
            if len(page) < PAGE:
                if sys.stdout.isatty():
                    print(' ' * 60, end='\r')
                return out
            skip += PAGE


ASSIGNMENT_COLUMNS = ['AssignmentGuid', 'UserName', 'UserGuid', 'ProductName', 'ProductGuid',
                      'ProductSku', 'RequestedAt', 'ApprovedAt', 'ReturnDate', 'Source',
                      'ApprovedBy', 'ApprovalComment', 'Approved']


def assignment_row(a):
    """Flatten the approval history to its decisive response: who let this through."""
    history = a.get('approvalHistory') or []
    last = history[-1] if history else {}
    return {
        'AssignmentGuid': a.get('assignmentGuid', ''),
        'UserName': a.get('userName', ''),
        'UserGuid': a.get('userGuid', ''),
        'ProductName': a.get('productName', ''),
        'ProductGuid': a.get('productGuid', ''),
        'ProductSku': a.get('productSku', ''),
        'RequestedAt': a.get('requestedAt', '') or '',
        'ApprovedAt': a.get('approvedAt', '') or '',
        'ReturnDate': a.get('returnDate', '') or '',
        'Source': a.get('source', '') or '',
        'ApprovedBy': last.get('userName', '') or '',
        'ApprovalComment': (last.get('comment') or '').replace('\n', ' '),
        'Approved': '' if last.get('approved') is None else str(bool(last.get('approved')))
    }


def fetch_products(api):
    """/products is current; /selfservice/products is the deprecated spelling."""
    for path in ('/products', '/selfservice/products'):
        try:
            data = api.get(path)
        except SystemExit as e:
            if '404' in str(e):
                continue
            raise
        if isinstance(data, dict):
            data = data.get('data') or data.get('items') or []
        print(f'  products via {path}: {len(data)}')
        return data, path
    raise SystemExit('Neither /products nor /selfservice/products answered.')


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--env', default='.env', help='file holding the credentials (default .env)')
    p.add_argument('-o', '--out', default='.', help='output directory (default: here)')
    p.add_argument('--insecure', action='store_true', help='skip TLS verification (test tenants)')
    args = p.parse_args()

    env = load_env(args.env)
    base = os.environ.get('HELLOID_URL') or env.get('HELLOID_URL')
    key = os.environ.get('HELLOID_API_KEY') or env.get('HELLOID_API_KEY')
    secret = os.environ.get('HELLOID_API_SECRET') or env.get('HELLOID_API_SECRET')
    missing = [n for n, v in [('HELLOID_URL', base), ('HELLOID_API_KEY', key),
                              ('HELLOID_API_SECRET', secret)] if not v]
    if missing:
        raise SystemExit('Missing ' + ', '.join(missing) + f' — put them in {args.env} '
                         '(see .env.example) or the environment.')

    api = HelloID(base, key, secret, args.insecure)
    os.makedirs(args.out, exist_ok=True)

    print(f'Tenant {urllib.parse.urlparse(api.base).netloc}')
    products, product_path = fetch_products(api)
    assignments = api.paged('/product-assignment')
    print(f'  product assignments: {len(assignments)}')

    products_file = os.path.join(args.out, 'products.json')
    with open(products_file, 'w', encoding='utf-8') as fh:
        json.dump({
            'kind': 'helloid-products',
            'source': product_path,
            'tenant': urllib.parse.urlparse(api.base).netloc,
            'products': products
        }, fh, indent=1, ensure_ascii=False)

    assignments_file = os.path.join(args.out, 'product-assignments.csv')
    with open(assignments_file, 'w', encoding='utf-8', newline='') as fh:
        writer = csv.DictWriter(fh, fieldnames=ASSIGNMENT_COLUMNS)
        writer.writeheader()
        for a in assignments:
            writer.writerow(assignment_row(a))

    # What the dashboard will be able to resolve without guessing, said up front.
    native = sum(1 for p_ in products for a in (p_.get('actions') or [])
                 if a.get('executionType') == 'native')
    powershell = sum(1 for p_ in products for a in (p_.get('actions') or [])
                     if a.get('executionType') == 'powershell')
    withactions = sum(1 for p_ in products if p_.get('actions'))
    print(f'\n{products_file}: {len(products)} products, {withactions} with tasks '
          f'({native} native, {powershell} PowerShell)')
    print(f'{assignments_file}: {len(assignments)} assignments')
    if powershell and not any((a.get('variables') for p_ in products for a in (p_.get('actions') or []))):
        print('\nNote: no task variables came back. Group names for PowerShell tasks then '
              'live only in the script bodies, which this endpoint does not return.')


if __name__ == '__main__':
    main()
