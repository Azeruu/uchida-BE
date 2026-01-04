import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from '@prisma/adapter-pg';
import { cors } from 'hono/cors';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import "dotenv/config";

// 1. Singleton Pattern untuk Prisma (Wajib untuk Next.js/Hono Dev Mode)
// ✅ PERBAIKAN LOGIKA SINGLETON
const globalForPrisma = global as unknown as { prisma: PrismaClient | undefined };

// Inisialisasi PrismaClient dengan adapter
if (!globalForPrisma.prisma) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set in environment variables');
  }

  const adapter = new PrismaPg({
    connectionString: databaseUrl,
  });

  globalForPrisma.prisma = new PrismaClient({
    adapter,
  });
}

const prisma = globalForPrisma.prisma;
// 2. Definisi Type untuk Context Hono
type Variables = {
  user: {
    email: string;
    role: string;
  };
};

const app = new Hono<{ Variables: Variables }>();

// ============ CONFIG ============
const PORT = Number(process.env.PORT) || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'uchida-jwt-secret-key-2024';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://uchida-fe.vercel.app';
const EXTRA_ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  FRONTEND_URL,
  ...EXTRA_ALLOWED_ORIGINS,
];

// ============ MIDDLEWARE ============

app.use('/*', cors({
  origin: (origin) => {
    if (!origin) return allowedOrigins[0];
    if (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      return origin;
    }
    return allowedOrigins[0];
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Auth Middleware dengan Typing yang Benar
const authMiddleware = async (c: any, next: any) => {
  const token = getCookie(c, 'auth_token');

  if (!token) {
    return c.json({ success: false, message: 'Tidak ada token, silakan login' }, 401);
  }

  try {
    const decoded = await verify(token, JWT_SECRET);
    // Hono secara otomatis tahu tipe 'user' karena definisi Generic di atas
    c.set('user', decoded);
    await next();
  } catch (error) {
    return c.json({ success: false, message: 'Token tidak valid atau expired' }, 401);
  }
};

const adminMiddleware = async (c: any, next: any) => {
  const token = getCookie(c, 'auth_token');

  if (!token) {
    return c.json({ success: false, message: 'Tidak ada token, silakan login' }, 401);
  }

  try {
    const decoded = await verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return c.json({ success: false, message: 'Akses ditolak.' }, 403);
    }
    c.set('user', decoded);
    await next();
  } catch (error) {
    return c.json({ success: false, message: 'Token tidak valid' }, 401);
  }
};

// ============ HELPER FUNCTIONS ============
function generatePairs(count = 525) {
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push({ 
      a: Math.floor(Math.random() * 7) + 3, 
      b: Math.floor(Math.random() * 7) + 3 
    });
  }
  return result;
}

// ============ ROUTES ============

app.get('/api/health', (c) => c.json({ status: 'OK', message: 'Server is running' }));

// --- LOGIN ---
app.post('/api/login', async (c) => {
  try {
    const { email, password } = await c.req.json();

    // Admin Hardcoded Check
    if (email === 'admin.kim@gmail.com' && password === 'kimkantor1') {
      const token = await sign({ email, role: 'admin' }, JWT_SECRET);
      setCookie(c, 'auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
        maxAge: 86400,
        path: '/',
      });
      return c.json({ success: true, user: { email, role: 'admin' } });
    }

    // Prisma Check
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && await bcrypt.compare(password, user.password)) {
      const token = await sign({ email: user.email, role: user.role }, JWT_SECRET);
      setCookie(c, 'auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
        maxAge: 86400,
        path: '/',
      });
      return c.json({ success: true, user: { email: user.email, role: user.role } });
    }

    return c.json({ success: false, message: 'Email atau password salah' }, 401);
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ success: false, message: 'Internal server error' }, 500);
  }
});

app.post('/api/logout', (c) => {
  deleteCookie(c, 'auth_token', { path: '/' });
  return c.json({ success: true, message: 'Logout berhasil' });
});

app.get('/api/me', authMiddleware, (c) => {
  const user = c.get('user');
  return c.json({ success: true, user });
});

// --- CONFIG ---
app.get('/api/config', async (c) => {
  const latestQuestion = await prisma.question.findFirst({
    orderBy: { createdAt: 'desc' },
  });

  const questionCount = latestQuestion?.totalQuestions ?? 525;
  const durationSeconds = latestQuestion?.durationSeconds ?? 900;

  return c.json({
    success: true,
    data: {
      durationSeconds,
      questionCount,
      pairs: generatePairs(questionCount),
    },
  });
});

app.post('/api/config', adminMiddleware, async (c) => {
  const { durationSeconds, questionCount, pairs, regenerate } = await c.req.json();

  const finalCount = Number(questionCount) || 525;
  const finalDuration = Number(durationSeconds) || 900;
  
  let finalPairs = generatePairs(finalCount);

  // Jika tidak regenerate dan ada pairs valid dari client
  if (!regenerate && Array.isArray(pairs) && pairs.length === finalCount) {
    // Validasi sederhana
    const isValid = pairs.every((p: any) => p.a >= 3 && p.b >= 3);
    if (isValid) finalPairs = pairs;
  }

  await prisma.question.create({
    data: {
      totalQuestions: finalCount,
      durationSeconds: finalDuration,
    },
  });

  return c.json({
    success: true,
    data: {
      durationSeconds: finalDuration,
      questionCount: finalCount,
      pairs: finalPairs,
    },
  });
});

app.get('/api/questions', adminMiddleware, async (c) => {
  const questions = await prisma.question.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50, // Best Practice: Batasi jumlah row agar tidak overload
  });
  return c.json({ success: true, data: questions });
});

// --- TEST RESULTS (Optimized) ---

app.post('/api/test-results', async (c) => {
  try {
    const body = await c.req.json();
    
    // Validasi input manual
    if (!body.participantName || !body.participantEmail) {
      return c.json({ success: false, error: 'Name and Email required' }, 400);
    }

    const testResult = await prisma.testResult.create({
      data: {
        participantName: body.participantName,
        participantEmail: body.participantEmail,
        totalQuestions: Number(body.totalQuestions),
        correctAnswers: Number(body.correctAnswers),
        score: Number(body.score),
        totalTime: Number(body.totalTime),
        // PERBAIKAN PRISMA 7: Jangan gunakan JSON.stringify jika kolom DB bertipe Json
        answers: body.answers, 
      },
    });

    return c.json({ success: true, data: testResult }, 201);
  } catch (error) {
    console.error('Create result error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

app.get('/api/test-results', async (c) => {
  const results = await prisma.testResult.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100, // Pagination sederhana
  });
  return c.json({ success: true, data: results });
});

app.get('/api/test-results/:id', async (c) => {
  const id = c.req.param('id');
  const result = await prisma.testResult.findUnique({ where: { id } });
  
  if (!result) return c.json({ success: false, error: 'Not found' }, 404);
  return c.json({ success: true, data: result });
});

app.get('/api/test-results/email/:email', async (c) => {
  const email = c.req.param('email');
  const results = await prisma.testResult.findMany({
    where: { participantEmail: email },
    orderBy: { createdAt: 'desc' },
  });
  return c.json({ success: true, data: results });
});

// --- STATISTICS (HEAVILY OPTIMIZED) ---
app.get('/api/statistics', async (c) => {
  try {
    // PRISMA 7 BEST PRACTICE: Gunakan Aggregate Database
    // Ini 100x lebih cepat daripada menarik semua data lalu di-loop di JS
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
        averageScore: aggregations._avg.score?.toFixed(2) || 0,
        averageTime: Math.round(aggregations._avg.totalTime || 0),
        highestScore: aggregations._max.score || 0,
        lowestScore: aggregations._min.score || 0,
      },
    });
  } catch (error) {
    console.error('Stats error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ============ SERVER ============
app.notFound((c) => c.json({ success: false, message: 'Not Found' }, 404));
app.onError((err, c) => {
  console.error('Global error:', err);
  return c.json({ success: false, message: 'Internal Server Error' }, 500);
});

console.log(`🚀 Server starting on port ${PORT}`);

export default { port: PORT, fetch: app.fetch };