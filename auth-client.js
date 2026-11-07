// Load the pinned Supabase SDK without leaving the portal stuck on "Connecting…".
// A CDN can stall without rejecting, so every loading attempt has a timeout.
const SDK_VERSION = '2.119.0';
const SDK_TIMEOUT_MS = 12000;

function withTimeout(promise, source) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(source + ' timed out')), SDK_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function loadUmdSdk(url) {
  return withTimeout(new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => {
      if (typeof window.supabase?.createClient === 'function') {
        resolve(window.supabase.createClient);
      } else {
        reject(new Error('Supabase SDK loaded without its browser client'));
      }
    };
    script.onerror = () => reject(new Error('Could not load ' + url));
    document.head.append(script);
  }), 'Supabase browser SDK');
}

let createClient;
const loadingErrors = [];

try {
  ({ createClient } = await withTimeout(
    import('https://esm.sh/@supabase/supabase-js@' + SDK_VERSION),
    'Primary Supabase CDN'
  ));
} catch (primaryError) {
  loadingErrors.push(primaryError);
  console.warn('Primary Supabase SDK CDN unavailable; trying the browser bundle.', primaryError);

  try {
    createClient = await loadUmdSdk(
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@' + SDK_VERSION
    );
  } catch (jsdelivrError) {
    loadingErrors.push(jsdelivrError);
    console.warn('jsDelivr Supabase browser bundle unavailable; trying unpkg.', jsdelivrError);

    try {
      createClient = await loadUmdSdk(
        'https://unpkg.com/@supabase/supabase-js@' + SDK_VERSION
      );
    } catch (unpkgError) {
      loadingErrors.push(unpkgError);
      console.error('All Supabase SDK loading methods failed.', loadingErrors);
      throw new Error('The sign-in service could not load from the available CDNs. Check your connection, then reload the page.');
    }
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
