import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the two endpoint families that
     * authenticate themselves:
     *   /api/n8n/*            — bearer N8N_API_SECRET
     *   /api/webhooks/*       — Meta signature / verify token
     * Routing those through the session proxy would break them.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/n8n|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
