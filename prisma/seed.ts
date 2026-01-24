import { PrismaClient, Prisma } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import * as dotenv from "dotenv"; // Tambahkan ini

dotenv.config();

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({
  adapter,
});

async function main() {
  console.log("🌱 Starting database seed...");

  // 1. ADMIN USER
  const hashedPassword = await bcrypt.hash("kimkantor1", 10);
  
  const admin = await prisma.user.upsert({
    where: { email: "admin.kim@gmail.com" },
    update: { password: hashedPassword },
    create: {
      email: "admin.kim@gmail.com",
      password: hashedPassword,
      role: "admin",
    },
  });
  console.log("✅ Admin user ready:", admin.email);

  // 2. CONFIG
  const existingConfig = await prisma.question.findFirst();
  if (!existingConfig) {
    await prisma.question.create({
      data: {
        totalQuestions: 525,
        durationSeconds: 15 * 60,
      },
    });
    console.log("✅ Default config created");
  } else {
    console.log("ℹ️ Config already exists");
  }

  // 3. SAMPLE DATA (Menggunakan Type Casting yang aman untuk TSX)
  const sampleData = [
    {
      participantName: "John Doe",
      participantEmail: "john@example.com",
      totalQuestions: 525,
      correctAnswers: 450,
      score: 85.71,
      totalTime: 720,
      answers: JSON.stringify([
        { a: 3, b: 4, userAnswer: 12, correctAnswer: 12, isCorrect: true },
        { a: 5, b: 6, userAnswer: 30, correctAnswer: 30, isCorrect: true },
      ]),
    },
  ];

  for (const data of sampleData) {
    const exists = await prisma.testResult.findFirst({
      where: { participantEmail: data.participantEmail }
    });

    if (!exists) {
      await prisma.testResult.create({
        data: {
          ...data,
          participantPendidikan: "SMA",
          participantNoHp: "081234567890",
        },
      });
      console.log(`✅ Result created for: ${data.participantName}`);
    }
  }

  console.log("🎉 Seeding completed!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });