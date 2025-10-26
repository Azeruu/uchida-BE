// server.js
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
const allowedOrigins = [
  "http://localhost:5173",
  "https://uchida-fe.vercel.app",
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, curl, etc)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        return callback(new Error("CORS policy disallows access"), false);
      }
      return callback(null, true);
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'uchida-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Supabase Admin Client (for server-side operations)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// Helper to generate random pairs (3-9 only)
function generatePairs(count = 525) {
  const result = [];
  for (let i = 0; i < count; i++) {
    // Angka 3-9 saja (tidak ada 0, 1, 2)
    const a = Math.floor(Math.random() * 7) + 3; // 3-9
    const b = Math.floor(Math.random() * 7) + 3; // 3-9
    result.push({ a, b });
  }
  return result;
}

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Authentication routes
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  
  // Check admin credentials
  if (email === 'admin.kim@gmail.com' && password === 'kimkantor1') {
    req.session.user = { email, role: 'admin' };
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
  req.session.destroy();
  res.json({ success: true, message: 'Logout berhasil' });
});

app.get('/api/me', (req, res) => {
  if (req.session.user) {
    res.json({ success: true, user: req.session.user });
  } else {
    res.status(401).json({ success: false, message: 'Tidak ada session aktif' });
  }
});

// Middleware to check admin authentication
const requireAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ success: false, message: 'Akses ditolak. Login sebagai admin diperlukan.' });
  }
};

// Get current test configuration
app.get('/api/config', async (req, res) => {
  try {
    // Get the latest questions config from database using admin client
    const { data: questionsData, error: questionsError } = await supabaseAdmin
      .from('questions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (questionsError) {
      console.error('Supabase error:', questionsError);
      return res.status(500).json({ error: questionsError.message });
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
      
      // Generate pairs based on questionCount
      config.pairs = generatePairs(config.questionCount);
    } else {
      // If no data in database, create default
      config.pairs = generatePairs(config.questionCount);
    }

    res.json({
      message: 'Config retrieved successfully',
      data: config
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update test configuration (admin only)
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

    // Generate pairs based on questionCount
    let finalPairs = generatePairs(finalQuestionCount);

    if (regenerate === true) {
      finalPairs = generatePairs(finalQuestionCount);
    }

    if (Array.isArray(pairs) && pairs.length > 0) {
      // Sanitize to ensure each pair has integers 3-9
      const sanitizedPairs = pairs
        .map(p => ({ a: Number(p.a), b: Number(p.b) }))
        .filter(p => Number.isInteger(p.a) && Number.isInteger(p.b) && p.a >= 3 && p.a <= 9 && p.b >= 3 && p.b <= 9);
      
      if (sanitizedPairs.length === finalQuestionCount) {
        finalPairs = sanitizedPairs;
      }
    }

    // Save to database using admin client
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
      return res.status(500).json({ error: error.message });
    }

    const config = {
      durationSeconds: finalDurationSeconds,
      questionCount: finalQuestionCount,
      pairs: finalPairs
    };

    res.json({
      message: 'Config updated successfully',
      data: config
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get questions history (admin only)
app.get('/api/questions', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('questions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    res.json({
      message: 'Questions history retrieved successfully',
      data: data
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Submit test result
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

    // Validate required fields
    if (!participantName || !participantEmail) {
      return res.status(400).json({ 
        error: 'participantName and participantEmail are required' 
      });
    }

    // Insert test result
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
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json({
      message: 'Test result saved successfully',
      data: data[0]
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all test results
app.get('/api/test-results', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('test_results')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    res.json({
      message: 'Test results retrieved successfully',
      data: data
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get test result by ID
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
      return res.status(500).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: 'Test result not found' });
    }

    res.json({
      message: 'Test result retrieved successfully',
      data: data
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get test results by email
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
      return res.status(500).json({ error: error.message });
    }

    res.json({
      message: 'Test results retrieved successfully',
      data: data
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get statistics
app.get('/api/statistics', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('test_results')
      .select('*');

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: error.message });
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
      message: 'Statistics retrieved successfully',
      data: statistics
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;