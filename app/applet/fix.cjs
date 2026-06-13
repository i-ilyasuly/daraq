const fs = require('fs');
let code = fs.readFileSync('src/backend/bot/index.ts', 'utf8');

code = code.replace(/rich_message: \{ html:  \}/g, "rich_message: { html: `<tg-thinking>${formatStatusMessage('Ойлану')}</tg-thinking>` }");

fs.writeFileSync('src/backend/bot/index.ts', code);
