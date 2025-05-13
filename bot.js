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

async function RunBot() {
  // /start
  bot.start(async (ctx) => {
    const user = ctx.message.from;
    console.log(`Start command from user: ${user.id}`);

    try {
      const member = await ctx.telegram.getChatMember(channelId, user.id);
      const isSub = ["creator", "administrator", "member"].includes(member.status);

      if (!isSub) {
        return ctx.reply(
          "Siz kanalga hali obuna bo'lmagansiz! Botdan foydalanish uchun ushbu kanalga obuna bo'ling va /start buyrug'ini qaytadan yuboring: @Subyektiv_1"
        );
      }

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
          [user.id, user.username || "", fullname]
        );
        console.log(`New user added: ${user.id}`);
      }

      const keyboard = Markup.keyboard([["Botdan foydalanish"]]).resize();
      ctx.reply(
        "Agar javobni jo'natishda qiyinchilikka duch kelsangiz, 'Botdan foydalanish' tugmasini bosing.",
        keyboard
      );
    } catch (error) {
      console.error(`Start command error for user ${user.id}:`, error);
      ctx.reply("❌ Xatolik yuz berdi. Keyinroq urining.");
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
      const correctAnswers = (mock.answers.match(/\d+[a-dA-D]/g) || []).map((a) => a.toLowerCase());

      if (correctAnswers.length !== 10) {
        return ctx.reply("❌ Mock test javoblari noto'g'ri formatda.");
      }

      const now = moment().tz("Asia/Tashkent");
      const startsAt = moment.tz(mock.starts_at, "Asia/Tashkent");
      const endsAt = moment.tz(mock.ends_at, "Asia/Tashkent");

      console.log(`Checking time for Mock #${mockId}: Now=${now.format()}, Starts=${startsAt.format()}, Ends=${endsAt.format()}`);

      if (now.isBefore(startsAt)) {
        return ctx.reply("⏳ Mock testi hali boshlanmagan!");
      }
      if (now.isAfter(endsAt)) {
        return ctx.reply("❌ Ushbu mock test vaqti tugagan!");
      }

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

      console.log(`Answer submitted for Mock #${mockId} by user ${userId}: Score=${score}`);
      ctx.reply("✅ Javob qabul qilindi!");
    } catch (err) {
      console.error("Answer command error:", err);
      ctx.reply("❌ Xatolik yuz berdi. Keyinroq urining.");
    }
  });

  // Qo‘llanma
  bot.on("text", async (ctx) => {
    if (ctx.message.text === "Botdan foydalanish") {
      ctx.reply(
        `<b>MTest</b> — testlarni ishlash uchun mo'ljallangan bot.\n\n` +
        `<b>Qo'llanma:</b>\n` +
        `📤 Javoblarni quyidagi formatda yuboring:\n` +
        `<b>/answer 5*1a2b3c...</b>\n\n` +
        `<i><b>Omad!</b></i>`,
        { parse_mode: "HTML" }
      );
    }
  });

  // Error handling
  bot.catch((err, ctx) => {
    console.error(`Bot error for ${ctx.updateType}:`, err);
    ctx.reply("❌ Botda xatolik yuz berdi. Iltimos, keyinroq urunib ko'ring.");
  });

  // Notify mock end
  async function notifyMockEnd() {
    try {
      const now = moment().tz("Asia/Tashkent");
      console.log(`Checking mocks at: ${now.format()}`);

      const mocks = await db.query("SELECT * FROM mock WHERE ends_at IS NOT NULL");
      if (mocks.rows.length === 0) {
        console.log("No mocks found.");
        return;
      }

      for (const mock of mocks.rows) {
        const endsAt = moment.tz(mock.ends_at, "Asia/Tashkent");
        const diffInSeconds = endsAt.diff(now, "seconds");

        console.log(`Mock #${mock.id}: Ends at ${endsAt.format()}, Diff: ${diffInSeconds}s`);

        if (diffInSeconds <= 60 && diffInSeconds >= 0) {
          console.log(`Processing Mock #${mock.id}`);

          const resultData = await db.query(
            "SELECT * FROM results WHERE mock_number = $1",
            [mock.id]
          );

          if (resultData.rows.length === 0 || !resultData.rows[0].results) {
            console.log(`No results for Mock #${mock.id}`);
            continue;
          }

          const users = resultData.rows[0].results;

          // Send individual user results
          for (const user of users) {
            const name = user.username ? `@${user.username}` : user.firstName || "Foydalanuvchi";
            const personalMsg =
              `✅ ${name}, test yakunlandi!\n\n` +
              `📊 To‘g‘ri javoblar: ${user.result}\n` +
              `📈 Foiz: ${Math.floor((user.result * 100) / 10)}%\n` +
              `Ball: ${user.finalScore?.toFixed(2) ?? "Noma'lum"}`;

            try {
              await bot.telegram.sendMessage(user.userId, personalMsg);
              console.log(`Sent result to ${name} (ID: ${user.userId})`);
            } catch (err) {
              console.error(`Failed to send result to ${user.userId}:`, err.message);
            }
          }

          // Send top-10 to channel
          const sortedUsers = [...users].sort((a, b) => b.result - a.result).slice(0, 10);
          let rankingMsg = `📢 <b>Test #${mock.id} yakunlandi!</b>\n\n🏆 Top foydalanuvchilar:\n\n`;
          sortedUsers.forEach((user, i) => {
            const displayName = user.username ? `@${user.username}` : user.firstName || `Foydalanuvchi ${i + 1}`;
            rankingMsg += `${i + 1}. ${displayName} - ${user.result} ta\n`;
          });

          try {
            await bot.telegram.sendMessage(channelId, rankingMsg, { parse_mode: "HTML" });
            console.log(`Sent ranking to channel for Mock #${mock.id}`);
          } catch (err) {
            console.error(`Failed to send ranking to channel:`, err.message);
          }
        }
      }
    } catch (err) {
      console.error("Error in notifyMockEnd:", err);
    }
  }

  // Schedule notification check every 10 seconds
  setInterval(notifyMockEnd, 10000);

  // Start bot
  try {
    await bot.launch();
    console.log("✅ Bot started successfully");

    try {
      await bot.telegram.sendMessage(channelId, "📢 Bot orqali message yuborildi.");
      console.log("Sent startup message to channel");
    } catch (err) {
      console.error("Failed to send startup message to channel:", err.message);
    }
  } catch (err) {
    console.error("❌ Bot failed to start:", err);
  }

  // Handle graceful shutdown
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

// Start Express server and bot
app.listen(3000, () => {
  console.log("Bot is running on port 3000!!!!");
  RunBot();
});