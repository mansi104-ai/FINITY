/**
 * Geolocation and Market Detection Service
 * Detects user location from IP and determines appropriate stock market
 */

export interface GeoLocation {
  country: string;
  countryCode: string;
  timezone: string;
  market: StockMarket;
}

export interface StockMarket {
  name: string;
  code: string;
  timezone: string;
  openHour: number;
  openMinute: number;
  closeHour: number;
  closeMinute: number;
  openDays: number[]; // 0-6 (Sunday-Saturday)
  label: string;
}

type RequestLike = {
  headers: Record<string, string | string[] | undefined>;
  socket?: {
    remoteAddress?: string;
  };
};

// Market definitions by timezone
const MARKET_DEFINITIONS: Record<string, StockMarket> = {
  "Asia/Kolkata": {
    name: "National Stock Exchange India",
    code: "NSE",
    timezone: "Asia/Kolkata",
    openHour: 9,
    openMinute: 15,
    closeHour: 15,
    closeMinute: 30,
    openDays: [1, 2, 3, 4, 5], // Mon-Fri
    label: "NSE (India) market"
  },
  "Asia/Shanghai": {
    name: "Shanghai Stock Exchange",
    code: "SSE",
    timezone: "Asia/Shanghai",
    openHour: 9,
    openMinute: 30,
    closeHour: 15,
    closeMinute: 0,
    openDays: [1, 2, 3, 4, 5], // Mon-Fri
    label: "Shanghai Stock Exchange (China) market"
  },
  "Asia/Tokyo": {
    name: "Tokyo Stock Exchange",
    code: "TSE",
    timezone: "Asia/Tokyo",
    openHour: 9,
    openMinute: 0,
    closeHour: 15,
    closeMinute: 0,
    openDays: [1, 2, 3, 4, 5], // Mon-Fri
    label: "TSE (Japan) market"
  },
  "Europe/London": {
    name: "London Stock Exchange",
    code: "LSE",
    timezone: "Europe/London",
    openHour: 8,
    openMinute: 0,
    closeHour: 16,
    closeMinute: 30,
    openDays: [1, 2, 3, 4, 5], // Mon-Fri
    label: "LSE (UK) market"
  },
  "America/New_York": {
    name: "New York Stock Exchange",
    code: "NYSE",
    timezone: "America/New_York",
    openHour: 9,
    openMinute: 30,
    closeHour: 16,
    closeMinute: 0,
    openDays: [1, 2, 3, 4, 5], // Mon-Fri
    label: "US market"
  }
};

// Country to timezone mapping
const COUNTRY_TO_TIMEZONE: Record<string, string> = {
  IN: "Asia/Kolkata",
  CN: "Asia/Shanghai",
  JP: "Asia/Tokyo",
  GB: "Europe/London",
  US: "America/New_York",
  CA: "America/New_York",
  AU: "Australia/Sydney",
  SG: "Asia/Singapore",
  HK: "Asia/Hong_Kong",
  KR: "Asia/Seoul",
  BR: "America/Sao_Paulo",
  MX: "America/Mexico_City",
  ZA: "Africa/Johannesburg",
  AE: "Asia/Dubai",
  FR: "Europe/Paris",
  DE: "Europe/Berlin",
};

/**
 * Extract client IP from request headers
 */
export function getClientIp(req: any): string {
  // Check for IP from proxy headers (common in cloud environments)
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  
  // Direct connection
  return req.socket.remoteAddress || "127.0.0.1";
}

function getHeaderValue(req: RequestLike, key: string): string | undefined {
  const value = req.headers[key];
  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === "string" ? value : undefined;
}

export function getGeolocationFromHeaders(req: RequestLike): GeoLocation | null {
  const countryCode = (getHeaderValue(req, "x-vercel-ip-country") || getHeaderValue(req, "cf-ipcountry") || "").trim().toUpperCase();
  const timezoneHeader = (getHeaderValue(req, "x-vercel-ip-timezone") || "").trim();
  const country = (getHeaderValue(req, "x-vercel-ip-country-region") || "").trim();

  if (!countryCode) {
    return null;
  }

  const timezone = COUNTRY_TO_TIMEZONE[countryCode] || timezoneHeader || "America/New_York";
  const market = MARKET_DEFINITIONS[timezone] || MARKET_DEFINITIONS["America/New_York"]!;

  return {
    country: country || countryCode,
    countryCode,
    timezone,
    market
  };
}

/**
 * Get geolocation from IP (using free GeoIP service)
 * In production, use a proper service like MaxMind GeoIP2 for accuracy
 */
export async function getGeolocationFromIP(ip: string): Promise<GeoLocation> {
  try {
    // For localhost/private IPs, default to US
    if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.") || ip.startsWith("10.")) {
      return getDefaultGeolocation();
    }

    // Use ip-api.com (free tier: 45 requests/minute) - good for standalone apps
    // For production, consider MaxMind, ip2location, or similar
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=country,countryCode,timezone`);
    
    if (!response.ok) {
      return getDefaultGeolocation();
    }

    const data = await response.json() as {
      country?: string;
      countryCode?: string;
      timezone?: string;
      status?: string;
    };

    if (data.status !== "success") {
      return getDefaultGeolocation();
    }

    const countryCode = data.countryCode || "US";
    const timezone = COUNTRY_TO_TIMEZONE[countryCode] || data.timezone || "America/New_York";

    return {
      country: data.country || "Unknown",
      countryCode,
      timezone,
      market: MARKET_DEFINITIONS[timezone] || MARKET_DEFINITIONS["America/New_York"]!
    };
  } catch (error) {
    console.warn("Geolocation lookup failed, using default:", error);
    return getDefaultGeolocation();
  }
}

export async function getGeolocation(req: RequestLike): Promise<GeoLocation> {
  const headerGeo = getGeolocationFromHeaders(req);
  if (headerGeo) {
    return headerGeo;
  }

  return getGeolocationFromIP(getClientIp(req));
}

/**
 * Get default geolocation (US market)
 */
export function getDefaultGeolocation(): GeoLocation {
  return {
    country: "United States",
    countryCode: "US",
    timezone: "America/New_York",
    market: MARKET_DEFINITIONS["America/New_York"]!
  };
}

/**
 * Get market from timezone (fallback if explicit timezone provided)
 */
export function getMarketFromTimezone(timezone: string): StockMarket {
  return MARKET_DEFINITIONS[timezone] || MARKET_DEFINITIONS["America/New_York"]!;
}

/**
 * Get all available markets
 */
export function getAllMarkets(): Record<string, StockMarket> {
  return MARKET_DEFINITIONS;
}
