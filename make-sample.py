#!/usr/bin/env python3
"""Generate a synthetic HelloID reconciliation export.

No real data ships with this repository — customer exports carry account and person
names. This writes a fictional one with the same shape, so the dashboard has something
to open, and so every finding rule has something to fire on.

    python3 make-sample.py                        # 5,000 rows -> sample-recon.csv
    python3 make-sample.py --rows 50000           # a big one, for performance work
    python3 make-sample.py --systems 2 -o two.csv # multi-system export
    python3 make-sample.py --seed 7               # a different, still reproducible set

The output is deterministic for a given seed and row count, so two runs can be diffed
against each other in the app by changing only --seed or --drift.
"""
import argparse
import random
import sys

HEADER = ('System,Person,AccountDisplayName,AccountUserName,AccountEnabled,'
          'PermissionDisplayName,PermissionConfigurationDisplayName,'
          'SubPermissionDisplayName,Issue,Resolution')

FIRST = ['Anne', 'Bram', 'Cato', 'Daan', 'Eva', 'Finn', 'Gijs', 'Hanna', 'Iris', 'Jasper',
         'Kim', 'Lars', 'Mila', 'Noa', 'Olivier', 'Pien', 'Quinten', 'Roos', 'Sem', 'Tess',
         'Ursula', 'Vera', 'Wout', 'Xander', 'Yara', 'Zoë',
         'Aafke', 'Bas', 'Carlijn', 'Dirk', 'Elise', 'Floris', 'Guusje', 'Hidde', 'Isa', 'Joris',
         'Karlijn', 'Lotte', 'Maarten', 'Nienke', 'Otto', 'Puck', 'Rens', 'Sanne', 'Thijs', 'Tijn',
         'Veerle', 'Wessel', 'Ymke', 'Zef', 'Amber', 'Bart', 'Daphne', 'Emma', 'Fenna', 'Gerben',
         'Hugo', 'Jelle', 'Jet', 'Koen', 'Lieke', 'Mees', 'Nora', 'Pepijn', 'Rosa', 'Stijn',
         'Sofie', 'Teun', 'Willem', 'Yfke']
LAST = ['Aalbers', 'Berkhout', 'Coenen', 'Dijkgraaf', 'Elzinga', 'Fokkema', 'Gerritsen',
        'Hoekstra', 'Ipenburg', 'Jonker', 'Kalisvaart', 'Lindeboom', 'Muijs', 'Nagtegaal',
        'Oosterhuis', 'Pronk', 'Quaedvlieg', 'Roozendaal', 'Slootweg', 'Terlouw',
        'Uijlenbroek', 'Vroegindeweij', 'Wielenga', 'Zomerdijk',
        'van der Berg', 'de Vries', 'van Dijk', 'Bakker', 'Janssen', 'Visser', 'Smit', 'Meijer',
        'de Boer', 'Mulder', 'de Groot', 'Bos', 'Vos', 'Peters', 'Hendriks', 'van Leeuwen',
        'Dekker', 'Brouwer', 'de Wit', 'Dijkstra', 'Smits', 'de Graaf', 'van der Meer',
        'van der Linden', 'Kok', 'Jacobs', 'de Haan', 'Vermeulen', 'van den Heuvel', 'van der Veen',
        'van den Broek', 'de Bruijn', 'Schouten', 'van Beek', 'Willems', 'van Vliet', 'Hoekman',
        'Maas', 'Verhoeven', 'Koster', 'van Dam', 'Prins', 'Blom', 'Huisman', 'Peeters', 'de Jong',
        'Kuipers', 'van Veen', 'Post', 'Kuiper']

# Business units drive most group names, the way they do in a real directory.
UNITS = ['CA010-Thuiszorg', 'CA060-Revalidatie', 'CZ08-Begeleiding', 'CB12-Dagbesteding',
         'FIN01-Financien', 'HRM02-Personeel', 'ICT03-Techniek', 'FAC04-Facilitair',
         'COM05-Communicatie', 'ZRG06-Wijkzorg', 'KWA07-Kwaliteit', 'INK08-Inkoop']

LICENCES = ['LIC-M365-E1', 'LIC-M365-E3', 'LIC-M365-E5', 'LIC-M365-F3']
PAID_APPS = ['APP-Copilot', 'APP-Adobe-AcrobatPro', 'APP-PowerBI-Pro', 'APP-Visio', 'APP-Project']
FREE_APPS = ['APP-Intranet', 'APP-Office365', 'APP-Teams', 'APP-Planner', 'APP-Selfservice']
SECURITY = ['SEC-Antivirus', 'SEC-DiskEncryption', 'SEC-MFA-Enrolled', 'SEC-Endpoint-Protection']
DEVICE = ['PRINT-Default', 'WIFI-Personeel', 'VPN-Thuiswerken']
PRIVILEGED = ['ADMIN-Beheer', 'ADMIN-AD-Beheer', 'ADMIN-Exchange-Beheer', 'PRIV-PAM-Kluis']
SERVER = ['SRV-Applicatieserver', 'SRV-RDP-Beheerservers', 'SRV-Aanmelden-AlsService',
          'DB-SQL-Service', 'LOG-Eventcollector']
# Sensitive groups with almost no members — the "nobody can compare this" case.
RARE = ['PRIV-Noodprocedure-Breakglass', 'ADMIN-Tier0-Domeinbeheer']

SYSTEMS = ['Microsoft Active Directory', 'Microsoft Entra ID', 'TOPdesk']


def unit_groups(unit):
    return [f'APP-{unit}-Portal', f'FS-{unit}-RO', f'FS-{unit}-RW', f'TEAM-{unit}',
            f'MBX-{unit}', f'ROLE-{unit}']


def csv_escape(value):
    return f'"{value}"' if any(c in value for c in ',"\n') else value


class Generator:
    def __init__(self, args):
        self.rnd = random.Random(args.seed)
        self.args = args
        self.rows = []
        self.employee_id = 500000
        self.rare_granted = 0

    def emit(self, system, person, display, user, enabled, permission, issue, resolution='None'):
        self.rows.append(','.join(csv_escape(v) for v in [
            system, person, display, user, 'True' if enabled else 'False',
            permission, '', '', issue, resolution]))

    def person_name(self):
        return f'{self.rnd.choice(FIRST)} {self.rnd.choice(LAST)}'

    def account(self, system):
        """One account and all of its rows. Returns when the row budget is spent."""
        rnd = self.rnd
        name = self.person_name()
        slug = name.lower().replace('ë', 'e').replace(' ', '.')
        roll = rnd.random()

        # Account shape. The proportions decide which findings have material to work with.
        if roll < 0.06:                       # admin account, deliberately unowned
            user, display, kind, owned = f'adm-{slug}', f'{name} (admin)', 'admin', False
        elif roll < 0.10:                     # service account
            user, display, kind, owned = f'svc-{rnd.choice(UNITS).split("-")[0].lower()}', \
                f'Service {rnd.choice(UNITS)}', 'service', False
        elif roll < 0.12:                     # external party
            user, display, kind, owned = f'{slug}.extern', f'{name} (extern)', 'external', rnd.random() < 0.4
        elif roll < 0.13:                     # test account
            user, display, kind, owned = f'test.{slug}', f'{name} (test)', 'test', False
        else:
            user, display, kind, owned = slug, name, 'user', rnd.random() > self.args.orphan_rate

        # Collisions are fine in a directory, but not in a reconciliation key.
        user = f'{user}{self.employee_id % 97}'
        person = ''
        if owned:
            self.employee_id += 1
            person = f'{name} ({self.employee_id})'
        else:
            self.employee_id += 1

        enabled = rnd.random() > self.args.disabled_rate
        unit = rnd.choice(UNITS)

        perms = []
        if kind in ('user', 'external'):
            perms += rnd.sample(unit_groups(unit), rnd.randint(2, 6))
            perms += rnd.sample(FREE_APPS, rnd.randint(1, 3))
            perms += rnd.sample(DEVICE, rnd.randint(0, 2))
            # A baseline that covers most, but not all, active staff.
            perms += [g for g in SECURITY if rnd.random() < self.args.baseline_coverage]
            if rnd.random() < 0.55:
                perms += rnd.sample(PAID_APPS, rnd.randint(1, 2))
            # Licence: normally one, sometimes two — the stacked-SKU case.
            perms.append(rnd.choice(LICENCES))
            if rnd.random() < self.args.stacked_rate:
                perms.append(rnd.choice([l for l in LICENCES if l not in perms]))
            # A few people accumulate access from units they no longer work in.
            if rnd.random() < 0.05:
                for other in rnd.sample(UNITS, rnd.randint(2, 4)):
                    perms += rnd.sample(unit_groups(other), 3)
        elif kind == 'admin':
            perms += rnd.sample(PRIVILEGED, rnd.randint(1, 3))
            perms += rnd.sample(SERVER, rnd.randint(0, 2))
            # A couple of break-glass groups, held by too few accounts to compare.
            if self.rare_granted < len(RARE):
                perms.append(RARE[self.rare_granted])
                self.rare_granted += 1
            if rnd.random() < 0.5:
                perms.append(rnd.choice(LICENCES))
        elif kind == 'service':
            perms += rnd.sample(SERVER, rnd.randint(1, 3))
            if rnd.random() < 0.3:
                perms.append(rnd.choice(LICENCES))
        elif kind == 'test':
            perms += rnd.sample(FREE_APPS + unit_groups(unit), rnd.randint(2, 6))
            perms.append(rnd.choice(LICENCES))

        # An account HelloID does not manage is one row of its own, before its entitlements.
        if not owned:
            # Some are already dispositioned in HelloID and should stay out of the review.
            self.emit(system, '', display, user, enabled, '', 'Account unmanaged',
                      'Excluded' if rnd.random() < 0.08 else 'None')

        for perm in dict.fromkeys(perms):     # de-duplicate, keep order
            self.emit(system, person, display, user, enabled,
                      f'{perm} (avo.local/Sample/Groups/{perm})', 'Permission unmanaged')

        # Entitlements the rules grant but the account does not hold.
        if owned and rnd.random() < self.args.missing_rate:
            missing = rnd.choice(SECURITY + FREE_APPS)
            if missing not in perms:
                self.emit(system, person, display, user, enabled,
                          f'{missing} (avo.local/Sample/Groups/{missing})', 'Permission missing')

    def run(self):
        systems = SYSTEMS[:self.args.systems]
        target = self.args.rows
        while len(self.rows) < target:
            self.account(self.rnd.choice(systems))
        return [HEADER] + self.rows[:target]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--rows', type=int, default=5000, help='row count to generate (default 5000)')
    p.add_argument('--seed', type=int, default=1, help='random seed; same seed gives the same file')
    p.add_argument('--systems', type=int, default=1, choices=[1, 2, 3], help='number of target systems')
    p.add_argument('--orphan-rate', type=float, default=0.12, help='share of user accounts with no person')
    p.add_argument('--disabled-rate', type=float, default=0.10, help='share of accounts that are disabled')
    p.add_argument('--stacked-rate', type=float, default=0.08, help='share of accounts with a second licence')
    p.add_argument('--missing-rate', type=float, default=0.05, help='share of accounts owed an entitlement they lack')
    p.add_argument('--baseline-coverage', type=float, default=0.88, help='security-group coverage among active staff')
    p.add_argument('-o', '--out', default='sample-recon.csv', help='output file, or - for stdout')
    args = p.parse_args()

    lines = Generator(args).run()
    text = '\n'.join(lines) + '\n'
    if args.out == '-':
        sys.stdout.write(text)
    else:
        with open(args.out, 'w', encoding='utf-8') as fh:
            fh.write(text)
        accounts = len({l.split(',')[3] for l in lines[1:]})
        print(f'{args.out}: {len(lines) - 1} rows, ~{accounts} accounts, seed {args.seed}')


if __name__ == '__main__':
    main()
