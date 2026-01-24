import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import "dotenv/config";

// ============ CONFIG ============
const NODE_ENV = process.env.NODE_ENV || "development";
const PORT = Number(process.env.PORT) || 8080;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// PENTING: JWT Secret harus konsisten dan STRONG
// Gunakan secret yang sama di semua environment
const JWT_SECRET =
  process.env.JWT_SECRET ||
  "uchida-jwt-secret-key-2026-super-secret-must-be-same";

console.log("═══════════════════════════════════════════");
console.log("🔧 SERVER CONFIGURATION");
console.log("═══════════════════════════════════════════");
console.log("NODE_ENV:", NODE_ENV);
console.log("PORT:", PORT);
console.log("FRONTEND_URL:", FRONTEND_URL);
console.log("JWT_SECRET configured:", JWT_SECRET ? "✅ YES" : "❌ NO");
console.log("JWT_SECRET length:", JWT_SECRET.length, "chars");
console.log("═══════════════════════════════════════════\n");

// Parse allowed origins
const EXTRA_ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter((o) => o.length > 0);

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  FRONTEND_URL,
  ...EXTRA_ALLOWED_ORIGINS,
];

console.log("Allowed Origins:");
allowedOrigins.forEach((o) => console.log(`  - ${o}`));
console.log("");

// ============ TYPE DEFINITIONS ============
type Variables = {
  user?: {
    email: string;
    role: string;
    iat?: number;
    exp?: number;
  };
};

const app = new Hono<{ Variables: Variables }>();

// ============ CORS MIDDLEWARE ============
app.use(
  "/*",
  cors({
    origin: (origin:any) => {
      if (!origin) {
        console.log("🌐 [CORS] No origin (non-browser)");
        return true;
      }
      console.log(`🌐 [CORS] Origin: ${origin} → ✅ ALLOWED`);
      return origin;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "Origin",
      "Access-Control-Request-Method",
      "Access-Control-Request-Headers",
      "X-Requested-With",
    ],
    exposeHeaders: ["Set-Cookie", "Content-Type"],
    maxAge: 600,
  }),
);

// ============ SECURITY HEADERS ============
app.use("/*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  await next();
});

// ============ REQUEST LOGGING ============
app.use("/*", async (c, next) => {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;
  console.log(
    `${status === 200 ? "✅" : "❌"} ${method.padEnd(6)} ${path.padEnd(20)} [${duration}ms]`,
  );
});

// ============ HELPER: TOKEN VERIFICATION ============
const verifyTokens = async (token: string): Promise<any> => {
  const secrets = [
    JWT_SECRET, // Primary secret
    "uchida-jwt-secret-key-2026", // Fallback 1
    "uchida-jwt-secret-key-2024", // Fallback 2
  ];

  for (let i = 0; i < secrets.length; i++) {
    try {
      const decoded = await verify(token, secrets[i]);
      if (decoded) {
        console.log(`   🔑 Token verified with secret #${i + 1}`);
        return decoded;
      }
    } catch (e) {
      continue;
    }
  }

  throw new Error("Token verification failed with all secrets");
};

// ============ HELPER: GET TOKEN FROM REQUEST ============
const getTokenFromRequest = (c: any): string | null => {
  // 1. Try from Authorization header (Bearer token)
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    console.log("   📌 Token from Authorization header");
    return token;
  }

  // 2. Try from cookie
  const cookieToken = getCookie(c, "auth_token");
  if (cookieToken) {
    console.log("   🍪 Token from cookie");
    return cookieToken;
  }

  // 3. Try from query parameter
  const queryToken = c.req.query("token");
  if (queryToken) {
    console.log("   ❓ Token from query parameter");
    return queryToken;
  }

  return null;
};

// ============ AUTH MIDDLEWARE ============
const authMiddleware = async (c: any, next: any) => {
  console.log("🔐 [AUTH] Checking authentication...");

  const token = getTokenFromRequest(c);

  if (!token) {
    console.log("   ❌ No token found");
    return c.json({ success: false, message: "No token, please login" }, 401);
  }

  try {
    console.log("   ✓ Token found, verifying...");
    const decoded = await verifyTokens(token);

    if (!decoded) {
      console.log("   ❌ Token verification returned null");
      return c.json({ success: false, message: "Invalid token" }, 401);
    }

    console.log(
      `   ✅ Token valid. User: ${decoded.email}, Role: ${decoded.role}`,
    );
    c.set("user", decoded);
    await next();
  } catch (error: any) {
    console.log(`   ❌ Token verification failed: ${error.message}`);
    return c.json({ success: false, message: "Token invalid or expired" }, 401);
  }
};

// ============ ROUTES ============

// Health check
app.get("/api/health", (c) => {
  return c.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
  });
});

// CORS test
app.get("/api/cors-test", (c) => {
  const origin = c.req.header("origin");
  return c.json({
    success: true,
    message: "CORS is working",
    yourOrigin: origin || "no-origin",
  });
});

// JWT test - untuk generate token manual
app.post("/api/test-jwt", async (c) => {
  try {
    console.log("🧪 [TEST JWT] Generating test token...");

    const testUser = {
      email: "test@example.com",
      role: "admin",
    };

    const token = await sign(testUser, JWT_SECRET);

    console.log(`   ✅ Token generated: ${token.substring(0, 50)}...`);

    return c.json({
      success: true,
      message: "Test token generated",
      token,
      secret: JWT_SECRET,
      user: testUser,
      instructions:
        "Copy token and test it with /me endpoint using Authorization: Bearer <token>",
    });
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// LOGIN - PERBAIKAN UTAMA
app.post("/api/login", async (c) => {
  try {
    console.log("🔐 [LOGIN] Processing login request...");

    const body = await c.req.json();
    const { email, password } = body;

    console.log(`   📧 Email: ${email}`);
    console.log(`   🔑 Password: ${password ? "***" : "EMPTY"}`);

    // Hardcoded admin check
    if (email === "admin.kim@gmail.com" && password === "kimkantor1") {
      console.log("   ✅ Credentials match admin");

      // Generate JWT token dengan PRIMARY secret
      const token = await sign(
        {
          email: "admin.kim@gmail.com",
          role: "admin",
        },
        JWT_SECRET, // PENTING: gunakan primary secret untuk sign
      );

      console.log(`   🔑 Token generated: ${token.substring(0, 50)}...`);
      console.log(`   🔑 Token length: ${token.length}`);

      // Set HTTP-only cookie
      setCookie(c, "auth_token", token, {
        httpOnly: true,
        secure: NODE_ENV === "production",
        sameSite: NODE_ENV === "production" ? "None" : "Lax",
        maxAge: 86400, // 24 hours
        path: "/",
      });

      console.log("   🍪 HTTP-only cookie set");

      const response = {
        success: true,
        message: "Login successful",
        token, // Kirim token di response untuk localStorage
        user: {
          email: "admin.kim@gmail.com",
          role: "admin",
        },
      };

      console.log("   📤 Sending response...");
      return c.json(response, 200);
    }

    console.log("   ❌ Invalid credentials");
    return c.json(
      { success: false, message: "Invalid email or password" },
      401,
    );
  } catch (error: any) {
    console.log(`   💥 Error: ${error.message}`);
    return c.json(
      { success: false, message: "Server error", error: error.message },
      500,
    );
  }
});

// LOGOUT
app.post("/api/logout", (c) => {
  console.log("🚪 [LOGOUT] Processing logout...");
  deleteCookie(c, "auth_token", { path: "/" });
  return c.json({ success: true, message: "Logout successful" });
});

// ME - Get current user
app.get("/api/me", authMiddleware, (c) => {
  const user = c.get("user");
  console.log("📋 [ME] Returning user info");
  return c.json({ success: true, user });
});

// ============ ERROR HANDLING ============
app.notFound((c) => {
  const path = c.req.path;
  console.log(`⚠️  [404] Not found: ${path}`);
  return c.json({ success: false, message: "Not Found" }, 404);
});

app.onError((err, c) => {
  console.error(`💥 [ERROR] ${err.message}`);
  return c.json({ success: false, message: "Internal Server Error" }, 500);
});

// ============ START SERVER ============
console.log(`\n🚀 Server starting on http://localhost:${PORT}`);
console.log(`📍 Try these endpoints:`);
console.log(`   GET  http://localhost:${PORT}/api/health`);
console.log(`   GET  http://localhost:${PORT}/api/cors-test`);
console.log(`   POST http://localhost:${PORT}/api/login`);
console.log(
  `   GET  http://localhost:${PORT}/api/me (with Authorization header)`,
);
console.log(
  `   POST http://localhost:${PORT}/api/test-jwt (debug JWT token)\n`,
);

export default { port: PORT, fetch: app.fetch };
