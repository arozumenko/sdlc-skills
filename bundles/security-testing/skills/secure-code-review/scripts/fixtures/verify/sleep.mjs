// fixtures/verify/sleep.mjs — stays alive for 30 s so the runTests timeout
// path can be exercised with a 1 s budget.
setTimeout(() => {}, 30000);
