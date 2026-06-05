import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://jehqbmchbveyiqdvdyua.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplaHFibWNoYnZleWlxZHZkeXVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mzk5NDcsImV4cCI6MjA5MDQxNTk0N30.J--Jfr4PX34HMIa0fICxRSuvqA5W8mXNKPtnDsZIxmc';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);