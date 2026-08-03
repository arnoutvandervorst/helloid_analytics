
console.log('\n=== copy plan for one person ===');
const r = samples[0];
const nm = e => (m.permissions.get(e)||{}).name || e;
console.log(r.person.name, '· peer group of', r.peers.length);
console.log('  standard (safe to copy):', r.copy.standard.slice(0,6).map(x=>nm(x.ent)).join(', '));
console.log('  review before copying:', r.copy.review.map(x=>nm(x.ent)+' ['+x.reasons.join('+')+(x.price?' €'+x.price+'/mo':'')+']').join(', ') || 'none');
console.log('  do not copy (exceptions):', r.copy.exclude.slice(0,6).map(x=>nm(x.ent)+' ('+(x.share*100).toFixed(0)+'%)').join(', '));
console.log('  summary:', JSON.stringify(r.copy.summary));
