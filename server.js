// server.js
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'uchida-jwt-secret-key-2024';

const allowedOrigins = [
  "http://localhost:5173",
  "https://uchida-fe.vercel.app",
];

// ============ MIDDLEWARE ============
app.use(cookieParser());
app.use(express.json());
app.use(cors({
  origin: allowedOrigins,
  // origin: function (origin, callback) {
  //   if (!origin) return callback(null, true);
  //   if (allowedOrigins.indexOf(origin) === -1) {
  //     return callback(new Error("CORS policy disallows access"), false);
  //   }
  //   return callback(null, true);
  // },
  credentials: true,
}));

// JWT Verification Middleware
const verifyToken = (req, res, next) => {
  const token = req.cookies.auth_token;
  
  console.log('🔍 Checking token:', token ? 'exists' : 'not found');
  
  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Tidak ada token, silakan login' 
    });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    console.log('✅ Token verified:', decoded);
    next();
  } catch (error) {
    console.error('❌ Token verification failed:', error.message);
    return res.status(401).json({ 
      success: false, 
      message: 'Token tidak valid atau expired' 
    });
  }
};

// ✅ PERBAIKAN: requireAdmin pakai JWT
const requireAdmin = (req, res, next) => {
  const token = req.cookies.auth_token;
  
  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Tidak ada token, silakan login' 
    });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role === 'admin') {
      req.user = decoded;
      next();
    } else {
      return res.status(403).json({ 
        success: false, 
        message: 'Akses ditolak. Hanya admin yang bisa mengakses.' 
      });
    }
  } catch (error) {
    return res.status(401).json({ 
      success: false, 
      message: 'Token tidak valid atau expired' 
    });
  }
};

// ============ SUPABASE ============
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// ============ HELPER FUNCTIONS ============
function generatePairs(count = 525) {
  const result = [];
  for (let i = 0; i < count; i++) {
    const a = Math.floor(Math.random() * 7) + 3; // 3-9
    const b = Math.floor(Math.random() * 7) + 3; // 3-9
    result.push({ a, b });
  }
  return result;
}

// ============ ROUTES ============

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// ============ AUTH ROUTES ============
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  
  if (email === 'admin.kim@gmail.com' && password === 'kimkantor1') {
    const token = jwt.sign(
      { email, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });
    
    console.log('✅ Login successful, token created');
    
    res.json({ 
      success: true, 
      message: 'Login berhasil',
      user: { email, role: 'admin' }
    });
  } else {
    res.status(401).json({ 
      success: false, 
      message: 'Email atau password salah' 
    });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  });
  
  res.json({ 
    success: true, 
    message: 'Logout berhasil' 
  });
});

app.get('/api/me', verifyToken, (req, res) => {
  res.json({
    success: true,
    user: {
      email: req.user.email,
      role: req.user.role
    }
  });
});

// ============ CONFIG ROUTES ============
app.get('/api/config', async (req, res) => {
  try {
    const { data: questionsData, error: questionsError } = await supabaseAdmin
      .from('questions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (questionsError) {
      console.error('Supabase error:', questionsError);
      return res.status(500).json({ 
        success: false,
        error: questionsError.message 
      });
    }

    let config = {
      durationSeconds: 15 * 60,
      questionCount: 525,
      pairs: []
    };

    if (questionsData && questionsData.length > 0) {
      const latest = questionsData[0];
      config.questionCount = latest.total_questions || 525;
      config.durationSeconds = latest.duration_seconds || 15 * 60;
      config.pairs = generatePairs(config.questionCount);
    } else {
      config.pairs = generatePairs(config.questionCount);
    }

    res.json({
      success: true,
      message: 'Config retrieved successfully',
      data: config
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

app.post('/api/config', requireAdmin, async (req, res) => {
  try {
    const { durationSeconds, questionCount, pairs, regenerate } = req.body || {};

    let finalQuestionCount = 525;
    let finalDurationSeconds = 15 * 60;

    if (typeof questionCount === 'number' && questionCount > 0) {
      finalQuestionCount = Math.floor(questionCount);
    }

    if (typeof durationSeconds === 'number' && durationSeconds > 0) {
      finalDurationSeconds = Math.floor(durationSeconds);
    }

    let finalPairs = generatePairs(finalQuestionCount);

    if (regenerate === true) {
      finalPairs = generatePairs(finalQuestionCount);
    }

    if (Array.isArray(pairs) && pairs.length > 0) {
      const sanitizedPairs = pairs
        .map(p => ({ a: Number(p.a), b: Number(p.b) }))
        .filter(p => Number.isInteger(p.a) && Number.isInteger(p.b) && p.a >= 3 && p.a <= 9 && p.b >= 3 && p.b <= 9);
      
      if (sanitizedPairs.length === finalQuestionCount) {
        finalPairs = sanitizedPairs;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('questions')
      .insert([
        {
          total_questions: finalQuestionCount,
          duration_seconds: finalDurationSeconds,
          created_at: new Date().toISOString()
        }
      ])
      .select();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }

    const config = {
      durationSeconds: finalDurationSeconds,
      questionCount: finalQuestionCount,
      pairs: finalPairs
    };

    res.json({
      success: true,
      message: 'Config updated successfully',
      data: config
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

// ============ QUESTIONS ROUTES ============
app.get('/api/questions', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('questions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }

    res.json({
      success: true,
      message: 'Questions history retrieved successfully',
      data: data
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

// ============ TEST RESULTS ROUTES ============
app.post('/api/test-results', async (req, res) => {
  try {
    const {
      participantName,
      participantEmail,
      totalQuestions,
      correctAnswers,
      score,
      totalTime,
      answers
    } = req.body;

    if (!participantName || !participantEmail) {
      return res.status(400).json({ 
        success: false,
        error: 'participantName and participantEmail are required' 
      });
    }

    const { data, error } = await supabase
      .from('test_results')
      .insert([
        {
          participant_name: participantName,
          participant_email: participantEmail,
          total_questions: totalQuestions,
          correct_answers: correctAnswers,
          score: score,
          total_time: totalTime,
          answers: answers,
          created_at: new Date().toISOString()
        }
      ])
      .select();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }

    res.status(201).json({
      success: true,
      message: 'Test result saved successfully',
      data: data[0]
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

app.get('/api/test-results', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('test_results')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }

    res.json({
      success: true,
      message: 'Test results retrieved successfully',
      data: data
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

app.get('/api/test-results/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('test_results')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }

    if (!data) {
      return res.status(404).json({ 
        success: false,
        error: 'Test result not found' 
      });
    }

    res.json({
      success: true,
      message: 'Test result retrieved successfully',
      data: data
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

app.get('/api/test-results/email/:email', async (req, res) => {
  try {
    const { email } = req.params;

    const { data, error } = await supabase
      .from('test_results')
      .select('*')
      .eq('participant_email', email)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }

    res.json({
      success: true,
      message: 'Test results retrieved successfully',
      data: data
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

app.get('/api/statistics', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('test_results')
      .select('*');

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }

    const statistics = {
      totalTests: data.length,
      averageScore: data.length > 0 
        ? (data.reduce((sum, test) => sum + parseFloat(test.score), 0) / data.length).toFixed(2)
        : 0,
      averageTime: data.length > 0
        ? Math.round(data.reduce((sum, test) => sum + test.total_time, 0) / data.length)
        : 0,
      highestScore: data.length > 0
        ? Math.max(...data.map(test => parseFloat(test.score)))
        : 0,
      lowestScore: data.length > 0
        ? Math.min(...data.map(test => parseFloat(test.score)))
        : 0
    };

    res.json({
      success: true,
      message: 'Statistics retrieved successfully',
      data: statistics
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

// ============ ERROR HANDLERS ============
// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

// ============ START SERVER ============
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;