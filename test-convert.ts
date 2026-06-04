import { execSync } from 'child_process';
import fs from 'fs';

const oggBuffer = execSync('ffmpeg -f s16le -ar 24000 -ac 1 -i output.raw -c:a libopus -b:a 64k -f ogg pipe:1', { encoding: 'buffer' });
fs.writeFileSync('output.ogg', oggBuffer);
console.log('Saved output.ogg size', oggBuffer.length);
