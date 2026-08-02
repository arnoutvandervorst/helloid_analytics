#!/usr/bin/env python3
"""Summarise the anonymous usage log.

    python3 usage-report.py logs/usage.log [--days 30]

The log holds a timestamp and a query string per event. There is no address, no agent
and no identifier in it, so this can only answer what was used and how often — which is
the question it exists for.
"""
import argparse
import collections
import datetime
import sys
from urllib.parse import parse_qs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('logfile')
    ap.add_argument('--days', type=int, default=30)
    args = ap.parse_args()

    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=args.days)
    events, views, imports, exports, langs, per_day = (
        collections.Counter() for _ in range(6))
    total = 0

    with open(args.logfile, encoding='utf-8', errors='replace') as fh:
        for line in fh:
            parts = line.strip().split(' ', 1)
            if len(parts) != 2:
                continue
            stamp, query = parts
            try:
                when = datetime.datetime.fromisoformat(stamp)
            except ValueError:
                continue
            if when < cutoff:
                continue
            q = parse_qs(query)
            event = (q.get('e') or ['?'])[0]
            total += 1
            events[event] += 1
            per_day[when.date().isoformat()] += 1
            if event == 'view':
                views[(q.get('v') or ['?'])[0]] += 1
            elif event == 'import':
                imports[((q.get('kind') or ['?'])[0], (q.get('size') or ['?'])[0])] += 1
            elif event == 'export':
                exports[(q.get('kind') or ['?'])[0]] += 1
            if q.get('lang'):
                langs[q['lang'][0]] += 1

    def show(title, counter, fmt=str):
        print(f'\n{title}')
        if not counter:
            print('  (none)')
        for key, n in counter.most_common(20):
            print(f'  {n:6d}  {fmt(key)}')

    print(f'{total} events in the last {args.days} days')
    show('Events', events)
    show('Views opened', views)
    show('Imports', imports, lambda k: f'{k[0]} ({k[1]} rows)')
    show('Exports', exports)
    show('Interface language', langs)
    show('Busiest days', per_day)


if __name__ == '__main__':
    sys.exit(main())
