import { tool } from "ai";
import { z } from "zod";

const MF_API_BASE = "https://api.mfapi.in";

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
        // Return top 10 results to keep context lean
        return data.slice(0, 10).map((f: any) => ({
            schemeCode: f.schemeCode,
            schemeName: f.schemeName,
        }));
    },
});

// Tool 2: Get NAV history and fund details by scheme code
export const getFundDetailsTool = tool({
    description:
        "Get detailed NAV history, current NAV, and fund metadata for a specific mutual fund by its scheme code.",
    parameters: z.object({
        schemeCode: z.string().describe("The unique scheme code of the mutual fund"),
    }),
    execute: async ({ schemeCode }) => {
        const res = await fetch(`${MF_API_BASE}/mf/${schemeCode}`);
        const data = await res.json();
        const meta = data.meta;
        const latestNav = data.data?.[0];
        const nav30DaysAgo = data.data?.[29];
        const nav1YearAgo = data.data?.[364];

        return {
            schemeName: meta.scheme_name,
            fundHouse: meta.fund_house,
            schemeType: meta.scheme_type,
            schemeCategory: meta.scheme_category,
            currentNAV: latestNav?.nav,
            date: latestNav?.date,
            returns30Days: nav30DaysAgo
                ? (((latestNav.nav - nav30DaysAgo.nav) / nav30DaysAgo.nav) * 100).toFixed(2) + "%"
                : "N/A",
            returns1Year: nav1YearAgo
                ? (((latestNav.nav - nav1YearAgo.nav) / nav1YearAgo.nav) * 100).toFixed(2) + "%"
                : "N/A",
        };
    },
});

// Tool 3: Get popular index funds (curated list)
export const getIndexFundsTool = tool({
    description:
        "Get a curated list of popular Indian index funds and their scheme codes. Use this when the user wants passive/index investing options.",
    parameters: z.object({}),
    execute: async () => {
        // These are real scheme codes for popular index funds
        return [
            { name: "UTI Nifty 50 Index Fund - Direct", schemeCode: "120716" },
            { name: "HDFC Index Fund - NIFTY 50 Plan - Direct", schemeCode: "120505" },
            { name: "Nippon India Index Fund - Nifty 50 Plan - Direct", schemeCode: "118834" },
            { name: "Motilal Oswal Nifty Next 50 Index Fund - Direct", schemeCode: "147622" },
            { name: "UTI Nifty Next 50 Index Fund - Direct", schemeCode: "120754" },
            { name: "HDFC Index Fund - SENSEX Plan - Direct", schemeCode: "119598" },
            { name: "Nippon India Index Fund - Sensex Plan - Direct", schemeCode: "118836" },
            { name: "Motilal Oswal Nifty Midcap 150 Index Fund - Direct", schemeCode: "147647" },
        ];
    },
});