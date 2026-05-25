import 'dotenv/config';
import { Telegraf } from 'telegraf';

async function test() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("No token");
  const bot = new Telegraf(token);
  try {
    const res = await bot.telegram.callApi('sendMessageDraft' as any, {
      chat_id: process.env.TEST_CHAT_ID || 1234567,
      text: "Test draft"
    });
    console.log("Success:", res);
  } catch (err: any) {
    console.error("Error:", err.response ? err.response.description : err.message);
  }
}
test();
