# Fix RLS Policy Error

## 🚨 Error yang Terjadi
```
Gagal menyimpan konfigurasi: new row violates row-level security policy for table "questions"
```

## 🔧 Solusi

### 1. **Tambahkan SUPABASE_SERVICE_ROLE_KEY ke .env**

Buat file `.env` di folder `uchida-backend/` dengan isi:

```env
SUPABASE_URL=your_supabase_url_here
SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
PORT=3001
SESSION_SECRET=your_session_secret_here
```

### 2. **Jalankan SQL Script untuk Fix RLS**

Jalankan script SQL berikut di Supabase SQL Editor:

```sql
-- Enable RLS on questions table
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;

-- Create policy to allow authenticated users to read questions
CREATE POLICY "Allow authenticated users to read questions" ON questions
    FOR SELECT
    TO authenticated
    USING (true);

-- Create policy to allow authenticated users to insert questions
CREATE POLICY "Allow authenticated users to insert questions" ON questions
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Create policy to allow authenticated users to update questions
CREATE POLICY "Allow authenticated users to update questions" ON questions
    FOR UPDATE
    TO authenticated
    USING (true);

-- Create policy to allow authenticated users to delete questions
CREATE POLICY "Allow authenticated users to delete questions" ON questions
    FOR DELETE
    TO authenticated
    USING (true);
```

### 3. **Restart Backend Server**

```bash
cd uchida-backend
npm start
```

## 🎯 **Penjelasan Masalah**

1. **RLS (Row Level Security)** di Supabase memblokir akses ke tabel `questions`
2. **Service Role Key** diperlukan untuk operasi server-side
3. **Policies** harus dibuat untuk mengizinkan akses

## ✅ **Setelah Fix**

- ✅ Admin bisa menyimpan konfigurasi
- ✅ Data tersimpan ke database
- ✅ Riwayat konfigurasi tampil
- ✅ Test page menggunakan konfigurasi terbaru

## 🔍 **Cara Cek Service Role Key**

1. Buka Supabase Dashboard
2. Go to Settings → API
3. Copy "service_role" key (bukan anon key)
4. Paste ke `.env` sebagai `SUPABASE_SERVICE_ROLE_KEY`
