import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { cors } from "hono/cors";
import { verifyToken, createClerkClient } from "@clerk/backend";
import "dotenv/config";

// ============ PRISMA SETUP ============
const globalForPrisma = global as unknown as {
  prisma: PrismaClient | undefined;
};

if (!globalForPrisma.prisma) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const adapter = new PrismaPg(
    new Pool({
      connectionString: databaseUrl,
    }),
  );

  globalForPrisma.prisma = new PrismaClient({
    adapter,
  });
}

const prisma = globalForPrisma.prisma;

// ============ CONFIG ============
const NODE_ENV = process.env.NODE_ENV || "development";
const PORT = Number(process.env.PORT) || 8080;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// Admin Emails helper (reads from both ADMIN_EMAILS or VITE_ADMIN_EMAILS for convenience)
const getAdminEmails = (): string[] => {
  const emailsStr = process.env.ADMIN_EMAILS || process.env.VITE_ADMIN_EMAILS || "";
  return emailsStr.split(",").map(e => e.trim()).filter(Boolean);
};

const EXTRA_ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  FRONTEND_URL,
  ...EXTRA_ALLOWED_ORIGINS,
];

if (NODE_ENV !== "production") {
  console.log("\n🚀 SERVER CONFIG:");
  console.log("   NODE_ENV:", NODE_ENV);
  console.log("   PORT:", PORT);
  console.log("   FRONTEND_URL:", FRONTEND_URL);
}

// ============ TYPE ============
type Variables = {
  user: {
    email: string;
    role: string;
    id: string;
  };
};

const app = new Hono<{ Variables: Variables }>();

// ============ CORS - COOKIE FRIENDLY ============
app.use(
  "/*",
  cors({
    origin: (origin: any) => {
      if (!origin) return true;
      const isAllowed = allowedOrigins.some(
        (o) => origin.toLowerCase() === o.toLowerCase(),
      );
      return isAllowed ? origin : false;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Accept", "Origin", "Authorization"],
    exposeHeaders: ["Set-Cookie"],
    maxAge: 86400,
  }),
);

// ============ SECURITY HEADERS ============
app.use("/*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "SAMEORIGIN");
  await next();
});

// ============ LOGGING ============
app.use("/*", async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  const status = c.res.status;
  if (NODE_ENV !== "production" || status >= 400) {
    console.log(`${status >= 400 ? "❌" : "✅"} ${c.req.method} ${c.req.path} [${ms}ms] ${status}`);
  }
});

// ============ ADMIN MIDDLEWARE ============
const adminMiddleware = async (c: any, next: any) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

  if (!token) {
    return c.json({ success: false, message: "Missing authentication token" }, 401);
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    console.error("❌ [AUTH] CLERK_SECRET_KEY is not configured in .env");
    return c.json({ success: false, message: "Server configuration error" }, 500);
  }

  try {
    const decoded = await verifyToken(token, { secretKey });
    
    // Check if email can be found in claims first (session tokens usually have it)
    // Otherwise fetch from Clerk API
    const clerkClient = createClerkClient({ secretKey });
    const user = await clerkClient.users.getUser(decoded.sub);
    const email = user.emailAddresses[0]?.emailAddress;

    const adminEmails = getAdminEmails();
    
    if (!email || !adminEmails.includes(email)) {
      console.log(`🚫 [AUTH] Access denied for: ${email || 'unknown user'}`);
      return c.json({ success: false, message: "Admin access required" }, 403);
    }

    c.set("user", { email, role: "admin", id: decoded.sub });
    await next();
  } catch (error: any) {
    console.log(`⚠️ [AUTH] Token invalid: ${error.message}`);
    return c.json({ success: false, message: "Invalid or expired token" }, 401);
  }
};

// ============ HELPER: Generate pairs ============
function generatePairs(count = 525) {
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push({
      a: Math.floor(Math.random() * 7) + 3,
      b: Math.floor(Math.random() * 7) + 3,
    });
  }
  return result;
}

// ============ ROUTES ============

// Health check
app.get("/api/health", (c) => {
  return c.json({ status: "OK", message: "Server running" });
});

// CORS test
app.get("/api/cors-test", (c) => {
  return c.json({ success: true, message: "CORS working" });
});

// ============ CONFIG ============
app.get("/api/config", async (c) => {
  try {
    const latestQuestion = await prisma.question.findFirst({
      orderBy: { createdAt: "desc" },
    });

    const questionCount = latestQuestion?.totalQuestions ?? 525;
    const durationSeconds = latestQuestion?.durationSeconds ?? 900;
    const maxIncorrectAnswers =
      (latestQuestion as any)?.maxIncorrectAnswers ?? 7;
    const minQuestionsPerMinute =
      (latestQuestion as any)?.minQuestionsPerMinute ?? 35;

    return c.json({
      success: true,
      data: {
        questionCount,
        durationSeconds,
        maxIncorrectAnswers,
        minQuestionsPerMinute,
        pairs: generatePairs(questionCount),
      },
    });
  } catch (error: any) {
    console.error("Config error:", error.message);
    return c.json({ success: false, error: "Server error" }, 500);
  }
});

app.post("/api/config", adminMiddleware, async (c) => {
  try {
    console.log("\n⚙️  [CONFIG UPDATE]");

    const {
      durationSeconds,
      questionCount,
      maxIncorrectAnswers,
      minQuestionsPerMinute,
      pairs,
      regenerate,
    } = await c.req.json();

    const finalCount = Number(questionCount) || 525;
    const finalDuration = Number(durationSeconds) || 900;
    let finalMaxIncorrect = Number(maxIncorrectAnswers);
    if (isNaN(finalMaxIncorrect)) finalMaxIncorrect = 7;
    let finalMinQPM = Number(minQuestionsPerMinute);
    if (isNaN(finalMinQPM)) finalMinQPM = 35;

    let finalPairs = generatePairs(finalCount);

    if (!regenerate && Array.isArray(pairs) && pairs.length === finalCount) {
      const isValid = pairs.every((p: any) => p.a >= 3 && p.b >= 3);
      if (isValid) finalPairs = pairs;
    }

    const newQuestion = await prisma.question.create({
      data: {
        totalQuestions: finalCount,
        durationSeconds: finalDuration,
      },
    });

    // Update additional fields
    await (prisma as any)
      .$executeRaw`UPDATE "questions" SET "max_incorrect_answers" = ${finalMaxIncorrect}, "min_questions_per_minute" = ${finalMinQPM} WHERE "id" = ${newQuestion.id}`.catch(
      () => {},
    );

    return c.json({
      success: true,
      data: {
        durationSeconds: finalDuration,
        questionCount: finalCount,
        maxIncorrectAnswers: finalMaxIncorrect,
        minQuestionsPerMinute: finalMinQPM,
        pairs: finalPairs,
      },
    });
  } catch (error: any) {
    console.error("Config error:", error.message);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ QUESTIONS ============
app.get("/api/questions", adminMiddleware, async (c) => {
  try {
    const questions = await prisma.question.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return c.json({ success: true, data: questions });
  } catch (error: any) {
    console.error("Questions error:", error.message);
    return c.json({ success: false, error: "Server error" }, 500);
  }
});

// ============ TEST RESULTS ============
app.post("/api/test-results", async (c) => {
  try {
    console.log("\n💾 [TEST RESULT SAVE]");

    const body = await c.req.json();

    if (!body.participantName || !body.participantEmail) {
      return c.json({ success: false, error: "Missing required fields" }, 400);
    }

    const testResult = await prisma.testResult.create({
      data: {
        participantName: body.participantName,
        participantEmail: body.participantEmail,
        participantPendidikan: body.participantPendidikan,
        participantNoHp: body.participantNoHp,
        totalQuestions: Number(body.totalQuestions),
        correctAnswers: Number(body.correctAnswers),
        score: Number(body.score),
        isPassed: Boolean(body.isPassed),
        totalTime: Number(body.totalTime),
        answers: body.answers,
      },
    });

    return c.json({ success: true, data: testResult }, 201);
  } catch (error: any) {
    console.error("Result save error:", error.message);
    return c.json({ success: false, error: "Server error" }, 500);
  }
});

app.get("/api/test-results", adminMiddleware, async (c) => {
  try {
    const results = await prisma.testResult.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return c.json({ success: true, data: results });
  } catch (error: any) {
    console.error("Results error:", error.message);
    return c.json({ success: false, error: "Server error" }, 500);
  }
});

app.get("/api/test-results/:id", adminMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const result = await prisma.testResult.findUnique({ where: { id } });

    if (!result) return c.json({ success: false, error: "Not found" }, 404);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: "Server error" }, 500);
  }
});

app.get("/api/test-results/email/:email", async (c) => {
  try {
    const email = c.req.param("email");
    const results = await prisma.testResult.findMany({
      where: { participantEmail: email },
      orderBy: { createdAt: "desc" },
    });
    return c.json({ success: true, data: results });
  } catch (error: any) {
    return c.json({ success: false, error: "Server error" }, 500);
  }
});

app.delete("/api/test-results/:id", adminMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    await prisma.testResult.delete({ where: { id } });
    return c.json({ success: true, message: "Deleted" });
  } catch (error: any) {
    console.error("Delete error:", error.message);
    return c.json({ success: false, error: "Server error" }, 500);
  }
});

// ============ STATISTICS ============
app.get("/api/statistics", adminMiddleware, async (c) => {
  try {
    console.log("\n📊 [STATISTICS]");

    const aggregations = await prisma.testResult.aggregate({
      _count: { id: true },
      _avg: { score: true, totalTime: true },
      _max: { score: true },
      _min: { score: true },
    });

    return c.json({
      success: true,
      data: {
        totalTests: aggregations._count.id,
        averageScore: aggregations._avg.score
          ? parseFloat(aggregations._avg.score.toFixed(2))
          : 0,
        averageTime: aggregations._avg.totalTime
          ? Math.round(aggregations._avg.totalTime)
          : 0,
        highestScore: aggregations._max.score || 0,
        lowestScore: aggregations._min.score || 0,
      },
    });
  } catch (error: any) {
    console.error("Stats error:", error.message);
    return c.json({ success: false, error: "Server error" }, 500);
  }
});

// ============ ERROR HANDLING ============
app.notFound((c) => c.json({ success: false, message: "Not found" }, 404));
app.onError((err, c) => {
  console.error("Global error:", err);
  return c.json({ success: false, message: "Server error" }, 500);
});

console.log(`🚀 Server starting on port ${PORT}\n`);

export default { port: PORT, fetch: app.fetch };
