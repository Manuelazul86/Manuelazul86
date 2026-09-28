/**
 * Test environment defaults.
 *
 * These are obvious placeholders, never real credentials: modules that
 * read env at import time need *something* present, and the tests that
 * care about a specific value set it themselves.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.N8N_API_SECRET ??= "test-n8n-secret";
process.env.WHATSAPP_ACCESS_TOKEN ??= "test-access-token";
process.env.WHATSAPP_PHONE_NUMBER_ID ??= "000000000000000";
process.env.WHATSAPP_VERIFY_TOKEN ??= "test-verify-token";
process.env.WHATSAPP_MOCK_MODE ??= "true";
