import { execSync } from 'child_process';
try {
  const result = execSync('ffmpeg -version').toString();
  console.log('FFmpeg is available:', result.split('\\n')[0]);
} catch(e) {
  console.log('FFmpeg is NOT available:', e);
}
