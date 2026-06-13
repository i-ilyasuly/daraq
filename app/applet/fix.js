const fs = require('fs');
let code = fs.readFileSync('src/backend/bot/index.ts', 'utf8');

code = code.replace(/await ctx\.telegram\.callApi\('sendMessageDraft', \{\s*chat_id: chatId,\s*draft_id: draftId,\s*message_thread_id: targetThreadId,\s*text: ([^,]+),\s*parse_mode: 'HTML'(?:,\s*disable_web_page_preview: true,\s*link_preview_options: \{ is_disabled: true \})?\s*\}\);/g, (match, p1) => {
    return `await ctx.telegram.callApi('sendRichMessageDraft', {
          chat_id: chatId,
          draft_id: draftId,
          message_thread_id: targetThreadId,
          rich_message: { html: \`<tg-thinking>\${${p1}}</tg-thinking>\` }
        });`;
});

fs.writeFileSync('src/backend/bot/index.ts', code);
