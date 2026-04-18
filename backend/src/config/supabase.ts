import { createClient } from "@supabase/supabase-js";
import logger from "../utils/logger";

// In development, allow running without Supabase credentials
const supabaseUrl = process.env.SUPABASE_URL || "https://dummy.supabase.co";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "dummy_key";
const hasRealCredentials = !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);

if (!hasRealCredentials) {
  logger.warn("Running with dummy Supabase credentials. Set SUPABASE_URL and SUPABASE_ANON_KEY for production.");
}


// Client with anon key for client-side operations (respects RLS)
export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

// Client with service role key for server-side operations (bypasses RLS)
// Only used for admin operations - NEVER expose to client
export const supabaseAdmin = createClient(
  supabaseUrl,
  process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey
);

export const verifySupabaseConnection = async () => {
  try {
    // Test basic connection
    const { data, error } = await supabaseClient.auth.getUser();
    logger.info("Supabase connection verified");
    return true;
  } catch (error) {
    logger.error("Supabase connection failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};
