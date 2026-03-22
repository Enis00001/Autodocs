import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://jalnoewdbhbcjhgdaegz.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphbG5vZXdkYmhiY2poZ2RhZWd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjY5MjYsImV4cCI6MjA4OTM0MjkyNn0.l5kw9XwM7kTgLQBCe8iauEwV_usdWvGWwCFHDEs_UU0";

export const supabase = createClient(supabaseUrl, supabaseKey);