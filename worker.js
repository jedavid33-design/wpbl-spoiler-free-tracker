const WPBL_API_BASE = "https://stats.womensprobaseballleague.com/v1";

export default {
  async fetch(request) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    try {
      const url = new URL(request.url);

      if (url.pathname === "/games" && !url.searchParams.has("limit")) {
        url.searchParams.set("limit", "100");
      }

      const wpblUrl = WPBL_API_BASE + url.pathname + url.search;

      const response = await fetch(wpblUrl, {
        headers: {
          "Accept": "application/json"
        }
      });

      const body = await response.text();

      return new Response(body, {
        status: response.status,
        headers: {
          ...corsHeaders,
          "Content-Type":
            response.headers.get("Content-Type") || "application/json"
        }
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: "WPBL proxy error",
          message: error.message
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }
  }
};