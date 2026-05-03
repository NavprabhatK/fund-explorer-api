import { tool } from "ai";
import { z } from "zod";

const MF_API_BASE = "https://api.mfapi.in";

/**
 * Static metadata for well-known index funds.
 * Sources: AMFI, fund factsheets — updated May 2025.
 *
 * Scheme codes verified against mfapi.in search results.
 * Expense ratios are for Direct Growth plans.
 *
 * HOW TO UPDATE:
 *   1. Visit https://www.amfiindia.com/nav-history-download
 *   2. Or search https://api.mfapi.in/mf/search?q=<fund name>
 *   3. Update expenseRatio, trackingError, aum periodically (quarterly is fine)
 */
export const INDEX_FUND_METADATA: Record<string, {
    expenseRatio: number;   // % per annum (Direct plan)
    trackingError: number;  // annualised % — lower is better
    aum: number;            // in Crores INR (approx, from latest factsheet)
}> = {
    // ── Nifty 50 ─────────────────────────────────────────────────────────────
    "120716": { expenseRatio: 0.21, trackingError: 0.04, aum: 24433 },  // UTI Nifty 50 Direct Growth
    "120505": { expenseRatio: 0.20, trackingError: 0.05, aum: 20437 },  // HDFC Nifty 50 Direct Growth
    "118834": { expenseRatio: 0.07, trackingError: 0.03, aum: 3030  },  // Nippon India Index Fund - Nifty 50 Plan Direct Growth ← KEY FIX
    "119598": { expenseRatio: 0.17, trackingError: 0.05, aum: 14153 },  // ICICI Pru Nifty 50 Direct Growth
    "125497": { expenseRatio: 0.10, trackingError: 0.02, aum: 2228  },  // Bandhan Nifty 50 Direct Growth
    "145552": { expenseRatio: 0.06, trackingError: 0.02, aum: 3573  },  // Navi Nifty 50 Direct Growth
    "147623": { expenseRatio: 0.18, trackingError: 0.05, aum: 11879 },  // SBI Nifty Index Direct Growth
    "147946": { expenseRatio: 0.16, trackingError: 0.05, aum: 2639  },  // Motilal Oswal Nifty 50 Direct Growth

    // ── Nifty Next 50 ────────────────────────────────────────────────────────
    "120754": { expenseRatio: 0.35, trackingError: 0.03, aum: 6246  },  // UTI Nifty Next 50 Direct Growth
    "120684": { expenseRatio: 0.30, trackingError: 0.04, aum: 1994  },  // HDFC Nifty Next 50 Direct Growth
    "118989": { expenseRatio: 0.31, trackingError: 0.09, aum: 8396  },  // ICICI Pru Nifty Next 50 Direct Growth

    // ── Midcap 150 ────────────────────────────────────────────────────────────
    "147647": { expenseRatio: 0.23, trackingError: 0.06, aum: 2901  },  // Motilal Oswal Nifty Midcap 150 Direct Growth
    "148547": { expenseRatio: 0.30, trackingError: 0.14, aum: 2188  },  // Nippon India Nifty Midcap 150 Direct Growth

    // ── Smallcap 250 ──────────────────────────────────────────────────────────
    "148469": { expenseRatio: 0.35, trackingError: 0.07, aum: 2523  },  // Nippon India Nifty Smallcap 250 Direct Growth

    // ── Nifty 500 / Broad Market ──────────────────────────────────────────────
    "147939": { expenseRatio: 0.17, trackingError: 0.03, aum: 2639  },  // Motilal Oswal Nifty 500 Direct Growth

    // ── International ─────────────────────────────────────────────────────────
    "135781": { expenseRatio: 0.65, trackingError: 17.99, aum: 3936 },  // Motilal Oswal S&P 500 Index Fund Direct Growth
    "120823": { expenseRatio: 0.51, trackingError: 5.19,  aum: 2773 },  // ICICI Pru NASDAQ 100 Index Fund Direct Growth

    // ── Momentum / Factor ─────────────────────────────────────────────────────
    "147940": { expenseRatio: 0.43, trackingError: 0.22, aum: 7476  },  // UTI Nifty200 Momentum 30 Direct Growth
};

/**
 * Calculate CAGR (Compound Annual Growth Rate) between two NAV points.
 *
 * Formula: CAGR = ((endNAV / startNAV) ^ (1 / years)) - 1
 * Returns a string like "13.46%" or "N/A" if data is missing.
 */
function calcCAGR(
    startNav: string | undefined,
    endNav: string | undefined,
    startDateStr: string,       // "DD-MM-YYYY"
    endDateStr: string,         // "DD-MM-YYYY"
): string {
    if (!startNav || !endNav) return "N/A";
    const from = parseFloat(startNav);
    const to = parseFloat(endNav);
    if (!from || !to || from <= 0) return "N/A";

    const parseDate = (s: string): Date => {
        const [dd, mm, yyyy] = s.split("-").map(Number);
        return new Date(yyyy, mm - 1, dd);
    };

    const startDate = parseDate(startDateStr);
    const endDate = parseDate(endDateStr);
    const years = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

    if (years < 0.1) return "N/A"; // too short a window to be meaningful

    const cagr = (Math.pow(to / from, 1 / years) - 1) * 100;
    return cagr.toFixed(2) + "%";
}

/**
 * Find the NAV entry closest to a target date.
 * mfapi returns entries newest-first (trading days only, no weekends/holidays).
 */
function findNavNearDate(
    navHistory: { date: string; nav: string }[],
    targetDate: Date,
): { date: string; nav: string } | undefined {
    const targetMs = targetDate.getTime();
    let closest: { date: string; nav: string } | undefined;
    let closestDiff = Infinity;

    for (const entry of navHistory) {
        const [dd, mm, yyyy] = entry.date.split("-").map(Number);
        const entryMs = new Date(yyyy, mm - 1, dd).getTime();
        const diff = Math.abs(entryMs - targetMs);
        if (diff < closestDiff) {
            closestDiff = diff;
            closest = entry;
        }
        // navHistory is newest-first; once we're >7 days past target, stop
        if (entryMs < targetMs - 7 * 24 * 60 * 60 * 1000 && closest) break;
    }
    return closest;
}

// ─── Tool 1: Search funds ─────────────────────────────────────────────────────

export const searchFundsTool = tool({
    description:
        "Search for Indian mutual funds or index funds by name or category keyword. Returns a list of matching funds with scheme codes.",
    parameters: z.object({
        query: z.string().describe(
            "Fund name, AMC, or category. e.g. 'Nifty 50 index', 'flexi cap', 'Nippon nifty 50', 'midcap 150'"
        ),
    }),
    execute: async ({ query }) => {
        const res = await fetch(`${MF_API_BASE}/mf/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        // Return top 15 — agent will filter to Direct Growth plans
        return (data as any[]).slice(0, 15).map((f: any) => ({
            schemeCode: String(f.schemeCode),
            schemeName: f.schemeName,
        }));
    },
});

// ─── Tool 2: Get fund details with correct CAGR ───────────────────────────────

export const getFundDetailsTool = tool({
    description:
        "Get detailed NAV history, current NAV, fund metadata, and quality indicators (expense ratio, tracking error, AUM) for a specific mutual fund by its scheme code. Returns 1Y, 3Y, 5Y CAGR and overall CAGR since inception.",
    parameters: z.object({
        schemeCode: z.string().describe("The unique scheme code of the mutual fund"),
    }),
    execute: async ({ schemeCode }) => {
        const res = await fetch(`${MF_API_BASE}/mf/${schemeCode}`);
        const data = await res.json();
        const meta = data.meta;
        const navHistory: { date: string; nav: string }[] = data.data ?? [];

        if (!navHistory.length) {
            return { error: "No NAV data available for this fund" };
        }

        const latestNav = navHistory[0];
        const oldestNav = navHistory[navHistory.length - 1];

        const latestDate = (() => {
            const [dd, mm, yyyy] = latestNav.date.split("-").map(Number);
            return new Date(yyyy, mm - 1, dd);
        })();

        const dateMinusYears = (years: number): Date => {
            const d = new Date(latestDate);
            d.setFullYear(d.getFullYear() - years);
            return d;
        };

        const dateMinusDays = (days: number): Date => {
            const d = new Date(latestDate);
            d.setDate(d.getDate() - days);
            return d;
        };

        const nav30DaysAgo = findNavNearDate(navHistory, dateMinusDays(30));
        const nav1YearAgo  = findNavNearDate(navHistory, dateMinusYears(1));
        const nav3YearAgo  = findNavNearDate(navHistory, dateMinusYears(3));
        const nav5YearAgo  = findNavNearDate(navHistory, dateMinusYears(5));

        // Check if fund actually has 5 years of history
        const fundAgeMs = latestDate.getTime() - (() => {
            const [dd, mm, yyyy] = oldestNav.date.split("-").map(Number);
            return new Date(yyyy, mm - 1, dd).getTime();
        })();
        const fundAgeYears = fundAgeMs / (365.25 * 24 * 60 * 60 * 1000);

        const qualityMeta = INDEX_FUND_METADATA[schemeCode] ?? null;

        return {
            schemeName: meta.scheme_name,
            fundHouse: meta.fund_house,
            schemeType: meta.scheme_type,
            schemeCategory: meta.scheme_category,

            currentNAV: latestNav.nav,
            navDate: latestNav.date,

            // All returns are CAGR (annualised), not absolute %
            returns30Days: nav30DaysAgo
                ? calcCAGR(nav30DaysAgo.nav, latestNav.nav, nav30DaysAgo.date, latestNav.date)
                : "N/A",
            returns1Year: nav1YearAgo
                ? calcCAGR(nav1YearAgo.nav, latestNav.nav, nav1YearAgo.date, latestNav.date)
                : "N/A",
            returns3Year: nav3YearAgo
                ? calcCAGR(nav3YearAgo.nav, latestNav.nav, nav3YearAgo.date, latestNav.date)
                : "N/A (fund < 3 years old)",
            returns5Year: fundAgeYears >= 4.8 && nav5YearAgo
                ? calcCAGR(nav5YearAgo.nav, latestNav.nav, nav5YearAgo.date, latestNav.date)
                : "N/A (fund < 5 years old)",
            returnsOverall: calcCAGR(oldestNav.nav, latestNav.nav, oldestNav.date, latestNav.date),

            inceptionDate: oldestNav.date,
            fundAgeYears: parseFloat(fundAgeYears.toFixed(1)),

            // Quality indicators from static metadata (update quarterly)
            expenseRatio:  qualityMeta ? qualityMeta.expenseRatio + "%" : "N/A",
            trackingError: qualityMeta ? qualityMeta.trackingError + "%" : "N/A",
            aum: qualityMeta ? "₹" + qualityMeta.aum.toLocaleString("en-IN") + " Cr" : "N/A",

            // Raw numbers for agent scoring logic (null if unknown)
            _expenseRatioRaw:  qualityMeta?.expenseRatio  ?? null,
            _trackingErrorRaw: qualityMeta?.trackingError ?? null,
            _aumRaw:           qualityMeta?.aum           ?? null,
        };
    },
});

// ─── Tool 3: Curated index fund list ─────────────────────────────────────────

export const getIndexFundsTool = tool({
    description:
        "Get a curated list of popular Indian index funds with scheme codes, expense ratios, tracking errors, and AUM. Use this as the starting point when the user wants passive/index investing options.",
    parameters: z.object({
        category: z.enum([
            "nifty50",
            "nifty_next50",
            "midcap",
            "smallcap",
            "international",
            "all",
        ]).optional().describe(
            "Filter by index category. Omit or pass 'all' to return everything."
        ),
    }),
    execute: async ({ category = "all" }) => {
        const funds = [
            // ── Nifty 50 ────────────────────────────────────────────────────
            {
                name: "Nippon India Index Fund - Nifty 50 Plan - Direct Growth",
                schemeCode: "118834",
                category: "nifty50",
                note: "Best cost-to-quality ratio among Nifty 50 funds",
            },
            {
                name: "Bandhan Nifty 50 Index Fund - Direct Growth",
                schemeCode: "125497",
                category: "nifty50",
                note: "Very low tracking error with competitive expense ratio",
            },
            {
                name: "Navi Nifty 50 Index Fund - Direct Growth",
                schemeCode: "145552",
                category: "nifty50",
                note: "Lowest expense ratio in category; newer fund, less track record",
            },
            {
                name: "SBI Nifty Index Fund - Direct Growth",
                schemeCode: "147623",
                category: "nifty50",
                note: "Large AUM, tight tracking error, backed by SBI AMC",
            },
            {
                name: "UTI Nifty 50 Index Fund - Direct Growth",
                schemeCode: "120716",
                category: "nifty50",
                note: "Largest AUM among Nifty 50 index funds, highly liquid",
            },
            {
                name: "HDFC Index Fund - NIFTY 50 Plan - Direct Growth",
                schemeCode: "120505",
                category: "nifty50",
                note: "Large AUM, consistent performance over 10+ years",
            },
            {
                name: "ICICI Pru Nifty 50 Index Fund - Direct Growth",
                schemeCode: "119598",
                category: "nifty50",
                note: "Large AUM with good tracking",
            },
            {
                name: "Motilal Oswal Nifty 50 Index Fund - Direct Growth",
                schemeCode: "147946",
                category: "nifty50",
                note: "Lower expense ratio among the larger AMC options",
            },

            // ── Nifty Next 50 ────────────────────────────────────────────────
            {
                name: "UTI Nifty Next 50 Index Fund - Direct Growth",
                schemeCode: "120754",
                category: "nifty_next50",
                note: "Largest AUM in Nifty Next 50; good for slightly aggressive exposure",
            },
            {
                name: "ICICI Pru Nifty Next 50 Index Fund - Direct Growth",
                schemeCode: "118989",
                category: "nifty_next50",
                note: "Large AUM, established fund house",
            },

            // ── Midcap ───────────────────────────────────────────────────────
            {
                name: "Motilal Oswal Nifty Midcap 150 Index Fund - Direct Growth",
                schemeCode: "147647",
                category: "midcap",
                note: "Best cost option for midcap passive exposure",
            },
            {
                name: "Nippon India Nifty Midcap 150 Index Fund - Direct Growth",
                schemeCode: "148547",
                category: "midcap",
                note: "Backed by large Nippon AMC with growing AUM",
            },

            // ── Smallcap ─────────────────────────────────────────────────────
            {
                name: "Nippon India Nifty Smallcap 250 Index Fund - Direct Growth",
                schemeCode: "148469",
                category: "smallcap",
                note: "Only established smallcap passive option with reasonable AUM",
            },

            // ── International ────────────────────────────────────────────────
            {
                name: "Motilal Oswal S&P 500 Index Fund - Direct Growth",
                schemeCode: "135781",
                category: "international",
                note: "Best option for US market exposure; note high tracking error due to currency",
            },
            {
                name: "ICICI Pru NASDAQ 100 Index Fund - Direct Growth",
                schemeCode: "120823",
                category: "international",
                note: "Tech-heavy US exposure via NASDAQ 100",
            },

            // ── Broad Market ─────────────────────────────────────────────────
            {
                name: "Motilal Oswal Nifty 500 Index Fund - Direct Growth",
                schemeCode: "147939",
                category: "nifty50", // broad market — tag as nifty50 so it shows up in low-risk queries
                note: "Broadest market coverage — Nifty 500 = top 500 Indian stocks",
            },
        ];

        const filtered = category === "all"
            ? funds
            : funds.filter(f => f.category === category);

        // Attach metadata inline so agent doesn't need a separate getFundDetails call for basic filtering
        return filtered.map(f => {
            const meta = INDEX_FUND_METADATA[f.schemeCode];
            return {
                ...f,
                expenseRatio:  meta ? meta.expenseRatio + "%" : "N/A",
                trackingError: meta ? meta.trackingError + "%" : "N/A",
                aum:           meta ? "₹" + meta.aum.toLocaleString("en-IN") + " Cr" : "N/A",
                _expenseRatioRaw:  meta?.expenseRatio  ?? null,
                _trackingErrorRaw: meta?.trackingError ?? null,
                _aumRaw:           meta?.aum           ?? null,
            };
        });
    },
});