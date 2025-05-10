require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const db = require("./config/db");
const moment = require("moment-timezone");
const bot = new Telegraf(process.env.BOT_TOKEN);
const channelId = "@MTest_public";

// Improved Rasch model ability estimation
function estimateAbility(answers, correctAnswers, difficulties) {
  let theta = 0.0; // Initial ability estimate
  const maxIterations = 50;
  const tolerance = 0.0001;
  const minChange = 0.0001;

  for (let iter = 0; iter < maxIterations; iter++) {
    let firstDerivative = 0.0;
    let secondDerivative = 0.0;

    for (let i = 0; i < answers.length; i++) {
      const diff = difficulties[i] || 0; // Default difficulty if not provided
      const response = answers[i] === correctAnswers[i] ? 1 : 0;
      const probability = 1.0 / (1.0 + Math.exp(-(theta - diff)));

      firstDerivative += response - probability;
      secondDerivative += probability * (1.0 - probability);
    }

    // Avoid division by zero
    if (Math.abs(secondDerivative) < 0.01) {
      secondDerivative = 0.01 * Math.sign(secondDerivative);
    }

    const change = firstDerivative / secondDerivative;
    theta += change;

    if (Math.abs(change) < tolerance || Math.abs(change) < minChange) {
      break;
    }
  }

  // Constrain theta to reasonable bounds
  return Math.max(-4, Math.min(4, theta));
}

// Improved score conversion
function convertAbilityToScore(theta) {
  // Normalize theta to 0-13.86 scale
  const minTheta = -3;
  const maxTheta = 3;
  const normalized = (theta - minTheta) / (maxTheta - minTheta);
  return Math.min(Math.max(normalized * 13.86, 0), 13.86);
}

// Answer command with better validation
bot.command("answer", async (ctx) => {
  try {
    const message = ctx.message.text.trim();
    const parts = message.split(/\s+/); // Split on any whitespace

    if (parts.length < 2) {
      return ctx.reply(
        "❌ Javobni jo'natmadingiz! Format: /answer 1*1a2b3c..."
      );
    }

    const input = parts[1];
    const [mockPart, answersPart] = input.split("*");

    if (!mockPart || !answersPart) {
      return ctx.reply(
        "❌ Format noto'g'ri! To'g'ri format: /answer 1*1a2b3c..."
      );
    }

    // Validate mock ID
    const mockId = parseInt(mockPart);
    if (isNaN(mockId) || mockId <= 0) {
      return ctx.reply("❌ Mock ID musbat raqam bo'lishi kerak.");
    }

    // Extract and validate answers
    const answerMatches = answersPart.match(/\d+[a-dA-D]/g) || [];
    if (answerMatches.length !== 10) {
      return ctx.reply(
        `❌ Javoblar aniq 35 ta bo'lishi kerak! Siz yuborgan: ${answerMatches.length} ta.`
      );
    }

    // Normalize answers to lowercase
    const userAnswers = answerMatches.map((a) => a.toLowerCase());

    // Get mock data
    const mockRes = await db.query("SELECT * FROM mock WHERE id = $1", [
      mockId,
    ]);
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

    // Check time validity
    const now = moment().tz("Asia/Tashkent");
    const startsAt = moment.tz(mock.starts_at, "Asia/Tashkent");
    const endsAt = moment.tz(mock.ends_at, "Asia/Tashkent");

    if (now.isBefore(startsAt)) {
      return ctx.reply("⏳ Mock testi hali boshlanmagan!");
    }

    if (now.isAfter(endsAt)) {
      return ctx.reply("❌ Ushbu mock test vaqti allaqachon tugagan!");
    }

    // Check if user already submitted
    const userId = ctx.message.from.id;
    const resultCheck = await db.query(
      "SELECT * FROM results WHERE mock_number = $1",
      [mockId]
    );

    let userAlreadySubmitted = false;
    let previousResult = null;

    if (resultCheck.rows.length > 0) {
      const results = resultCheck.rows[0].results || [];
      previousResult = results.find((result) => result.userId == userId);
      if (previousResult) {
        userAlreadySubmitted = true;
      }
    }

    if (userAlreadySubmitted) {
      return ctx.reply(
        `❌ Siz avval javob bergansiz!`
      );
    }

    // Calculate score
    let score = 0;
    for (let i = 0; i < 35; i++) {
      if (userAnswers[i] === correctAnswers[i]) {
        score++;
      }
    }

    // Get difficulties or use defaults
    const difficulties =
      mock.difficulty ||
      Array(35)
        .fill(0)
        .map((_, i) => {
          // Default difficulty progression
          return -2.5 + i * (5 / 34);
        });

    // Calculate ability using Rasch model
    const ability = estimateAbility(userAnswers, correctAnswers, difficulties);
    const finalScore = convertAbilityToScore(ability);

    // Prepare result object
    const newResult = {
      userId: userId,
      username: ctx.message.from.username || "unknown",
      firstName: ctx.message.from.first_name || "",
      lastName: ctx.message.from.last_name || "",
      result: score,
      ability: parseFloat(ability.toFixed(2)),
      finalScore: parseFloat(finalScore.toFixed(2)),
      submittedAt: new Date().toISOString(),
    };

    // Save to database
    if (resultCheck.rows.length > 0) {
      const existingResults = resultCheck.rows[0].results || [];
      await db.query("UPDATE results SET results = $1 WHERE mock_number = $2", [
        JSON.stringify([...existingResults, newResult]),
        mockId,
      ]);
    } else {
      await db.query(
        "INSERT INTO results (mock_number, results) VALUES ($1, $2)",
        [mockId, JSON.stringify([newResult])]
      );
    }

    // Send response
    ctx.reply(
      `✅ Javob qabul qilindi!  `
    );
  } catch (error) {
    console.error("Error processing answer:", error);
    ctx.reply("❌ Xatolik yuz berdi. Iltimos, keyinroq urunib ko'ring.");
  }
});

// Start command (unchanged)
bot.start(async (ctx) => {
  const user = ctx.message.from;

  try {
    const userfind = await db.query(
      "SELECT * FROM users WHERE telegram_id = $1",
      [user.id]
    );

    if (userfind.rows.length > 0) {
      ctx.reply(`Qayta xush kelibsiz, ${user.first_name}`);
    } else {
      ctx.reply(
        `Salom, ${user.first_name}, <b>MTest bot</b>ga xush kelibsiz!`,
        {
          parse_mode: "HTML",
        }
      );

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
  } catch (error) {
    console.error("Error in start command:", error);
    ctx.reply("❌ Xatolik yuz berdi. Iltimos, keyinroq urunib ko'ring.");
  }
});

// Help text (unchanged)
bot.on("text", async (ctx) => {
  const message = ctx.message.text;

  if (message === "Botdan foydalanish") {
    ctx.reply(
      `<b>MTest</b> — Kanaldagi va tarixga asoslangan testlarni ishlash uchun mo'ljallangan bot.

<b>Qo'llanma:</b>
📤 Javoblarni ushbu botga quyidagi formatda yuboring:

<b>1*1a2b3c...</b>

<b>Izoh:</b>
* Yulduzcha oldidagi raqam — mock test raqami
* Keyingi qism — har bir savol raqami va tanlangan javob (masalan: 1a, 2c, 3b...)

<b>⚠️ Diqqat!</b>
* Oraliqda bo'sh joy, vergul yoki boshqa belgilar bo'lmasligi kerak

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

// Function to notify users when a mock test ends
async function notifyMockEnd() {
  try {
    const now = moment().tz("Asia/Tashkent");
    const mocks = await db.query("SELECT * FROM mock WHERE ends_at IS NOT NULL");

    // Object to track sent messages for each mock
    const sentMessages = {};

    for (const mock of mocks.rows) {
      const endsAt = moment.tz(mock.ends_at, "Asia/Tashkent");
      const diffInSeconds = endsAt.diff(now, "seconds");

      // Check if the mock test is ending within the next 1 second and not already sent
      if (diffInSeconds <= 1 && diffInSeconds >= 0 && !sentMessages[mock.id]) {
        const result = await db.query(
          "SELECT * FROM results WHERE mock_number = $1",
          [mock.id]
        );

        // Check if results exist and contain the 'results' array
        try {
          if (result.rows.length > 0 && result.rows[0].results) {
            const users = result.rows[0].results;
            users.forEach((user) => {
              bot.telegram.sendMessage(user.userId, `Test yakunlandi! \nSizning natijalaringiz:\nNatija: ${Math.floor((user.result * 100) / 35)}%\nTo'g'ri javoblar soni: ${user.result}`);
            });

            // Sort users by result in descending order
            const sortedUsers = [...users].sort((a, b) => b.result - a.result);

            // Prepare ranking message
            let rankingMessage = `🎉 Mock test #${mock.id} yakunlandi! Eng yaxshi natijalar:\n\n`;
            const userCount = sortedUsers.length;

            if (userCount > 10) {
              // Top 10 users
              const top10 = sortedUsers.slice(0, 10);
              top10.forEach((user, index) => {
                const displayName = `@${user.username}` || user.firstName || user.lastName || `User #${index + 1}`;
                rankingMessage += `${index + 1}. ${displayName}: ${Math.floor((user.result * 100) / 35)}% (${user.result}/35)\n`;
              });
              await bot.telegram.sendMessage(channelId, rankingMessage);
            } else if (userCount > 0) {
              // All users if less than or equal to 10
              sortedUsers.forEach((user, index) => {
                const displayName = `@${user.username}` || user.firstName || user.lastName || `User #${index + 1}`;
                rankingMessage += `${index + 1}. ${displayName}: ${Math.floor((user.result * 100) / 35)}% (${user.result}/35)\n`;
              });
              await bot.telegram.sendMessage(channelId, rankingMessage);
            } else {
              console.log(`No users found for mock #${mock.id}`);
            }

            // Mark this mock as having sent the message
            sentMessages[mock.id] = true;
          } else {
            console.log(`No results found for mock #${mock.id}`);
          }
        } catch (error) {
          console.log(error);
        }
      }
    }
  } catch (error) {
    console.error("Error in notifyMockEnd:", error);
  }
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
