// Load the Supabase SDK with a second CDN available if the primary module host fails.
let createClient;
try {
  ({ createClient } = await import('https://esm.sh/@supabase/supabase-js@2.102.0'));
} catch (primaryError) {
  console.warn('Primary Supabase SDK CDN unavailable; trying the fallback CDN.', primaryError);
  try {
    ({ createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.102.0/+esm'));
  } catch (fallbackError) {
    console.error('Both Supabase SDK CDNs failed to load.', fallbackError);
    throw new Error('The sign-in service could not load. Check your internet connection and reload the page.');
  }
}

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
