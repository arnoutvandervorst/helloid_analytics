#!/usr/bin/env python3
"""A fictional AD collector export, for trying the directory import without a tenant.

Writes the same envelope collect-ad.ps1 produces: users with rich attributes
(extensionAttributes included), groups with nesting, memberships that actually
correlate with the attributes — so the Attributes tab has something honest to find.
Everything is invented: avo.local, names from a fixed list, numbers counting up.

    python3 make-directory.py                    # -> directory-demo.json
    python3 make-directory.py --users 2000
"""
import argparse, json, random

FIRST = ['anne', 'bram', 'daan', 'eva', 'finn', 'gijs', 'hanna', 'iris', 'jasper', 'lars',
         'mila', 'noa', 'pien', 'quinten', 'roos', 'sven', 'tess', 'ursula', 'vera', 'wout',
         'xander', 'yara', 'zoe']
LAST = ['aalbers', 'bosman', 'coenen', 'dijkgraaf', 'elzinga', 'fokkema', 'gerritsen',
        'hoekstra', 'jonker', 'kalisvaart', 'lindeboom', 'muijs', 'nagtegaal', 'oosterhuis',
        'pietersen', 'quaedvlieg', 'roozendaal', 'slootweg', 'terlouw', 'uijlenbroek',
        'vroegindeweij', 'wielenga', 'zomerdijk']

DEPARTMENTS = {
    'Financien':   {'ou': 'OU=Financien',   'cc': 'CC-100', 'titles': ['Controller', 'Administrateur', 'Financieel medewerker']},
    'Personeel':   {'ou': 'OU=Personeel',   'cc': 'CC-200', 'titles': ['HR-adviseur', 'Recruiter', 'Salarisadministrateur']},
    'Zorg':        {'ou': 'OU=Zorg',        'cc': 'CC-300', 'titles': ['Verpleegkundige', 'Verzorgende', 'Teamleider zorg']},
    'Facilitair':  {'ou': 'OU=Facilitair',  'cc': 'CC-400', 'titles': ['Facilitair medewerker', 'Receptionist', 'Technisch beheerder']},
    'ICT':         {'ou': 'OU=ICT',         'cc': 'CC-500', 'titles': ['Systeembeheerder', 'Servicedeskmedewerker', 'Informatiemanager']},
}
EMPLOYEE_TYPES = [('Dienstverband', 0.62), ('Uitzendkracht', 0.16), ('Stagiair', 0.10),
                  ('Vrijwilliger', 0.09), ('Leverancier', 0.03)]
CITIES = ['Avondrood', 'Schemerdam', 'Dauwburg']
BASE_DN = 'DC=avo,DC=local'


def pick_type(rng):
    r = rng.random()
    acc = 0.0
    for name, share in EMPLOYEE_TYPES:
        acc += share
        if r <= acc:
            return name
    return EMPLOYEE_TYPES[0][0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--users', type=int, default=320)
    ap.add_argument('--seed', type=int, default=11)
    ap.add_argument('-o', '--out', default='directory-demo.json')
    args = ap.parse_args()
    rng = random.Random(args.seed)

    groups = {}

    def group(name, ou='OU=Groepen', description=''):
        if name not in groups:
            groups[name] = {
                'id': f'CN={name},{ou},{BASE_DN}', 'name': name, 'accountName': name,
                'description': description, 'category': 'Security', 'scope': 'Global',
                'managedBy': '', 'created': '2019-03-12T09:00:00Z', 'mail': '',
                'ou': f'{ou},{BASE_DN}', 'memberUsers': [], 'memberGroups': []
            }
        return groups[name]

    def nest(parent, child):
        p, c = group(parent), group(child)
        if c['id'] not in p['memberGroups']:
            p['memberGroups'].append(c['id'])

    # The nesting story: baseline hangs under one umbrella, department access under
    # department groups, and users only ever join role groups — everything above
    # arrives inherited, which is exactly what the flattener has to prove.
    group('G-Alle-Medewerkers', description='Iedereen in dienst')
    for sec in ['SEC-MFA-Enrolled', 'SEC-Antivirus', 'SEC-DiskEncryption']:
        nest('G-Alle-Medewerkers', sec)
    for dept, d in DEPARTMENTS.items():
        dg = f'G-Afdeling-{dept}'
        nest(dg, f'FS-{dept}-RW')
        nest(dg, f'APP-Rooster-{dept}')
        for title in d['titles']:
            rg = f'ROLE-{title.replace(" ", "-")}'
            nest(dg, rg)          # role membership carries the department groups
            nest('G-Alle-Medewerkers', dg)

    users = []
    seen = set()
    n = 0
    while len(users) < args.users:
        n += 1
        first, last = rng.choice(FIRST), rng.choice(LAST)
        uname = f'{first}.{last}{n}'
        if uname in seen:
            continue
        seen.add(uname)
        dept = rng.choice(list(DEPARTMENTS))
        d = DEPARTMENTS[dept]
        title = rng.choice(d['titles'])
        etype = pick_type(rng)
        enabled = rng.random() > 0.08
        city = rng.choice(CITIES)
        dn = f'CN={first} {last},{d["ou"]},{BASE_DN}'
        users.append({
            'id': dn, 'userName': uname, 'upn': f'{uname}@avo.local',
            'displayName': f'{first.capitalize()} {last.capitalize()}',
            'enabled': enabled, 'created': f'20{rng.randint(15, 25):02d}-0{rng.randint(1, 9)}-15T08:00:00Z',
            'lastLogon': '2026-08-01T07:12:00Z' if enabled and rng.random() > 0.15 else None,
            'expires': None,
            'department': dept, 'title': title, 'company': 'Avondrood Zorggroep',
            'office': city, 'employeeId': str(500000 + n), 'employeeType': etype,
            'description': '', 'notes': '',
            'mail': f'{uname}@avo.local', 'phone': f'030-55{rng.randint(10000, 99999)}',
            'homePhone': '', 'mobile': f'06-{rng.randint(10000000, 99999999)}',
            'fax': '', 'pager': '', 'ipPhone': '',
            'street': 'Zorglaan 1', 'poBox': '', 'city': city, 'state': 'UT',
            'postalCode': '3500 AA', 'country': 'Nederland',
            'ou': f'{d["ou"]},{BASE_DN}', 'managerId': '', 'managerName': '',
            'extensionAttributes': {
                'extensionAttribute1': d['cc'],
                'extensionAttribute5': city[:3].upper(),
                **({'extensionAttribute10': 'EXTERN'} if etype in ('Uitzendkracht', 'Leverancier') else {})
            }
        })
        # Direct memberships: the role group (nesting does the rest) plus a licence.
        role = group(f'ROLE-{title.replace(" ", "-")}')
        role['memberUsers'].append(dn)
        lic = 'LIC-M365-E3' if etype == 'Dienstverband' else 'LIC-M365-F3'
        group(lic)['memberUsers'].append(dn)
        if etype in ('Uitzendkracht', 'Leverancier'):
            group('G-Extern')['memberUsers'].append(dn)
        if dept == 'ICT' and title == 'Systeembeheerder':
            group('PRIV-ServerAdmins')['memberUsers'].append(dn)

    # A few hand-made strays so the naming analysis has something to flag.
    for stray in ['Oude share boekhouding', '#Migratie2019', 'test_groep_jan']:
        g = group(stray)
        for u in rng.sample(users, 4):
            g['memberUsers'].append(u['id'])

    # Managers: the first member of each department becomes everyone's manager.
    by_dept = {}
    for u in users:
        by_dept.setdefault(u['department'], []).append(u)
    for dept, members in by_dept.items():
        mgr = members[0]
        for u in members[1:]:
            u['managerId'] = mgr['id']
            u['managerName'] = mgr['displayName']

    envelope = {
        'kind': 'helloid-analytics-directory', 'version': 1, 'source': 'ad',
        'collectedAt': '2026-08-09T09:00:00Z', 'domain': 'avo.local', 'searchBase': '',
        'users': users, 'groups': list(groups.values())
    }
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(envelope, f, ensure_ascii=False)
    nested = sum(len(g['memberGroups']) for g in groups.values())
    print(f'{args.out}: {len(users)} users, {len(groups)} groups, {nested} nested edges')


if __name__ == '__main__':
    main()
