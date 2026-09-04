"""Where the collectors get their tenant credentials, and how they ask for them.

Shared by helloid-export.py and helloid-audit.py. One saved profile serves both: it
holds the tenant URL, the REST API key and secret, and the Elastic proxy URL, key and
secret — each script asks only for the fields it needs and leaves the rest alone.

Resolution order, first hit wins:
  1. --profile NAME                  a named profile in helloid-config.json
  2. the config file's default profile
  3. environment variables / .env   (the old way; still works)
  4. an interactive prompt, with the offer to save what was typed as a profile

helloid-config.json sits next to the scripts, is written owner-only (0600) and is
gitignored, dockerignored and excluded from every deploy. It holds secrets in clear —
the same as .env did — so it stays on the consultant's machine.
"""
import getpass
import json
import os
import stat
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, 'helloid-config.json')

# What each script needs: profile field → (env variable, prompt label, hidden)
KINDS = {
    'api': {
        'title': 'HelloID REST API (products and product assignments)',
        'where': 'Create the key in the HelloID portal: Security → API keys (read access is enough).',
        'fields': [('url', 'HELLOID_URL', 'Tenant URL (https://<tenant>.helloid.com)', False),
                   ('apiKey', 'HELLOID_API_KEY', 'API key', False),
                   ('apiSecret', 'HELLOID_API_SECRET', 'API secret', True)]
    },
    'entra': {
        'title': 'Microsoft Entra ID app registration (unattended collector runs)',
        'where': 'Entra admin center → App registrations → your app: tenant id, application (client) id, a client secret; Application permissions User.Read.All, Group.Read.All, Organization.Read.All with admin consent.',
        'fields': [('entraTenantId', 'ENTRA_TENANT_ID', 'Tenant id (GUID or <tenant>.onmicrosoft.com)', False),
                   ('entraClientId', 'ENTRA_CLIENT_ID', 'Application (client) id', False),
                   ('entraClientSecret', 'ENTRA_CLIENT_SECRET', 'Client secret', True)]
    },
    'elastic': {
        'title': 'HelloID Elastic API (audit log)',
        'where': 'Enable it at https://<tenant>.helloid.com/admin/elasticapikey — the page shows the URL, key and secret.',
        'fields': [('elasticUrl', 'HELLOID_ELASTIC_URL', 'Elastic URL (https://<region>.helloid.cloud/service/elastic-proxy/elastic)', False),
                   ('elasticKey', 'HELLOID_ELASTIC_KEY', 'Elastic key', False),
                   ('elasticSecret', 'HELLOID_ELASTIC_SECRET', 'Elastic secret', True)]
    }
}


def add_arguments(parser):
    """The credential flags every collector shares."""
    g = parser.add_argument_group('credentials')
    g.add_argument('--profile', metavar='NAME', help='saved profile in helloid-config.json (default: the file\'s default profile)')
    g.add_argument('--setup', action='store_true', help='ask for the credentials again and save them')
    g.add_argument('--list-profiles', action='store_true', help='show the saved profiles and exit')
    g.add_argument('--forget', metavar='NAME', help='delete a saved profile and exit')
    g.add_argument('--env', default=os.path.join(HERE, '.env'), help='.env file to fall back on (default: next to the script)')


def load():
    if not os.path.exists(CONFIG):
        return {'default': None, 'profiles': {}}
    try:
        with open(CONFIG, encoding='utf-8') as fh:
            data = json.load(fh)
    except (OSError, ValueError) as e:
        raise SystemExit(f'{CONFIG} could not be read: {e}')
    data.setdefault('profiles', {})
    data.setdefault('default', None)
    return data


def save(data):
    tmp = CONFIG + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, indent=2)
    try:
        os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass                      # Windows: NTFS permissions are inherited; say so once below
    os.replace(tmp, CONFIG)
    if os.name == 'nt':
        print(f'  Saved to {CONFIG}. It holds the secret in clear: keep the folder to yourself.')
    else:
        print(f'  Saved to {CONFIG} (owner-only).')


def load_env(path):
    """Minimal .env reader — no dependency, and it only has to handle KEY=value."""
    values = {}
    if not path or not os.path.exists(path):
        return values
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def list_profiles():
    data = load()
    if not data['profiles']:
        print(f'No profiles yet. Run a collector once; it asks and offers to save. ({CONFIG})')
        return
    print(f'Profiles in {CONFIG}:')
    for name, p in data['profiles'].items():
        has = [label for key, label in (('apiKey', 'REST API'), ('elasticKey', 'Elastic'), ('entraClientId', 'Entra app')) if p.get(key)]
        mark = ' (default)' if name == data['default'] else ''
        print(f'  {name}{mark}: {p.get("url") or p.get("elasticUrl") or p.get("entraTenantId") or "?"} — {", ".join(has) if has else "no keys"}')


def forget(name):
    data = load()
    if name not in data['profiles']:
        raise SystemExit(f'No profile "{name}" in {CONFIG}.')
    del data['profiles'][name]
    if data['default'] == name:
        data['default'] = next(iter(data['profiles']), None)
    save(data)
    print(f'Forgot profile "{name}".')


def _host(url):
    return (url or '').replace('https://', '').replace('http://', '').split('/')[0].split('.')[0] or 'tenant'


def prompt(kind, existing=None):
    """Ask on the terminal; the secret is typed without echo."""
    spec = KINDS[kind]
    if not sys.stdin.isatty():
        raise SystemExit(f'No credentials for the {spec["title"]} and no terminal to ask on.\n'
                         f'Give them one of three ways: a profile (run once interactively, or --setup), '
                         f'environment variables ({", ".join(f[1] for f in spec["fields"])}), or a .env file.')
    print()
    print(spec['title'])
    print('  ' + spec['where'])
    out = {}
    for field, _env, label, hidden in spec['fields']:
        default = (existing or {}).get(field, '')
        while True:
            if hidden:
                value = getpass.getpass(f'  {label}{" [keep current]" if default else ""}: ')
            else:
                value = input(f'  {label}{f" [{default}]" if default else ""}: ')
            value = value.strip() or default
            if value:
                break
            print('    required')
        out[field] = value
    return out


def resolve(kind, args):
    """The credentials for `kind`, from wherever they are. Returns {url, key, secret, profile}."""
    spec = KINDS[kind]
    fields = [f[0] for f in spec['fields']]
    data = load()

    if args.list_profiles:
        list_profiles(); raise SystemExit(0)
    if args.forget:
        forget(args.forget); raise SystemExit(0)

    name = args.profile or data['default']
    profile = data['profiles'].get(name) if name else None
    if args.profile and profile is None:
        raise SystemExit(f'No profile "{args.profile}" in {CONFIG}. --list-profiles shows what there is; --setup creates one.')

    complete = profile and all(profile.get(f) for f in fields)
    if complete and not args.setup:
        return _pack(profile, fields, name)

    # The old way still counts, unless the user explicitly asked to set up.
    if not args.setup:
        env = load_env(args.env)
        vals = [os.environ.get(e) or env.get(e) for _f, e, _l, _h in spec['fields']]
        if all(vals):
            return _pack(dict(zip(fields, vals)), fields, None)

    typed = prompt(kind, profile)
    if sys.stdin.isatty():
        default_name = name or _host(typed[fields[0]])
        answer = input(f'  Save as profile [{default_name}] (enter = yes, "n" = no, or another name): ').strip()
        if answer.lower() not in ('n', 'no'):
            pname = answer if answer and answer.lower() not in ('y', 'yes') else default_name
            merged = dict(data['profiles'].get(pname, {}))
            merged.update(typed)
            data['profiles'][pname] = merged
            if not data['default'] or args.setup:
                data['default'] = data['default'] or pname
            save(data)
            name = pname
    return _pack(typed, fields, name)


def _pack(src, fields, name):
    return {'url': src[fields[0]], 'key': src[fields[1]], 'secret': src[fields[2]], 'profile': name}
