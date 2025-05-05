require('dotenv').config();
const { Telegraf } = require('telegraf');
const db = require('./config/db');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => ctx.reply('Bot ishga tushdi!'));

bot.command('time', async (ctx) => {
  try {
    const result = await db.query('SELECT NOW()');
    ctx.reply(`Hozirgi vaqt (DB): ${result.rows[0].now}`);
  } catch (err) {
    ctx.reply('DB error: ' + err.message);
  }
});

bot.launch();
