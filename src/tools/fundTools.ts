import { tool } from "ai";
import { z } from "zod";

const MF_API_BASE = "https://api.mfapi.in";

// Static metadata for well-known index funds (mfapi.in doesn't expose these)
// Sources: AMFI, fund factsheets (update periodically)
export const INDEX_FUND_METADATA: Record<string, {
    expenseRatio: number;   // % per annum
    trackingError: number;  // % (lower is better)
    aum: number;            // in Crores INR
}> = {
    "120716": { expenseRatio: 0.05, trackingError: 0.03, aum: 22000 },   // UTI Nifty 50 Direct
    "120505": { expenseRatio: 0.10, trackingError: 0.04, aum: 15000 },   // HDFC Nifty 50 Direct
    "118834": { expenseRatio: 0.10, trackingError: 0.04, aum: 9000 },    // Nippon Nifty 50 Direct
    "147622": { expenseRatio: 0.17, trackingError: 0.08, aum: 4500 },    // Motilal Nifty Next 50 Direct
    "120754": { expenseRatio: 0.30, trackingError: 0.10, aum: 3800 },    // UTI Nifty Next 50 Direct
    "119598": { expenseRatio: 0.10, trackingError: 0.05, aum: 6800 },    // HDFC Sensex Direct
    "118836": { expenseRatio: 0.10, trackingError: 0.05, aum: 2100 },    // Nippon Sensex Direct
    "147647": { expenseRatio: 0.17, trackingError: 0.09, aum: 3200 },    // Motilal Midcap 150 Direct
};

// Tool 1: Search funds by name/keyword
export const searchFundsTool = tool({
    description:
        "Search for Indian mutual funds or index funds by name or category keyword. Returns a list of matching funds with scheme codes.",
    parameters: z.object({
        query: z.string().describe("Fund name, AMC, or category e.g. 'Nifty 50 index', 'flexi cap', 'HDFC mid cap'"),
    }),
    execute: async ({ query }) => {
        const res = await fetch(`${MF_API_BASE}/mf/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        return data.slice(0, 10).map((f: any) => ({
            schemeCode: f.schemeCode,
            schemeName: f.schemeName,
        }));
    },
});

// Tool 2: Get NAV history + expense/tracking/AUM metadata where available
export const getFundDetailsTool = tool({
    description:
        "Get detailed NAV history, current NAV, fund metadata, and quality indicators (expense ratio, tracking error, AUM) for a specific mutual fund by its scheme code.",
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
        // Oldest available NAV entry for overall (inception) return
        const navOldest = navHistory[navHistory.length - 1];

        // mfapi only stores trading days (no weekends/holidays), not every calendar day.
        // Use date arithmetic to find the closest available entry to a target date.
        const findNavNearDate = (targetDate: Date): { date: string; nav: string } | undefined => {
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
                // Since navHistory is newest-first, once we go more than 5 days past target we can stop
                if (entryMs < targetMs - 5 * 24 * 60 * 60 * 1000 && closest) break;
            }
            return closest;
        };

        const latestDate = (() => {
            const [dd, mm, yyyy] = latestNav.date.split("-").map(Number);
            return new Date(yyyy, mm - 1, dd);
        })();

        const dateMinusDays = (days: number): Date => {
            const d = new Date(latestDate);
            d.setDate(d.getDate() - days);
            return d;
        };

        const dateMinusYears = (years: number): Date => {
            const d = new Date(latestDate);
            d.setFullYear(d.getFullYear() - years);
            return d;
        };

        const nav30DaysAgo = findNavNearDate(dateMinusDays(30));
        const nav1YearAgo = findNavNearDate(dateMinusYears(1));
        const nav5YearsAgo = findNavNearDate(dateMinusYears(5));

        const calcReturn = (older: { nav: string } | undefined): string => {
            if (!older || !latestNav) return "N/A";
            const from = parseFloat(older.nav);
            const to = parseFloat(latestNav.nav);
            if (!from || !to) return "N/A";
            return (((to - from) / from) * 100).toFixed(2) + "%";
        };

        const qualityMeta = INDEX_FUND_METADATA[schemeCode] ?? null;

        return {
            schemeName: meta.scheme_name,
            fundHouse: meta.fund_house,
            schemeType: meta.scheme_type,
            schemeCategory: meta.scheme_category,
            currentNAV: latestNav?.nav,
            date: latestNav?.date,
            returns30Days: calcReturn(nav30DaysAgo),
            returns1Year: calcReturn(nav1YearAgo),
            // 5-year absolute return (not CAGR — simple total %)
            returns5Year: nav5YearsAgo
                ? calcReturn(nav5YearsAgo)
                : "N/A (fund < 5 years old)",
            // Overall return since inception (absolute %)
            returnsOverall: navOldest
                ? calcReturn(navOldest)
                : "N/A",
            inceptionDate: navOldest?.date ?? "N/A",
            // Quality indicators — present for known index funds, null otherwise
            expenseRatio: qualityMeta ? qualityMeta.expenseRatio + "%" : "N/A",
            trackingError: qualityMeta ? qualityMeta.trackingError + "%" : "N/A",
            aum: qualityMeta ? "₹" + qualityMeta.aum.toLocaleString("en-IN") + " Cr" : "N/A",
            // Raw numbers for agent comparison logic
            _expenseRatioRaw: qualityMeta?.expenseRatio ?? null,
            _trackingErrorRaw: qualityMeta?.trackingError ?? null,
            _aumRaw: qualityMeta?.aum ?? null,
        };
    },
});

// Tool 3: Get popular index funds with quality metadata attached
export const getIndexFundsTool = tool({
    description:
        "Get a curated list of popular Indian index funds with scheme codes, expense ratios, tracking errors, and AUM. Use when the user wants passive/index investing options.",
    parameters: z.object({
        dummy: z.string().optional().describe("Not required, leave empty"),
    }),
    execute: async () => {
        return [
            {
                name: "UTI Nifty 50 Index Fund - Direct",
                schemeCode: "120716",
                ...INDEX_FUND_METADATA["120716"],
                expenseRatioDisplay: "0.05%",
                trackingErrorDisplay: "0.03%",
                aumDisplay: "₹22,000 Cr",
            },
            {
                name: "HDFC Index Fund - NIFTY 50 Plan - Direct",
                schemeCode: "120505",
                ...INDEX_FUND_METADATA["120505"],
                expenseRatioDisplay: "0.10%",
                trackingErrorDisplay: "0.04%",
                aumDisplay: "₹15,000 Cr",
            },
            {
                name: "Nippon India Index Fund - Nifty 50 Plan - Direct",
                schemeCode: "118834",
                ...INDEX_FUND_METADATA["118834"],
                expenseRatioDisplay: "0.10%",
                trackingErrorDisplay: "0.04%",
                aumDisplay: "₹9,000 Cr",
            },
            {
                name: "Motilal Oswal Nifty Next 50 Index Fund - Direct",
                schemeCode: "147622",
                ...INDEX_FUND_METADATA["147622"],
                expenseRatioDisplay: "0.17%",
                trackingErrorDisplay: "0.08%",
                aumDisplay: "₹4,500 Cr",
            },
            {
                name: "UTI Nifty Next 50 Index Fund - Direct",
                schemeCode: "120754",
                ...INDEX_FUND_METADATA["120754"],
                expenseRatioDisplay: "0.30%",
                trackingErrorDisplay: "0.10%",
                aumDisplay: "₹3,800 Cr",
            },
            {
                name: "HDFC Index Fund - SENSEX Plan - Direct",
                schemeCode: "119598",
                ...INDEX_FUND_METADATA["119598"],
                expenseRatioDisplay: "0.10%",
                trackingErrorDisplay: "0.05%",
                aumDisplay: "₹6,800 Cr",
            },
            {
                name: "Nippon India Index Fund - Sensex Plan - Direct",
                schemeCode: "118836",
                ...INDEX_FUND_METADATA["118836"],
                expenseRatioDisplay: "0.10%",
                trackingErrorDisplay: "0.05%",
                aumDisplay: "₹2,100 Cr",
            },
            {
                name: "Motilal Oswal Nifty Midcap 150 Index Fund - Direct",
                schemeCode: "147647",
                ...INDEX_FUND_METADATA["147647"],
                expenseRatioDisplay: "0.17%",
                trackingErrorDisplay: "0.09%",
                aumDisplay: "₹3,200 Cr",
            },
        ];
    },
});