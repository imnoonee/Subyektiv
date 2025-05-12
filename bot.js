require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const db = require("./config/db");
const moment = require("moment-timezone");
const express = require("express");

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
const channelId = "@Subyektiv_1";
// Express test route
app.get("/test", (req, res) => {
  res.send("Server still active!");
});

app.listen(3000, ()=>console.log("Bot is running!!!!"))

// Rasch model ability estimation
function estimateAbility(answers, correctAnswers, difficulties) {
  let theta = 0.0;
  const maxIterations = 50;
  const tolerance = 0.0001;
  const minChange = 0.0001;

  for (let iter = 0; iter < maxIterations; iter++) {
    let firstDerivative = 0.0;
    let secondDerivative = 0.0;

    for (let i = 0; i < answers.length; i++) {
      const diff = difficulties[i] || 0;
      const response = answers[i] === correctAnswers[i] ? 1 : 0;
      const probability = 1.0 / (1.0 + Math.exp(-(theta - diff)));

      firstDerivative += response - probability;
      secondDerivative += probability * (1.0 - probability);
    }

    if (Math.abs(secondDerivative) < 0.01) {
      secondDerivative = 0.01 * Math.sign(secondDerivative);
    }

    const change = firstDerivative / secondDerivative;
    theta += change;

    if (Math.abs(change) < tolerance || Math.abs(change) < minChange) {
      break;
    }
  }

  return Math.max(-4, Math.min(4, theta));
}

// Ability to score conversion
function convertAbilityToScore(theta) {
  const minTheta = -3;
  const maxTheta = 3;
  const normalized = (theta - minTheta) / (maxTheta - minTheta);
  return Math.min(Math.max(normalized * 13.86, 0), 13.86);
}

// /start
bot.start(async (ctx) => {
  const user = ctx.message.from;
  const member =  await ctx.telegram.getChatMember(`${channelId}`, user.id);
  const isSub = ['creator', 'administrator', 'member'].includes(member.status);
  if(!isSub){
    ctx.reply("Siz kanalga hali obuna bo'lmagansiz! Bodan foydalanish uchun ushbu kanalga obuna bo'ling va /start buyrug'ini qaytadan yuboring: @Subyektiv_1");
  } else{
     try {
    const userfind = await db.query("SELECT * FROM users WHERE telegram_id = $1", [user.id]);

    if (userfind.rows.length > 0) {
      ctx.reply(`Qayta xush kelibsiz, ${user.first_name}`);
    } else {
      ctx.reply(`Salom, ${user.first_name}, <b>MTest bot</b>ga xush kelibsiz!`, {
        parse_mode: "HTML",
      });

      const fullname = user.first_name + (user.last_name ? " " + user.last_name : "");
      await db.query(
        "INSERT INTO users (telegram_id, username, full_name) VALUES ($1, $2, $3)",
        [user.id, user.username, fullname]
      );
    }

    const keyboard = Markup.keyboard([["Botdan foydalanish"]]).resize();
    ctx.reply(
      "Agar javobni jo'natishda qiyinchilikka duch kelsangiz, 'Botdan foydalanish' tugmasini bosing.",
      keyboard
    );
  } catch (error) {
    console.error("Start error:", error);
    ctx.reply("❌ Xatolik yuz berdi. Keyinroq urining.");
  }

  }
 });

// Javoblarni qabul qilish: /answer
bot.command("answer", async (ctx) => {
  try {
    const message = ctx.message.text.trim();
    const parts = message.split(/\s+/);

    if (parts.length < 2) {
      return ctx.reply("❌ Javobni jo'natmadingiz! Format: /answer 5*1a2b3c...");
    }

    const input = parts[1];
    const [mockPart, answersPart] = input.split("*");

    if (!mockPart || !answersPart) {
      return ctx.reply("❌ Format noto'g'ri! To'g'ri format: /answer 5*1a2b3c...");
    }

    const mockId = parseInt(mockPart);
    if (isNaN(mockId) || mockId <= 0) {
      return ctx.reply("❌ Mock ID musbat raqam bo'lishi kerak.");
    }

    const answerMatches = answersPart.match(/\d+[a-dA-D]/g) || [];
    if (answerMatches.length !== 10) {
      return ctx.reply(`❌ Javoblar 10 ta bo'lishi kerak. Siz yuborgan: ${answerMatches.length}`);
    }

    const userAnswers = answerMatches.map((a) => a.toLowerCase());

    const mockRes = await db.query("SELECT * FROM mock WHERE id = $1", [mockId]);
    if (mockRes.rows.length === 0) {
      return ctx.reply("❌ Bunday mock test topilmadi.");
    }

    const mock = mockRes.rows[0];
    const correctAnswers = (mock.answers.match(/\d+[a-dA-D]/g) || []).map((a) =>
      a.toLowerCase()
    );

    if (correctAnswers.length !== 10) {
      return ctx.reply("❌ Mock test javoblari noto'g'ri formatda.");
    }

    const now = moment().tz("Asia/Tashkent");
    const startsAt = moment.tz(mock.starts_at, "Asia/Tashkent");
    const endsAt = moment.tz(mock.ends_at, "Asia/Tashkent");

    if (now.isBefore(startsAt)) return ctx.reply("⏳ Mock testi hali boshlanmagan!");
    if (now.isAfter(endsAt)) return ctx.reply("❌ Ushbu mock test vaqti tugagan!");

    const userId = ctx.message.from.id;
    const resultCheck = await db.query(
      "SELECT * FROM results WHERE mock_number = $1",
      [mockId]
    );

    let userAlreadySubmitted = false;
    if (resultCheck.rows.length > 0) {
      const results = resultCheck.rows[0].results || [];
      const previousResult = results.find((r) => r.userId == userId);
      if (previousResult) userAlreadySubmitted = true;
    }

    if (userAlreadySubmitted) {
      return ctx.reply("❌ Siz avval javob bergansiz!");
    }

    let score = 0;
    for (let i = 0; i < 10; i++) {
      if (userAnswers[i] === correctAnswers[i]) score++;
    }

    const difficulties = mock.difficulty || Array(10).fill(0).map((_, i) => -2.5 + i * (5 / 9));
    const ability = estimateAbility(userAnswers, correctAnswers, difficulties);
    const finalScore = convertAbilityToScore(ability);

    const newResult = {
      userId,
      username: ctx.message.from.username || "",
      firstName: ctx.message.from.first_name || "",
      lastName: ctx.message.from.last_name || "",
      result: score,
      ability: parseFloat(ability.toFixed(2)),
      finalScore: parseFloat(finalScore.toFixed(2)),
      submittedAt: new Date().toISOString(),
    };

    if (resultCheck.rows.length > 0) {
      const existingResults = resultCheck.rows[0].results || [];
      await db.query("UPDATE results SET results = $1 WHERE mock_number = $2", [
        JSON.stringify([...existingResults, newResult]),
        mockId,
      ]);
    } else {
      await db.query("INSERT INTO results (mock_number, results) VALUES ($1, $2)", [
        mockId,
        JSON.stringify([newResult]),
      ]);
    }

    ctx.reply("✅ Javob qabul qilindi!");
  } catch (err) {
    console.error("Answer error:", err);
    ctx.reply("❌ Xatolik yuz berdi. Keyinroq urining.");
  }
});

// Qo‘llanma
bot.on("text", async (ctx) => {
  if (ctx.message.text === "Botdan foydalanish") {
    ctx.reply(
      `<b>MTest</b> — testlarni ishlash uchun mo'ljallangan bot.

<b>Qo'llanma:</b>
📤 Javoblarni quyidagi formatda yuboring:
<b>/answer 5*1a2b3c...</b>

<i><b>Omad!</b></i>`,
      { parse_mode: "HTML" }
    );
  }
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
  ctx.reply("❌ Botda xatolik yuz berdi. Iltimos, keyinroq urunib ko'ring.");
});


async function notifyMockEnd() {
  try {
    const now = moment().tz("Asia/Tashkent");

    // 1. End time mavjud barcha mock testlar
    const mocks = await db.query("SELECT * FROM mock WHERE ends_at IS NOT NULL");

    // Xabar yuborilgan mocklarni kuzatib boramiz
    const sentMessages = {};

    for (const mock of mocks.rows) {
      const endsAt = moment.tz(mock.ends_at, "Asia/Tashkent");
      const diffInSeconds = endsAt.diff(now, "seconds");

      // Faqat tugashiga 1 soniya qolgan yoki tugayotgan testlar
      if (diffInSeconds <= 1 && diffInSeconds >= 0 && !sentMessages[mock.id]) {
        try {
          // 2. Resultlarni bazadan olish
          const resultData = await db.query(
            "SELECT * FROM results WHERE mock_number = $1",
            [mock.id]
          );

          if (resultData.rows.length === 0) continue;

          const mockResult = resultData.rows[0];
          const users = mockResult.results;

          if (!users || users.length === 0) continue;

          // 3. Har bir foydalanuvchiga alohida yuborish
          for (const user of users) {
            const name =
              user.username
                ? `@${user.username}`
                : user.firstName || user.lastName || "Hurmatli foydalanuvchi";

            const personalMsg =
              `✅ ${name}, test yakunlandi!\n\n` +
              `Sizning natijalaringiz:\n` +
              `📊 To‘g‘ri javoblar soni: ${user.result}\n` +
              `📈 Foiz: ${Math.floor((user.result * 100) / 10)}%\n` +
              `Ball: ${user.finalScore?.toFixed(2) ?? "Nomaʼlum"}`;

            try {
              await bot.telegram.sendMessage(user.userId, personalMsg);
            } catch (err) {
              console.error(`❌ ${user.userId} ga xabar yuborishda xatolik:`, err.message);
            }
          }

          // 4. Top 10 foydalanuvchini aniqlash va kanalga yuborish
          const sortedUsers = [...users].sort((a, b) => b.result - a.result);
          const topUsers = sortedUsers.length > 10 ? sortedUsers.slice(0, 10) : sortedUsers;

          let rankingMsg = `📢 *Mock test #${mock.id} yakunlandi!*\n\n`;
          rankingMsg += `🏆 Yuqori natija ko‘rsatgan foydalanuvchilar:\n\n`;

          topUsers.forEach((user, i) => {
            const displayName =
              user.username
                ? `@${user.username}`
                : user.firstName || user.lastName || `Foydalanuvchi ${i + 1}`;
            rankingMsg += `${i + 1}. ${displayName} - ${user.result} ta\n`;
          });

          await bot.telegram.sendMessage(channelId, rankingMsg, {
            parse_mode: "Markdown",
          });

          sentMessages[mock.id] = true;
        } catch (error) {
          console.error(`❌ Mock #${mock.id} uchun natijalarni qayta ishlashda xatolik:`, error);
        }
      }
    }
  } catch (err) {
    console.error("❌ notifyMockEnd() ishlovida xatolik:", err);
  }

  console.log("Checked!")
}

// Schedule the notification check every second
setInterval(notifyMockEnd, 2000);

// Start bot
(async () => {
  try {
    await bot.launch();
    console.log("✅ Bot started successfully");

    await bot.telegram.sendMessage(
      channelId,
      "📢 Bot orqali message yuborildi."
    );
  } catch (err) {
    console.error("❌ Bot failed to start:", err);
  }
})();
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
