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
    """How access is shaped, and why it matters that the demo shapes it this way.

    Randomly assigned entitlements produce an organisation with no structure to find, and
    a role miner run against that finds nothing — which flatters nobody and misleads
    anybody looking at the demo. Real access is layered: everybody gets a floor, a
    department shares a working set, a job title adds a little on top of it, a location
    adds its printer, and a handful of people carry things nobody around them has.

    So that is what this builds, with enough noise that nothing is perfectly clean:
    somebody is always missing what their department has, and a few carry access their
    peers do not.
    """

    def access_model(self):
        """Fix, per organisation, what each department, title and location grants."""
        rnd = self.rnd
        model = {'department': {}, 'title': {}, 'location': {}}

        for unit in UNITS:
            code = unit_code(unit)
            model['department'][unit] = [
                f'APP-{code}-Portal', f'FS-{code}-RO', f'FS-{code}-RW',
                f'TEAM-{code}', f'MBX-{code}'
            ]
        for title in TITLES:
            slug = title.split()[0].replace('/', '')
            extras = [f'ROLE-{slug}']
            if rnd.random() < 0.5:
                extras.append(rnd.choice(make_sample.PAID_APPS))
            if rnd.random() < 0.25:
                extras.append(f'FS-{slug}-DATA')
            model['title'][title] = extras
        for location in LOCATIONS:
            slug = location.split()[-1]
            model['location'][location] = [f'PRINT-{slug}', 'WIFI-Personeel']

        # The floor: everybody has these, give or take the people who slipped through.
        model['baseline'] = make_sample.SECURITY + ['APP-Intranet', 'APP-Office365']
        return model

    def entitlements_for(self, contract, licence):
        """What one person holds: floor, department, title, location, plus a little noise."""
        rnd = self.rnd
        model = self.model
        out = []

        for ent in model['baseline']:
            if rnd.random() < 0.94:                       # a few never got the floor
                out.append(ent)
        for ent in model['department'][contract['unit']]:
            if rnd.random() < 0.93:                       # and a few missed their department
                out.append(ent)
        for ent in model['title'][contract['title']]:
            if rnd.random() < 0.9:
                out.append(ent)
        for ent in model['location'][contract['location']]:
            if rnd.random() < 0.85:
                out.append(ent)
        out.append(licence)

        # Access that travelled with the person rather than with the job.
        if rnd.random() < 0.12:
            for ent in rnd.sample(make_sample.PAID_APPS + make_sample.FREE_APPS, rnd.randint(1, 2)):
                out.append(ent)
        if rnd.random() < 0.06:
            other = rnd.choice([u for u in UNITS if u != contract['unit']])
            out += rnd.sample(model['department'][other], 2)
        return list(dict.fromkeys(out))

    def build_recon(self):
        """People first, then the access their job implies, then the export that reports it."""
        rnd = self.rnd
        self.model = self.access_model()
        system = SYSTEMS[0]
        rows = []
        self.accounts = []
        self.people = []

        for i in range(self.args.people):
            first, last = rnd.choice(FIRST), rnd.choice(LAST)
            name = f'{first} {last}'
            ext = str(500000 + i)
            unit = rnd.choice(UNITS)
            contract = {
                'unit': unit,
                'title': rnd.choice(TITLES),
                'location': rnd.choice(LOCATIONS),
                'type': rnd.choice(CONTRACT_TYPES)
            }
            slug = (first + '.' + last.split()[-1]).lower().replace('ë', 'e').replace(' ', '')
            user = f'{slug}{i % 97}'
            licence = rnd.choice(make_sample.LICENCES)
            leaver = rnd.random() < 0.08

            person = {'name': name, 'ext': ext, 'contract': contract, 'leaver': leaver,
                      'user': user, 'display': name}
            self.people.append(person)

            enabled = leaver or rnd.random() > 0.06
            perms = self.entitlements_for(contract, licence)
            acc = {'system': system, 'user': user, 'display': name,
                   'person': f'{name} ({ext})', 'enabled': enabled, 'perms': [],
                   'owner': person}
            for perm in perms:
                path = f'avo.local/Demo/Groups/{perm}'
                acc['perms'].append(f'{perm} ({path})')
                rows.append(csv_line([system, acc['person'], name, user, 'True' if enabled else 'False',
                                      f'{perm} ({path})', '', '', 'Permission unmanaged', 'None']))
            # Occasionally the reconciliation reports something a rule owes but nobody has.
            if rnd.random() < 0.05:
                missing = rnd.choice(self.model['department'][unit])
                if f'{missing} (avo.local/Demo/Groups/{missing})' not in acc['perms']:
                    rows.append(csv_line([system, acc['person'], name, user, 'True' if enabled else 'False',
                                          f'{missing} (avo.local/Demo/Groups/{missing})', '', '',
                                          'Permission missing', 'None']))
            self.accounts.append(acc)

        # Accounts nobody owns: admin, service and test, the way a directory accumulates them.
        for i in range(self.args.orphans):
            kind = rnd.choice(['adm', 'svc', 'test'])
            if kind == 'adm':
                victim = rnd.choice(self.people)
                user = 'adm-' + victim['user']
                display = victim['name'] + ' (admin)'
                perms = rnd.sample(make_sample.PRIVILEGED, rnd.randint(1, 3))
            elif kind == 'svc':
                user = f'svc-{unit_code(rnd.choice(UNITS)).lower()}{i}'
                display = 'Service account ' + user
                perms = rnd.sample(make_sample.SERVER, rnd.randint(1, 3))
            else:
                victim = rnd.choice(self.people)
                user = 'test.' + victim['user']
                display = victim['name'] + ' (test)'
                perms = rnd.sample(make_sample.FREE_APPS, 2) + [rnd.choice(make_sample.LICENCES)]

            enabled = rnd.random() > 0.25
            acc = {'system': system, 'user': user, 'display': display, 'person': '',
                   'enabled': enabled, 'perms': [], 'owner': None}
            rows.append(csv_line([system, '', display, user, 'True' if enabled else 'False',
                                  '', '', '', 'Account unmanaged',
                                  'Excluded' if rnd.random() < 0.08 else 'None']))
            for perm in perms:
                path = f'avo.local/Demo/Groups/{perm}'
                acc['perms'].append(f'{perm} ({path})')
                rows.append(csv_line([system, '', display, user, 'True' if enabled else 'False',
                                      f'{perm} ({path})', '', '', 'Permission unmanaged', 'None']))
            self.accounts.append(acc)

        rnd.shuffle(rows)
        self.recon_lines = [make_sample.HEADER] + rows
        return self.recon_lines

    # ------------------------------------------------------------------------ vault
    def build_vault(self):
        """People and contracts for the population the reconciliation describes."""
        persons = []
        for p in self.people:
            persons.append(self.person(p['name'], p['ext'], p, p['leaver']))
        departments = [{
            'ExternalId': unit_code(u), 'DisplayName': unit_label(u), 'Code': unit_code(u),
            'ParentExternalId': '', 'Manager': {}
        } for u in UNITS]
        self.vault = {'Persons': persons, 'Departments': departments}
        self.person_by_display = {p['DisplayName']: p for p in persons}
        return self.vault

    def person(self, name, ext, src, leaver):
        rnd = self.rnd
        unit = src['contract']['unit']
        title = src['contract']['title']
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
            'Type': (lambda t: {'Code': t, 'Name': t})(src['contract']['type']),
            'Department': {'ExternalId': unit_code(unit), 'DisplayName': unit_label(unit),
                           'Code': unit_code(unit)},
            'Title': {'Code': title, 'Name': title},
            'Location': {'Name': src['contract']['location']},
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
            'UserName': src['user'],
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
                'SystemIdentifier': SYSTEMS[0],
                'Data': {'sAMAccountName': src['user'], 'displayName': name,
                         'userPrincipalName': f"{src['user']}@avo.local"}
            }]
        return person

    # ------------------------------------------------------------------------ rules
    def build_rules(self):
        """Rules over the same structure the access follows — but not all of it.

        A tenant that has modelled everything has nothing for this tool to find, so the
        rules cover the departments and a few titles and leave the rest: what remains is
        the backlog the comparison is supposed to surface.
        """
        rnd = self.rnd
        system = SYSTEMS[0]
        rows = []
        ent = lambda name: f'{system} - {name} (avo.local/Demo/Groups/{name})'

        rows.append({
            'Name': 'Basis - Alle medewerkers',
            'EntitlementCount': len(self.model['baseline']) + 1,
            'PersonsLatestEvaluation': len(self.people),
            'Categories': 'Basis',
            'Status': 'published',
            'Conditions': 'Person: active',
            'Entitlements': '|'.join([f'{system} - Account'] + [ent(e) for e in self.model['baseline']])
        })

        covered = UNITS[:int(len(UNITS) * 0.6)]        # the rest is the unmodelled backlog
        for unit in covered:
            ents = self.model['department'][unit]
            rows.append({
                'Name': f'Toegang - {unit_label(unit)}',
                'EntitlementCount': len(ents) + 1,
                'PersonsLatestEvaluation': sum(1 for p in self.people if p['contract']['unit'] == unit),
                'Categories': 'Afdeling',
                'Status': 'published',
                'Conditions': '|'.join([
                    'Person: active',
                    'Time frame: days before start date: 14, days after end date: 0',
                    f'Department.ExternalId, one of: {unit_code(unit)}'
                ]),
                'Entitlements': '|'.join([f'{system} - Account'] + [ent(e) for e in ents])
            })

        # A title rule that spans departments, which is the shape the pyramid cannot nest.
        for title in TITLES[:3]:
            ents = self.model['title'][title]
            if not ents:
                continue
            rows.append({
                'Name': f'Functie - {title}',
                'EntitlementCount': len(ents),
                'PersonsLatestEvaluation': sum(1 for p in self.people if p['contract']['title'] == title),
                'Categories': 'Functie',
                'Status': 'published',
                'Conditions': f'Person: active|Title.Name, one of: {title}',
                'Entitlements': '|'.join(ent(e) for e in ents)
            })

        # One rule written and never published: modelled on paper, unmanaged in reality.
        draft_unit = UNITS[-1]
        rows.append({
            'Name': f'Concept - {unit_label(draft_unit)}',
            'EntitlementCount': 3,
            'PersonsLatestEvaluation': 0,
            'Categories': 'Afdeling',
            'Status': 'draft',
            'Conditions': f'Person: active|Department.ExternalId, one of: {unit_code(draft_unit)}',
            'Entitlements': '|'.join(ent(e) for e in self.model['department'][draft_unit][:3])
        })

        # And one pointing at a group the target system no longer has.
        self.stale_entitlement = 'APP-Zorgdossier-Legacy'
        rows.append({
            'Name': 'Toegang - Oud project Zorgdossier',
            'EntitlementCount': 1,
            'PersonsLatestEvaluation': 3,
            'Categories': 'Project',
            'Status': 'published',
            'Conditions': 'Person: active|Department.ExternalId, one of: XX99',
            'Entitlements': ent(self.stale_entitlement)
        })

        header = ['Name', 'EntitlementCount', 'PersonsLatestEvaluation', 'Categories',
                  'Status', 'Conditions', 'Entitlements']
        # What the published rules hand out, which is what HelloID would have granted.
        self.ruled_perms = set()
        for r in rows:
            if r['Status'] != 'published':
                continue
            for e in r['Entitlements'].split('|'):
                name = e.split(' - ', 1)[1].split(' (')[0]
                self.ruled_perms.add(name)
        self.rules_rows = rows
        return [csv_line(header)] + [csv_line([r[h] for h in header]) for r in rows]

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

    # ------------------------------------------------------- Service Automation
    def build_products(self):
        """Products people request, and what each one is worth or risks.

        Named after the applications the reconciliation already contains, because that is
        how tenants name them and it is what the product-to-entitlement matcher has to
        work with. Whether a name resembling a group means anything is exactly the
        question the Products view asks a human to answer, so the demo has to contain
        both honest matches and tempting near-misses.
        """
        rnd = self.rnd
        catalogue = [
            # name, entitlement it really grants (or None), price, risk, time limit days
            ('PowerBI Pro', 'APP-PowerBI-Pro', '9,90', None, None),
            ('Copilot', 'APP-Copilot', '28,00', None, None),
            ('Adobe Acrobat Pro', 'APP-Adobe-AcrobatPro', '17,50', None, None),
            ('Visio', 'APP-Visio', '12,00', None, 600),
            ('Project', 'APP-Project', '25,00', None, None),
            ('Beheerderstoegang AD', 'ADMIN-AD-Beheer', None, 9, 5),
            ('Exchange-beheer', 'ADMIN-Exchange-Beheer', None, 8, 5),
            ('Noodprocedure breakglass', 'PRIV-Noodprocedure-Breakglass', None, 10, 1),
            ('Thuiswerkplek', 'VPN-Thuiswerken', None, 3, None),
            ('Mobiele telefoon', None, '32,00', 2, None),
            ('Laptop', None, '45,00', 4, None),
            ('Parkeerplaats', None, '85,00', None, None),
            ('Tweede beeldscherm', None, '18,00', None, None),
            ('Toegangspas hoofdlocatie', None, None, 5, None)
        ]

        products = []
        self.product_grants = {}
        for i, (name, ent, price, risk, limit) in enumerate(catalogue):
            if ent:
                self.product_grants[name] = ent
            products.append({
                'productId': f'p{i:04d}-demo-0000-0000-000000000000',
                'name': name,
                'description': f'{name} \u2014 aan te vragen via de selfservice-catalogus.',
                'code': f'2024{i:04d}DEMO',
                'categories': [{'id': f'cat-{i % 4}'}],
                'resourceOwnerGroup': {'name': 'ROLE-KWA07-Kwaliteit'} if i % 3 == 0 else {},
                'approvalWorkflow': {'name': 'Manager' if risk else 'Auto Approve'},
                'price': price or '',
                'showPrice': bool(price),
                'hasRiskFactor': risk is not None,
                'riskFactor': risk,
                'hasTimeLimit': limit is not None,
                # HelloID states this in minutes; the tool reads it back as days.
                'ownershipMaxDuration': (limit * 1440) if limit else 60,
                'limitType': 'Maximum',
                # Physical items do not come back when an account is disabled; access should.
                'returnOnUserDisable': ent is not None and risk is None,
                'visibility': 'All',
                'isEnabled': True,
                'actions': []
            })
        return {
            'kind': 'helloid-products',
            'source': '/products',
            'tenant': 'demo.helloid.com',
            'products': products
        }

    def build_assignments(self):
        """Who holds which product.

        Assignments are drawn from the people who already hold the entitlement the
        product grants, so the holder-overlap check has something true to confirm. The
        rest of the catalogue \u2014 laptops, passes, parking \u2014 grants nothing in the
        directory and exists to show what a product without an entitlement looks like.
        """
        rnd = self.rnd
        holders_by_perm = {}
        for acc in self.accounts:
            if not acc['person']:
                continue
            login = acc['user'] + '@avondrood.local'
            for perm in acc['perms']:
                holders_by_perm.setdefault(perm.split(' (')[0], []).append((login, acc))

        approvers = ['Teamleider Zorg', 'Manager Bedrijfsvoering', 'Hoofd ICT']
        # People whose contracts have all ended, so the demo carries the case where a
        # product outlives the person's employment.
        leavers = [p_['UserName'] + '@avondrood.local' for p_ in self.vault['Persons']
                   if p_['UserName'] and p_['Contracts']
                   and all(c.get('EndDate') and c['EndDate'][:10] < self.today.strftime('%Y-%m-%d')
                           for c in p_['Contracts'])]
        rows = [csv_line(['AssignmentGuid', 'UserName', 'UserGuid', 'ProductName', 'ProductGuid',
                          'ProductSku', 'RequestedAt', 'ApprovedAt', 'ReturnDate', 'Source',
                          'ApprovedBy', 'ApprovalComment', 'Approved'])]
        n = 0
        everyone = [(a['user'] + '@avondrood.local', a) for a in self.accounts if a['person']]

        for product in self.products['products']:
            name = product['name']
            ent = self.product_grants.get(name)
            pool = holders_by_perm.get(ent, []) if ent else rnd.sample(
                everyone, min(len(everyone), rnd.randint(8, 30)))
            # Privileged groups sit on admin accounts that belong to nobody, so nobody
            # would hold the product either. A few people request it regardless \u2014
            # which is exactly the population a risk factor is meant to surface.
            if ent and not pool:
                pool = rnd.sample(everyone, min(len(everyone), rnd.randint(3, 8)))
            if ent and pool:
                # Most holders requested it; a few hold it without ever having done so,
                # which is the gap between "granted by a product" and "granted somehow".
                pool = rnd.sample(pool, max(1, min(len(pool), int(len(pool) * 0.8))))

            if leavers and rnd.random() < 0.4:
                for login in rnd.sample(leavers, min(len(leavers), rnd.randint(1, 3))):
                    pool = pool + [(login, None)]

            for login, acc in pool:
                n += 1
                requested = self.today - timedelta(days=rnd.randint(20, 1500),
                                                   hours=rnd.randint(0, 23))
                approved = requested + timedelta(hours=rnd.randint(1, 72))
                if approved > self.today:
                    approved = self.today - timedelta(hours=1)
                # A handful approved by the requester: the control that was skipped.
                self_approved = rnd.random() < 0.03
                approver = login if self_approved else (
                    rnd.choice(approvers) if product['hasRiskFactor'] else '')
                returned = ''
                if rnd.random() < 0.05:
                    returned = (approved + timedelta(days=rnd.randint(30, 400))).strftime('%Y-%m-%dT%H:%M:%S')
                rows.append(csv_line([
                    f'a{n:05d}-demo', login, f'u{n:05d}', name, product['productId'],
                    product['code'], requested.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3],
                    approved.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3], returned, '',
                    approver, 'Akkoord' if approver else '',
                    'True' if approver else ''
                ]))
        return rows

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
        granted = self.build_granted()
        history = self.build_history()
        self.products = self.build_products()
        assignments = self.build_assignments()

        files = {
            'recon.csv': '\n'.join(recon) + '\n',
            'rules.csv': '\n'.join(rules) + '\n',
            'granted.csv': '\n'.join(granted) + '\n',
            'history.csv': '\n'.join(history) + '\n',
            'vault.json': json.dumps(self.vault, indent=1, ensure_ascii=False) + '\n',
            'products.json': json.dumps(self.products, indent=1, ensure_ascii=False) + '\n',
            'product-assignments.csv': '\n'.join(assignments) + '\n'
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
                {'slot': 'products', 'file': 'products.json'},
                {'slot': 'assignments', 'file': 'product-assignments.csv'}
            ]
        }
        with open(os.path.join(outdir, 'manifest.json'), 'w', encoding='utf-8') as fh:
            json.dump(manifest, fh, indent=1)
            fh.write('\n')

        for name in list(files) + ['manifest.json']:
            path = os.path.join(outdir, name)
            print(f'{path}: {os.path.getsize(path) // 1024} KiB')
        print(f"{len(recon) - 1} reconciliation rows, {len(self.vault['Persons'])} persons, "
              f'{len(self.rules_rows)} rules, '
              f'{len(granted) - 1} granted, {len(history) - 1} actions, '
              f"{len(self.products['products'])} products, {len(assignments) - 1} assignments")


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--people', type=int, default=320, help='people in the organisation (default 320)')
    p.add_argument('--orphans', type=int, default=45, help='accounts nobody owns (default 45)')
    p.add_argument('--seed', type=int, default=1, help='random seed; same seed gives the same set')
    p.add_argument('--systems', type=int, default=1, choices=[1, 2, 3])
    p.add_argument('--today', default=datetime.now().strftime('%Y-%m-%d'),
                   help='anchor date for contracts and activity (default: today)')
    p.add_argument('-o', '--out', default='demo', help='output directory (default: demo)')
    args = p.parse_args()
    DemoSet(args).run(args.out)


if __name__ == '__main__':
    main()
