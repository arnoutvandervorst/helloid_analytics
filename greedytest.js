
console.log('\nsweep with exceptions (the cost of coverage):');
HR.pyramid.sweep(m).forEach(r=>console.log(`  ${(r.threshold*100).toFixed(0)}%: ${String(r.rules).padStart(3)} rules  ${(r.coverage*100).toFixed(1)}% cov  ${String(r.exceptions).padStart(4)} exceptions`));
