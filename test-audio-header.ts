import fs from 'fs';
const b = fs.readFileSync('output.raw');
console.log(b.slice(0, 32));
