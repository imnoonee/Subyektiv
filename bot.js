require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const db = require("./config/db");
const moment = require("moment-timezone");
const bot = new Telegraf(process.env.BOT_TOKEN);

// START komandasi
bot.start(async (ctx) => {
  const user = ctx.message.from;

  const userfind = await db.query(
    "SELECT * FROM users WHERE telegram_id = $1",
    [user.id]
  );

  if (userfind.rows.length > 0) {
    ctx.reply(`Qayta xush kelibsiz, ${user.first_name}`);
  } else {
    ctx.reply(`Salom, ${user.first_name}, <b>MTest bot</b>ga xush kelibsiz! `, {
      parse_mode: "HTML",
    });

    const fullname =
      user.first_name + (user.last_name ? " " + user.last_name : "");

    await db.query(
      "INSERT INTO users (telegram_id, username, full_name) VALUES ($1,$2,$3)",
      [user.id, user.username, fullname]
    );
  }

  const keyboard = Markup.keyboard([["Botdan foydalanish"]]).resize();

  ctx.reply(
    "Agar javobni jo'natishda qiyinchilikka duch kelsangiz, 'Botdan foydalanish' tugmasini bosing.",
    keyboard
  );
});

// Javob yuborish komandasi
bot.command("answer", async (ctx) => {
  const message = ctx.message.text.trim();
  const parts = message.split(" ");

  if (parts.length < 2) return ctx.reply("Javobni jo'natmadingiz!");

  const input = parts[1];
  const [mockPart, answersPart] = input.split("*");

  if (!mockPart || !answersPart)
    return ctx.reply("Format noto‘g‘ri! To‘g‘ri format: 1*1a2b3c...");

  const match = answersPart.match(/\d+[a-d]/g);
  if (!match || match.length !== 35) {
    return ctx.reply(
      `Javoblar 35 ta bo‘lishi kerak! Siz yuborgan: ${
        match ? match.length : 0
      } ta.`
    );
  }

  const mockId = parseInt(mockPart);
  if (isNaN(mockId)) return ctx.reply("Mock ID raqam bo‘lishi kerak.");

  const mockRes = await db.query("SELECT * FROM mock WHERE id = $1", [mockId]);
  if (mockRes.rows.length === 0) return ctx.reply("Bunday mock topilmadi.");

  const mock = mockRes.rows[0];

  // ⏰ Vaqtni Asia/Tashkent vaqt zonasi bo‘yicha solishtirish
  const now = moment().tz("Asia/Tashkent");
  const startsAt = moment.tz(mock.starts_at, "Asia/Tashkent");
  const endsAt = moment.tz(mock.ends_at, "Asia/Tashkent");

  if (now.isBefore(startsAt)) {
    return ctx.reply("⏳ Mock testi hali boshlanmagan!");
  }

  if (now.isAfter(endsAt)) {
    return ctx.reply("❌ Ushbu mock test vaqti allaqachon tugagan!");
  }

  // ✅ To‘g‘ri javoblar bilan taqqoslash
  const correctAnswers = mock.answers.match(/\d+[a-d]/g);
  let score = 0;

  for (let i = 0; i < 35; i++) {
    if (answersPart.includes(correctAnswers[i])) score++;
  }

  // 📊 Resultni bazaga saqlash
  const resultCheck = await db.query(
    "SELECT * FROM results WHERE mock_number = $1",
    [mockId]
  );

  const newResult = {
    username: ctx.message.from.username || "unknown",
    result: score,
  };

  if (resultCheck.rows.length > 0) {
    const results = resultCheck.rows[0].results;
    results.push(newResult);

    await db.query("UPDATE results SET results = $1 WHERE mock_number = $2", [
      JSON.stringify(results),
      mockId,
    ]);
  } else {
    await db.query("INSERT INTO results (mock_number, results) VALUES ($1, $2)", [
      mockId,
      JSON.stringify([newResult]),
    ]);
  }

  ctx.reply(`✅ Javob qabul qilindi! Natija: ${score}/35`);
});

// "Botdan foydalanish" tugmasi uchun
bot.on("text", async (ctx) => {
  const message = ctx.message.text;

  if (message === "Botdan foydalanish") {
    ctx.reply(
      `<b>MTest</b> — matematikadan milliy sertifikatga tayyorlanuvchilar uchun mo‘ljallangan bot.

<b>Qo‘llanma:</b>
✅ Har kuni 20:00 da mock test kanalga tashlanadi.
⏳ Javob yuborish vaqti: odatda 20:00–22:00 oralig‘i.
📤 Javoblarni ushbu botga quyidagi formatda yuboring:

<b>1*1a2b3c...</b>

<b>Izoh:</b>
* Yulduzcha oldidagi raqam — mock test raqami
* Keyingi qism — har bir savol raqami va tanlangan javob (masalan: 1a, 2c, 3b...)

<b>⚠️ Diqqat!</b>
* Javoblar aniq 35 ta bo‘lishi kerak
* Oraliqda bo‘sh joy, vergul yoki boshqa belgilar bo‘lmasligi kerak

<i><b>Omad!</b></i>`,
      { parse_mode: "HTML" }
    );
  }
});

bot.launch();
