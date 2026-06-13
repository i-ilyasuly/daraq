import fs from 'fs';
let code = fs.readFileSync('src/backend/bot/index.ts', 'utf8');
code = code.replace(/await ctx\.telegram\.callApi\('sendRichMessage/g, "await sendRawTelegramApi('sendRichMessage");
fs.writeFileSync('src/backend/bot/index.ts', code);
