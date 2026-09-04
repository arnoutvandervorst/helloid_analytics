#!/usr/bin/env python3
"""Pull the HelloID audit log out of a tenant's Elastic API.

The exports describe state — what exists, what the rules say. The audit log describes
process: who excluded which reconciliation issue and why, who approved which threshold,
who published which rule with which entitlements, whether the imports and evaluations ran,
which actions failed, who logs in to HelloID itself. That is the evidence a review asks
for, and no export carries it.

The dashboard cannot call the API: the proxy sends no CORS headers and the page's CSP
forbids it — and an API key that reads a whole tenant does not belong in a browser
anyway. So the credential stays here, on a machine you control, and the dashboard
imports what this writes.

    python3 helloid-audit.py --days 400

The first run asks for the Elastic URL, key and secret (the key is created in HelloID at
https://<tenant>.helloid.com/admin/elasticapikey and the page shows all three) and offers
to save them as a named profile in helloid-config.json, next to this script, owner-only.
After that it just runs; --profile NAME picks another tenant, --setup asks again,
--list-profiles and --forget NAME manage the file. Environment variables and a .env file
still work as before.

Writes helloid-audit.json next to this script unless -o says otherwise. One file, one
tenant, one window; rows keep the field names Kibana shows so anything here can be
cross-checked there. Nothing is written to the terminal that carries the credential.

What the proxy allows, learnt the hard way: only /<index-pattern>/_search; no _cat,
_mapping, _field_caps, point-in-time or query parameters; the from+size window is
capped at 10,000 hits, so a time window that holds more is split until it fits.
"""
import argparse
import base64
import datetime as dt
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helloid_creds  # noqa: E402  (next to this script)

T0 = time.monotonic()


def step(msg):
    """One line per thing that happened, stamped with the elapsed time — the same shape
    the PowerShell collectors print, so a run reads the same on every machine."""
    e = int(time.monotonic() - T0)
    print(f'[{e // 60:02d}:{e % 60:02d}] {msg}', flush=True)


def progress(msg):
    """Same-line progress on a terminal; plain lines when the output is a file."""
    if sys.stdout.isatty():
        print('\r' + ' ' * 100 + '\r        ' + msg, end='', flush=True)
    else:
        print('        ' + msg, flush=True)

PAGE = 5000            # per request; the proxy's window cap is 10,000
WINDOW_CAP = 10000

# Index pattern → key in the output, and the fields worth keeping. `None` keeps all.
SOURCES = [
    ('provisioning-audit*', 'provisioning',
     ['logDate', 'action', 'state', 'personDisplayName', 'systemName', 'systemType', 'message',
      'actionDurationMs', 'waitDurationMs']),
    ('provisioning-user-action-reconciliation*', 'reconciliation', None),
    ('provisioning-user-action-thresholds*', 'thresholds', None),
    ('provisioning-user-action-business-rules*', 'rules', None),
    ('provisioning-user-action-entitlement*', 'entitlements', None),
    ('provisioning-user-action-evaluation*', 'evaluations', None),
    ('provisioning-user-action-target-system*', 'systemChanges', None),
    ('provisioning-user-action-source-system*', 'systemChanges', None),
    ('provisioning-source-import*', 'imports', None),
    ('provisioning-source-snapshot*', 'snapshots', None),
    ('authentication-login*', 'logins',
     ['logDate', 'userName', 'userGuid', 'idpName', 'idpType', 'loginSuccess', 'resultCode',
      'ipAddress', 'geoip.country_iso_code', 'geoip.city_name', 'user_agent.os.name', 'user_agent.name']),
    ('authentication-user-*', 'portalAdmin', None),
    ('authentication-group-*', 'portalAdmin', None),
    ('authentication-admin-*', 'portalAdmin', None),
    ('authentication-mfa*', 'mfa', None),
    ('general-incidents*', 'incidents', None),
    ('general-license-counts*', 'licenses', None),
]
DROP = {'tenant', 'tid'}     # the same on every row; the tenant is named once in the header


class Elastic:
    def __init__(self, base, key, secret, insecure=False):
        self.base = base.rstrip('/')
        pair = f'{key}:{secret}'.encode('ascii')
        self.auth = 'Basic ' + base64.b64encode(pair).decode('ascii')
        self.ctx = ssl._create_unverified_context() if insecure else None
        self.requests = 0

    def search(self, pattern, body):
        url = f'{self.base}/{pattern}/_search'
        req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), method='POST', headers={
            'Authorization': self.auth,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'helloid-sidekick-audit/1.0'
        })
        self.requests += 1
        try:
            with urllib.request.urlopen(req, context=self.ctx, timeout=180) as res:
                return json.loads(res.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            # The proxy answers errors in plain text, not JSON.
            body = e.read().decode('utf-8', 'replace')[:300]
            raise SystemExit(f'{pattern}/_search -> HTTP {e.code} {e.reason}\n{body}')
        except urllib.error.URLError as e:
            raise SystemExit(f'{pattern}/_search -> {e.reason}')

    def count(self, pattern, start, end):
        res = self.search(pattern, {'size': 0, 'track_total_hits': True, 'query': range_query(start, end)})
        return res['hits']['total']['value']

    def window(self, pattern, start, end, fields, tally):
        """Every hit in [start, end): from+size pages inside the cap, splitting the
        window in two when it holds more than the cap. `tally` keeps the running count
        for the progress line."""
        total = self.count(pattern, start, end)
        if total == 0:
            return []
        if total > WINDOW_CAP:
            if (end - start) <= dt.timedelta(minutes=1):
                print(f'\n  ! {pattern}: more than {WINDOW_CAP} events inside one minute at {start.isoformat()}; keeping the first {WINDOW_CAP}', file=sys.stderr)
            else:
                mid = start + (end - start) / 2
                tally['splits'] += 1
                progress(f'{tally["rows"]:,} rows · {self.requests} requests · splitting {iso(start)[:10]} → {iso(end)[:10]} ({total:,} events)')
                return self.window(pattern, start, mid, fields, tally) + self.window(pattern, mid, end, fields, tally)
        out, offset = [], 0
        while offset < min(total, WINDOW_CAP):
            body = {'size': PAGE, 'from': offset, 'sort': [{'logDate': 'asc'}], 'query': range_query(start, end)}
            if fields:
                body['_source'] = fields
            res = self.search(pattern, body)
            hits = res['hits']['hits']
            if not hits:
                break
            for h in hits:
                src = h['_source']
                for k in DROP:
                    src.pop(k, None)
                # Which sub-index a row came from is its event type (user-create, group-update…);
                # the ILM suffix and the restored- prefix are storage, not meaning.
                src['event'] = h['_index'].replace('restored-', '').split('-ilm')[0].split('-v2')[0]
                out.append(src)
            offset += len(hits)
            tally['rows'] += len(hits)
            progress(f'{tally["rows"]:,} rows · {self.requests} requests · up to {hits[-1]["_source"].get("logDate", "")[:10]}')
            if len(hits) < PAGE:
                break
        return out


def range_query(start, end):
    return {'range': {'logDate': {'gte': iso(start), 'lt': iso(end)}}}


def iso(d):
    return d.strftime('%Y-%m-%dT%H:%M:%S.000Z')


def tenant_of(api):
    """The tenant names itself on every row; read it off one."""
    res = api.search('provisioning-audit*', {'size': 1, 'sort': [{'logDate': 'desc'}]})
    hits = res['hits']['hits']
    if not hits:
        return {'name': '', 'tid': ''}
    t = hits[0]['_source'].get('tenant') or {}
    return {'name': t.get('tenantName', ''), 'tid': t.get('tid', '')}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--days', type=int, default=400, help='how far back to read (default 400)')
    p.add_argument('-o', '--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'helloid-audit.json'))
    p.add_argument('--insecure', action='store_true', help='skip TLS verification (corporate proxies)')
    helloid_creds.add_arguments(p)
    args = p.parse_args()

    creds = helloid_creds.resolve('elastic', args)
    url = creds['url']
    api = Elastic(url, creds['key'], creds['secret'], insecure=args.insecure)
    end = dt.datetime.now(dt.timezone.utc).replace(microsecond=0) + dt.timedelta(minutes=1)
    start = end - dt.timedelta(days=args.days)
    step(f'Connecting to {url.split("/service/")[0]}' + (f' (profile {creds["profile"]})' if creds['profile'] else '') + ' …')
    tenant = tenant_of(api)
    step(f'Tenant: {tenant["name"] or "(unnamed)"} — window {iso(start)[:10]} → {iso(end)[:10]} ({args.days} days), {len(SOURCES)} index patterns')

    out = {'kind': 'helloid-audit', 'version': 1, 'collectedAt': iso(end), 'tenant': tenant,
           'from': iso(start), 'to': iso(end), 'counts': {}}
    grand = 0
    for n, (pattern, target, fields) in enumerate(SOURCES, 1):
        step(f'({n}/{len(SOURCES)}) {pattern}')
        tally = {'rows': 0, 'splits': 0}
        before = api.requests
        rows = api.window(pattern, start, end, fields, tally)
        if sys.stdout.isatty() and tally['rows']:
            print('\r' + ' ' * 100 + '\r', end='')
        out.setdefault(target, []).extend(rows)
        out['counts'][target] = len(out[target])
        grand += len(rows)
        step(f'        {len(rows):,} rows in {api.requests - before} request(s)'
             + (f', window split {tally["splits"]}×' if tally['splits'] else '')
             + (f' → {target}' if target != pattern.rstrip('*').rstrip('-') else ''))
    for target in out['counts']:
        out[target].sort(key=lambda r: r.get('logDate', ''))

    step('Writing JSON …')
    with open(args.out, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
    size = os.path.getsize(args.out) / 1e6
    step(f'Wrote {args.out} ({size:.1f} MB) — {grand:,} rows over {api.requests} requests')
    print()
    print('Summary:')
    for target, n in out['counts'].items():
        print(f'  {target:<16} {n:>8,}')
    print()
    print('Drop the file on the dashboard under Imports → HelloID audit log. It names people and')
    print('the decisions taken about them: hand it only to the analyst who asked for it.')


if __name__ == '__main__':
    main()
