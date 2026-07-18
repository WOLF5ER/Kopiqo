// ============================================================================
// Kopiqo — единый клиент Supabase.
// Ключи берутся из env.js (window.__KOPIQO_ENV__), в коде ничего не захардкожено.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const env = window.__KOPIQO_ENV__ || {};

if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
  throw new Error(
    "Kopiqo: не заданы SUPABASE_URL / SUPABASE_ANON_KEY. " +
      "Скопируйте env.example.js в env.js и заполните значения."
  );
}

export const SUPABASE_URL = env.SUPABASE_URL;
export const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;

// Домен, в который «упаковывается» никнейм для Supabase Auth.
// Пользователь этот email никогда не видит.
export const EMAIL_DOMAIN = "kopiqo.app";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,       // стандартная сессия Supabase в localStorage
    autoRefreshToken: true,     // автоматическое продление сессии
    detectSessionInUrl: false,  // magic-links не используются
  },
});

/** Преобразование никнейма в служебный email для Supabase Auth. */
export function nicknameToEmail(nickname) {
  return `${String(nickname).trim().toLowerCase()}@${EMAIL_DOMAIN}`;
}
