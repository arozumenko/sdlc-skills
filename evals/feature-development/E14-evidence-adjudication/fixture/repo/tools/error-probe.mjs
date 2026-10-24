import { save } from '../src/editor.js';
console.log(JSON.stringify({ input: 'send rejects', observed: await save(async () => { throw new Error('offline'); }) }));
