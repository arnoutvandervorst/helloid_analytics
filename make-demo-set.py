#!/usr/bin/env python3
"""Generate a coherent, fictional set of the six HelloID exports this dashboard reads.

`make-sample.py` writes a reconciliation export on its own, which is enough to open the
tool but not enough to show what it does: the vault, the rules and the activity exports
are what turn a list of differences into explanations. Those only work if all six files
describe the *same* organisation — the same people, the same entitlements, the same
names — so they are generated together here rather than separately.

    python3 make-demo-set.py                 # -> demo/*.csv, demo/vault.json, demo/manifest.json
    python3 make-demo-set.py --rows 8000 --seed 3

Everything is invented. Names come from a fixed word list, employee numbers count up
from 500000, and the domain is avo.local — no customer data is involved, which is the
point: this is what the public deployment offers instead of asking a visitor to upload
their own tenant to see whether the tool is worth anything.

Deterministic for a given seed. Dates are anchored to --today so a regenerated set does
not silently drift into "everybody left three years ago".
"""
import argparse
import json
import os
import random
from datetime import datetime, timedelta

import importlib.util
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('make_sample', os.path.join(HERE, 'make-sample.py'))
make_sample = importlib.util.module_from_spec(spec)
spec.loader.exec_module(make_sample)

UNITS = make_sample.UNITS
SYSTEMS = make_sample.SYSTEMS
FIRST, LAST = make_sample.FIRST, make_sample.LAST

TITLES = ['Verzorgende IG', 'Verpleegkundige', 'Begeleider niveau 1', 'Begeleider niveau 3',
          'Casemanager', 'Teamleider', 'Kwaliteitsadviseur', 'Applicatiebeheerder',
          'Medewerker Salarisadministratie', 'Facilitair medewerker', 'Communicatieadviseur',
          'Inkoopadviseur', 'Wijkverpleegkundige', 'Activiteitenbegeleider']

CONTRACT_TYPES = ['Dienstverband', 'Uitzendkracht', 'Stagiair', 'Vrijwilliger']
LOCATIONS = ['Hoofdlocatie Zwolle', 'Locatie Deventer', 'Locatie Apeldoorn', 'Thuiswerkplek']

ORIGINS = ['ContractUpdate', 'PersonUpdate', 'Import', 'BusinessRuleUpdate', 'Retry',
           'ManualAction']


def unit_code(unit):
    return unit.split('-', 1)[0]


def unit_label(unit):
    return unit.split('-', 1)[1]


def csv_line(values):
    return ','.join(make_sample.csv_escape(str(v)) for v in values)


def us_stamp(dt):
    """HelloID exports dates US-formatted; the parser reads exactly this shape."""
    return dt.strftime('%m/%d/%Y %H:%M:%S')


class DemoSet:
    def __init__(self, args):
        self.args = args
        self.rnd = random.Random(args.seed)
        self.today = datetime.strptime(args.today, '%Y-%m-%d')

    # ---------------------------------------------------------------- reconciliation
    def build_recon(self):
        """Reuse the sample generator, then read its own rows back as structure."""
        gen_args = argparse.Namespace(
            rows=self.args.rows, seed=self.args.seed, systems=self.args.systems,
            orphan_rate=0.12, disabled_rate=0.10, stacked_rate=0.08,
            missing_rate=0.05, baseline_coverage=0.88)
        lines = make_sample.Generator(gen_args).run()
        self.recon_lines = lines

        header = lines[0].split(',')
        idx = {name: i for i, name in enumerate(header)}
        rows = [self.split(line) for line in lines[1:]]

        accounts = {}
        for r in rows:
            key = (r[idx['System']], r[idx['AccountUserName']])
            acc = accounts.setdefault(key, {
                'system': r[idx['System']], 'user': r[idx['AccountUserName']],
                'display': r[idx['AccountDisplayName']], 'person': '',
                'enabled': r[idx['AccountEnabled']] == 'True', 'perms': []
            })
            if r[idx['Person']]:
                acc['person'] = r[idx['Person']]
            perm = r[idx['PermissionDisplayName']]
            if perm and r[idx['Issue']] != 'Permission missing':
                acc['perms'].append(perm)
        self.accounts = list(accounts.values())
        return lines

    @staticmethod
    def split(line):
        """The generator quotes minimally, so a tiny reader is enough."""
        out, field, in_q = [], '', False
        for ch in line:
            if in_q:
                if ch == '"':
                    in_q = False
                else:
                    field += ch
            elif ch == '"':
                in_q = True
            elif ch == ',':
                out.append(field)
                field = ''
            else:
                field += ch
        out.append(field)
        return out

    # ------------------------------------------------------------------------ vault
    def build_vault(self):
        """People and contracts for the accounts that have an owner, plus leavers.

        Two groups matter for what the dashboard demonstrates: correlated staff, whose
        rows the tool can explain outright, and people whose contract ended while an
        account of theirs is still enabled — the finding that costs money and risk.
        """
        rnd = self.rnd
        persons = []
        seen = set()

        owned = [a for a in self.accounts if a['person']]
        for acc in owned:
            display = acc['person']                       # "Name (500123)"
            if display in seen:
                continue
            seen.add(display)
            name, ext = display.rsplit(' (', 1)
            ext = ext.rstrip(')')
            persons.append(self.person(name, ext, acc, leaver=False))

        # Leavers: unowned accounts whose display name still carries a person's name.
        unowned = [a for a in self.accounts
                   if not a['person'] and '(' in a['display'] and 'Service' not in a['display']]
        for acc in rnd.sample(unowned, min(len(unowned), int(len(unowned) * 0.55))):
            name = acc['display'].split(' (')[0]
            ext = str(600000 + len(persons))
            display = f'{name} ({ext})'
            if display in seen:
                continue
            seen.add(display)
            persons.append(self.person(name, ext, acc, leaver=True))

        departments = [{
            'ExternalId': unit_code(u), 'DisplayName': unit_label(u), 'Code': unit_code(u),
            'ParentExternalId': '', 'Manager': {}
        } for u in UNITS]

        self.vault = {'Persons': persons, 'Departments': departments}
        self.person_by_display = {p['DisplayName']: p for p in persons}
        return self.vault

    def person(self, name, ext, acc, leaver):
        rnd = self.rnd
        unit = rnd.choice(UNITS)
        title = rnd.choice(TITLES)
        first, last = (name.split(' ', 1) + [''])[:2]

        start = self.today - timedelta(days=rnd.randint(120, 3000))
        end = None
        if leaver:
            # Long enough ago that nobody can argue the account is "still being wrapped up".
            end = self.today - timedelta(days=rnd.randint(20, 400))
        elif rnd.random() < 0.08:
            # A contract that ends soon: the "act before it becomes residue" case.
            end = self.today + timedelta(days=rnd.randint(5, 120))

        contract = {
            'ExternalId': f'{ext}-1',
            'StartDate': start.strftime('%Y-%m-%dT00:00:00Z'),
            'EndDate': end.strftime('%Y-%m-%dT00:00:00Z') if end else None,
            'Type': {'Code': rnd.choice(CONTRACT_TYPES), 'Name': rnd.choice(CONTRACT_TYPES)},
            'Department': {'ExternalId': unit_code(unit), 'DisplayName': unit_label(unit),
                           'Code': unit_code(unit)},
            'Title': {'Code': title, 'Name': title},
            'Location': {'Name': rnd.choice(LOCATIONS)},
            'CostCenter': {'Code': f'KP{rnd.randint(100, 999)}'},
            'Employer': {'Code': 'AVO', 'Name': 'Avondrood Zorggroep'},
            'Details': {'Sequence': 1},
            'Custom': {}
        }
        contracts = [contract]

        # A second contract for some: two departments, which is where rule conditions
        # stop being a single lookup and start needing a "which contract?" answer.
        if not leaver and rnd.random() < 0.18:
            other = rnd.choice([u for u in UNITS if u != unit])
            second = json.loads(json.dumps(contract))
            second['ExternalId'] = f'{ext}-2'
            second['Department'] = {'ExternalId': unit_code(other), 'DisplayName': unit_label(other),
                                    'Code': unit_code(other)}
            second['Details'] = {'Sequence': 2}
            contracts.append(second)

        person = {
            'PersonId': f'p-{ext}',
            'ExternalId': ext,
            'DisplayName': f'{name} ({ext})',
            'UserName': acc['user'],
            'Name': {'GivenName': first, 'FamilyName': last, 'NickName': first},
            'Status': {'Blocked': False},
            'Excluded': False,
            'Contracts': contracts,
            'PrimaryContract': contracts[0],
            'Custom': {},
            'Accounts': []
        }
        # Only some accounts are correlated in the vault. The rest is what the fallback
        # matching is for, and a demo that hides that would flatter the tool.
        if not leaver and rnd.random() < 0.7:
            person['Accounts'] = [{
                'SystemIdentifier': acc['system'],
                'Data': {'sAMAccountName': acc['user'], 'displayName': acc['display'],
                         'userPrincipalName': f"{acc['user']}@avo.local"}
            }]
        return person

    # ------------------------------------------------------------------------ rules
    def build_rules(self):
        """Rules over the units that exist, deliberately not covering all of them."""
        rnd = self.rnd
        system = SYSTEMS[0]
        rows = []
        self.ruled_perms = set()

        covered = UNITS[:int(len(UNITS) * 0.6)]           # the rest is the unmodelled backlog
        for unit in covered:
            perms = make_sample.unit_groups(unit)[:4]
            ents = [f'{system} - Account'] + [
                f'{system} - {p} (avo.local/Sample/Groups/{p})' for p in perms]
            self.ruled_perms.update(perms)
            rows.append({
                'Name': f'Toegang - {unit_label(unit)}',
                'EntitlementCount': len(ents),
                'PersonsLatestEvaluation': rnd.randint(4, 60),
                'Categories': 'Afdeling',
                'Status': 'published',
                'Conditions': '|'.join([
                    'Person: active',
                    'Time frame: days before start date: 14, days after end date: 0',
                    f'Department.ExternalId, one of: {unit_code(unit)}'
                ]),
                'Entitlements': '|'.join(ents)
            })

        # Baseline rule: what everyone gets, which is why those rows are not findings.
        base = make_sample.SECURITY + make_sample.FREE_APPS[:3]
        self.ruled_perms.update(base)
        rows.append({
            'Name': 'Basis - Alle medewerkers',
            'EntitlementCount': len(base) + 1,
            'PersonsLatestEvaluation': len(self.vault['Persons']),
            'Categories': 'Basis',
            'Status': 'published',
            'Conditions': 'Person: active',
            'Entitlements': '|'.join([f'{system} - Account'] + [
                f'{system} - {p} (avo.local/Sample/Groups/{p})' for p in base])
        })

        # Title-based rule: the shape that shows conditions can address more than a
        # department, and the one most likely to select nobody after a title is renamed.
        title_perm = make_sample.PAID_APPS[0]
        self.ruled_perms.add(title_perm)
        rows.append({
            'Name': 'Applicatie - Copilot voor casemanagers',
            'EntitlementCount': 1,
            'PersonsLatestEvaluation': 0,
            'Categories': 'Applicatie',
            'Status': 'published',
            'Conditions': "Person: active|Title.Name, one of: Casemanager, Begeleider niveau 1",
            'Entitlements': f'{system} - {title_perm} (avo.local/Sample/Groups/{title_perm})'
        })

        # A draft rule: written, never published, so its entitlements are modelled on
        # paper and unmanaged in reality.
        draft_unit = UNITS[-1]
        draft_perms = make_sample.unit_groups(draft_unit)[:3]
        rows.append({
            'Name': f'Concept - {unit_label(draft_unit)}',
            'EntitlementCount': len(draft_perms),
            'PersonsLatestEvaluation': 0,
            'Categories': 'Afdeling',
            'Status': 'draft',
            'Conditions': f'Person: active|Department.ExternalId, one of: {unit_code(draft_unit)}',
            'Entitlements': '|'.join(
                f'{system} - {p} (avo.local/Sample/Groups/{p})' for p in draft_perms)
        })

        # A rule pointing at a group that no longer exists in the target system.
        rows.append({
            'Name': 'Toegang - Oud project Zorgdossier',
            'EntitlementCount': 1,
            'PersonsLatestEvaluation': 3,
            'Categories': 'Project',
            'Status': 'published',
            'Conditions': 'Person: active|Department.ExternalId, one of: XX99',
            'Entitlements': f'{system} - APP-Zorgdossier-Legacy (avo.local/Sample/Groups/APP-Zorgdossier-Legacy)'
        })
        self.stale_entitlement = 'APP-Zorgdossier-Legacy'

        header = ['Name', 'EntitlementCount', 'PersonsLatestEvaluation', 'Categories',
                  'Status', 'Conditions', 'Entitlements']
        self.rules_rows = rows
        return [csv_line(header)] + [csv_line([r[h] for h in header]) for r in rows]

    # -------------------------------------------------------------------- catalogue
    def build_catalogue(self):
        """One row per entitlement HelloID knows, with its rule count and target state."""
        rnd = self.rnd
        counts = {}
        for r in self.rules_rows:
            for ent in r['Entitlements'].split('|'):
                name = ent.split(' - ', 1)[1]
                counts[name] = counts.get(name, 0) + 1

        seen = {}
        for acc in self.accounts:
            for perm in acc['perms']:
                seen.setdefault((acc['system'], perm), True)
        for system in SYSTEMS[:self.args.systems]:
            seen[(system, 'Account')] = True
        # The rule points at it; the target system no longer has it.
        seen[(SYSTEMS[0], f'{self.stale_entitlement} (avo.local/Sample/Groups/{self.stale_entitlement})')] = True

        lines = [csv_line(['SystemDisplayName', 'EntitlementDisplayName', 'RulesCount', 'InTargetSystem'])]
        for (system, perm) in sorted(seen):
            bare = perm.split(' (')[0]
            count = counts.get(perm, counts.get(bare, 0))
            if bare == 'Account':
                count = max(count, 1)
            gone = bare == self.stale_entitlement or (bare != 'Account' and rnd.random() < 0.012)
            lines.append(csv_line([system, perm, count, 'False' if gone else 'True']))
        return lines

    # ---------------------------------------------------------------------- granted
    def build_granted(self):
        """What HelloID says it granted — a subset, so both answers appear in the data."""
        rnd = self.rnd
        lines = [csv_line(['Person', 'System', 'EntitlementName',
                           'PermissionConfigurationDisplayName', 'LastChangedOn'])]
        self.granted_pairs = []
        for acc in self.accounts:
            if not acc['person']:
                continue
            for perm in acc['perms']:
                bare = perm.split(' (')[0]
                # Rules-covered entitlements are the ones HelloID would have granted.
                if bare not in self.ruled_perms or rnd.random() > 0.75:
                    continue
                when = self.today - timedelta(days=rnd.randint(1, 500),
                                              hours=rnd.randint(0, 23), minutes=rnd.randint(0, 59))
                lines.append(csv_line([acc['person'], acc['system'], perm, '', us_stamp(when)]))
                self.granted_pairs.append((acc['person'], acc['system'], perm, when))
        return lines

    # ---------------------------------------------------------------------- history
    def build_history(self):
        """What HelloID did, including what it tried and could not do."""
        rnd = self.rnd
        lines = [csv_line(['Person', 'System', 'EntitlementName', 'Operation', 'CreatedOn',
                           'FinishedOn', 'Origins', 'Result'])]

        def row(person, system, ent, op, when, result, origins):
            # Nothing HelloID has already done can carry a future date; the chained
            # revoke/re-grant offsets below would otherwise walk past today.
            when = min(when, self.today - timedelta(hours=1))
            finished = when + timedelta(seconds=rnd.randint(1, 90))
            lines.append(csv_line([person, system, ent, op, us_stamp(when), us_stamp(finished),
                                   '|'.join(origins), result]))

        for person, system, ent, when in self.granted_pairs:
            row(person, system, ent, 'Grant', when, 'Succeeded',
                [rnd.choice(ORIGINS[:4])])
            # A few are revoked and granted again: a rule whose condition flips.
            if rnd.random() < 0.04:
                back = when + timedelta(days=rnd.randint(1, 60))
                row(person, system, ent, 'Revoke', back, 'Succeeded', ['ContractUpdate'])
                row(person, system, ent, 'Grant', back + timedelta(days=rnd.randint(1, 20)),
                    'Succeeded', ['ContractUpdate'])

        # Failures and blocked actions, on entitlements the reconciliation reports as
        # missing — the pairing that turns "not there" into "attempted on this date".
        owned = [a for a in self.accounts if a['person']]
        for acc in rnd.sample(owned, min(len(owned), 60)):
            perm = rnd.choice(make_sample.SECURITY + make_sample.FREE_APPS)
            ent = f'{perm} (avo.local/Sample/Groups/{perm})'
            when = self.today - timedelta(days=rnd.randint(1, 90))
            if rnd.random() < 0.6:
                row(acc['person'], acc['system'], ent, 'Grant', when, 'Failed',
                    ['BusinessRuleUpdate', 'Retry'])
            else:
                row(acc['person'], acc['system'], ent, 'Grant', when, 'Skipped',
                    ['ContractUpdate', 'Blocked: person excluded'])
        return lines

    # ------------------------------------------------------------------------ write
    def run(self, outdir):
        os.makedirs(outdir, exist_ok=True)
        recon = self.build_recon()
        self.build_vault()
        rules = self.build_rules()
        catalogue = self.build_catalogue()
        granted = self.build_granted()
        history = self.build_history()

        files = {
            'recon.csv': '\n'.join(recon) + '\n',
            'rules.csv': '\n'.join(rules) + '\n',
            'catalogue.csv': '\n'.join(catalogue) + '\n',
            'granted.csv': '\n'.join(granted) + '\n',
            'history.csv': '\n'.join(history) + '\n',
            'vault.json': json.dumps(self.vault, indent=1, ensure_ascii=False) + '\n'
        }
        for name, text in files.items():
            with open(os.path.join(outdir, name), 'w', encoding='utf-8') as fh:
                fh.write(text)

        manifest = {
            'kind': 'helloid-analytics-demo',
            'generatedOn': self.today.strftime('%Y-%m-%d'),
            'seed': self.args.seed,
            'synthetic': True,
            'files': [
                {'slot': 'recon', 'file': 'recon.csv'},
                {'slot': 'vault', 'file': 'vault.json'},
                {'slot': 'rules', 'file': 'rules.csv'},
                {'slot': 'granted', 'file': 'granted.csv'},
                {'slot': 'history', 'file': 'history.csv'},
                {'slot': 'catalogue', 'file': 'catalogue.csv'}
            ]
        }
        with open(os.path.join(outdir, 'manifest.json'), 'w', encoding='utf-8') as fh:
            json.dump(manifest, fh, indent=1)
            fh.write('\n')

        for name in list(files) + ['manifest.json']:
            path = os.path.join(outdir, name)
            print(f'{path}: {os.path.getsize(path) // 1024} KiB')
        print(f"{len(recon) - 1} reconciliation rows, {len(self.vault['Persons'])} persons, "
              f'{len(self.rules_rows)} rules, {len(catalogue) - 1} entitlements, '
              f'{len(granted) - 1} granted, {len(history) - 1} actions')


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--rows', type=int, default=5000, help='reconciliation rows (default 5000)')
    p.add_argument('--seed', type=int, default=1, help='random seed; same seed gives the same set')
    p.add_argument('--systems', type=int, default=1, choices=[1, 2, 3])
    p.add_argument('--today', default=datetime.now().strftime('%Y-%m-%d'),
                   help='anchor date for contracts and activity (default: today)')
    p.add_argument('-o', '--out', default='demo', help='output directory (default: demo)')
    args = p.parse_args()
    DemoSet(args).run(args.out)


if __name__ == '__main__':
    main()
