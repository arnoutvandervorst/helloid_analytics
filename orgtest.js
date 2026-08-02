const fs=require('fs'),vm=require('vm'),path=require('path');
const base='/Users/arnoutvandervorst/Projects/helloid_analytics';
const store={};const sandbox={console,navigator:{language:'en-GB'},localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]},document:{createElement:()=>({style:{},appendChild(){},addEventListener(){},append(){}}),createTextNode:()=>({}),getElementById:()=>({style:{},hidden:true,appendChild(){},addEventListener(){}})},setTimeout,clearTimeout,TextDecoder,performance};
sandbox.window=sandbox;vm.createContext(sandbox);
['i18n','util','parse','config','model','risk','findings','cost','diff','mine','rules','compare','roles','vault','evaluate','correlate','activity','products','org','pyramid','explain'].forEach(f=>vm.runInContext(fs.readFileSync(path.join(base,'js',f+'.js'),'utf8'),sandbox,{filename:f+'.js'}));
const HR=sandbox.HR;
for (const [label, file] of [['vault17','/Users/arnoutvandervorst/Downloads/Vault (17).json'],['demo',base+'/demo/vault.json']]) {
  const v=HR.vault.parse(fs.readFileSync(file,'utf8'),'v.json');
  const t0=Date.now();
  const q=HR.org.quality(v);
  console.log(`\n=== ${label} (${Date.now()-t0}ms)`, q.summary);
  console.log('tree meta:', q.structure.meta);
  console.log('facet fill:', q.facets.map(f=>`${f.label} ${(f.fill*100).toFixed(0)}%${f.anomalous?' ⚠'+f.missing.length:''}`).join(' | '));
  console.log('dead titles:', q.deadTitles.slice(0,5).map(t=>`${t.name} (${t.ended} ended, last ${t.lastEnd?t.lastEnd.toISOString().slice(0,10):'?'})`));
  console.log('depts w/o manager:', q.departmentsWithoutManager.length, '| undeclared:', q.undeclared.length, '| dangling:', q.danglingParents.length);
  console.log('roots:', q.structure.roots.slice(0,6).map(r=>`${r.name}(${q.structure.subtreeCount(r)})`));
}
