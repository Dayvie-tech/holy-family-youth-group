import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.102.0';

// This is the public publishable key. Never place a service-role or secret key here.
export const SUPABASE_URL = 'https://thhfvrlpywmgmlpondnj.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Jo_exHfxJIfWTbJHws4BuA_7Es161-E';
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

export function authCallbackUrl() {
  return new URL('./auth-callback.html', window.location.href).href;
}
