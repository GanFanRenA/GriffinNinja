// js/supabase.js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://pyeqijsawxypsgnnygtu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_io8yAlVAMLrIyY9M6puW7g_gsAKm2d0';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});