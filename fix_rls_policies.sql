-- Fix RLS policies for questions table

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

-- Alternative: If you want to allow anonymous access (for public API)
-- Uncomment the following lines if you want to allow anonymous access:

-- CREATE POLICY "Allow anonymous users to read questions" ON questions
--     FOR SELECT
--     TO anon
--     USING (true);

-- CREATE POLICY "Allow anonymous users to insert questions" ON questions
--     FOR INSERT
--     TO anon
--     WITH CHECK (true);
