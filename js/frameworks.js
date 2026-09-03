/* The articles behind the compliance references.

   Every control names the framework articles it evidences — NIS2 21(2)(i), ISO 27001
   A.5.18, BIO 9.2.6 — but a number alone tells a reader nothing. This resolves each
   reference to a title and a text, so the page can say what the article asks and the
   control can say how its measurement evidences it.

   Licensing decides what the text is. NIS2 is EU law and its wording ships verbatim
   (EN and NL, from EUR-Lex). ISO 27001/27002 control text and the ISO-derived BIO
   control statements are licensed (ISO / NEN) and are not reproduced: those carry the
   official control title and Sidekick's own description of what the control requires,
   labelled as such, with a link to the official source. The texts themselves live in
   i18n as content keys (`fw.<framework>.<ref>.t` title, `.x` text). */
(function (HR) {
  'use strict';

  const T = (k, p) => HR.i18n.t(k, p);

  const META = {
    nis2: { label: 'NIS2', official: true, source: 'https://eur-lex.europa.eu/eli/dir/2022/2555/oj' },
    iso27001: { label: 'ISO 27001', official: false, source: 'https://www.iso.org/standard/27001' },
    bio: { label: 'BIO', official: false, source: 'https://www.bio-overheid.nl' }
  };

  const key = (fw, ref) => 'fw.' + fw + '.' + ref;

  /** One reference resolved: framework label, number, title, text, whether the text is the official one. */
  function resolve(fw, ref) {
    const meta = META[fw] || { label: fw, official: false, source: '' };
    return { fw, ref, label: meta.label, official: meta.official, source: meta.source,
      title: HR.i18n.has(key(fw, ref) + '.t') ? T(key(fw, ref) + '.t') : '',
      about: HR.i18n.has(key(fw, ref) + '.x') ? T(key(fw, ref) + '.x') : '' };
  }

  /** The references of one control, resolved, in the catalogue's framework order. */
  function refsOf(def) {
    return Object.keys(def.refs || {}).map(fw => resolve(fw, def.refs[fw]));
  }

  /** Every distinct reference the catalogue uses, grouped per framework. */
  function usedRefs(catalog) {
    const seen = new Map();
    (catalog || HR.policy.CATALOG).forEach(def => Object.keys(def.refs || {}).forEach(fw => {
      const k = fw + '|' + def.refs[fw];
      if (!seen.has(k)) seen.set(k, resolve(fw, def.refs[fw]));
    }));
    const order = Object.keys(META);
    return Array.from(seen.values()).sort((a, b) => order.indexOf(a.fw) - order.indexOf(b.fw) || a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  }

  /** How a control's measurement evidences its references — the sentence an auditor reads. */
  const evidenceOf = def => HR.i18n.has('po.p.' + def.id + '.ev') ? T('po.p.' + def.id + '.ev') : '';

  HR.frameworks = { META, resolve, refsOf, usedRefs, evidenceOf };
})(window.HR);
