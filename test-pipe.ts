import { execSync } from 'child_process';
import fs from 'fs';

const rawBuffer = fs.readFileSync('output.raw');

// Pipes the rawBuffer through stdin to ffmpeg and receives stdout
const oggBuffer = execSync('ffmpeg -f s16le -ar 24000 -ac 1 -i pipe:0 -c:a libopus -b:a 64k -f ogg pipe:1', { 
  input: rawBuffer,
  encoding: 'buffer'
});

fs.writeFileSync('output-pipe.ogg', oggBuffer);
console.log('Saved output-pipe.ogg size', oggBuffer.length);
