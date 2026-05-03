import Anthropic from "@anthropic-ai/sdk";
import { searchFundsTool, getFundDetailsTool, getIndexFundsTool } from "../tools/fundTools";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface UserPreference {
    riskAppetite: "low" | "medium" | "high";
    investmentGoal: string;
    horizon: string;
    monthlyAmount?: number;
    preferIndex?: boolean;
    freeText?: string;
}

export interface FundRecommendation {
    rank: number;
    schemeName: string;
    schemeCode: string;
    fundHouse: string;
    category: string;
    currentNAV: string;
    returns30Days: string;
    returns1Year: string;
    returns3Year: string;
    returns5Year: string;       // CAGR % over 5 years, or "N/A (fund < 5 years old)"
    returnsOverall: string;     // CAGR % since inception
    inceptionDate: string;
    fundAgeYears: number;
    expenseRatio: string;       // e.g. "0.07%"
    trackingError: string;      // e.g. "0.03%" — N/A for active funds
    aum: string;                // e.g. "₹3,030 Cr"
    whyChosen: string;
    qualityScore: number;       // 1–10 composite (see scoring rubric in system prompt)
    badges: string[];
}

export interface AgentResponse {
    recommendations: FundRecommendation[];
    summary: string;
    selectionCriteria: {
        expenseRatioPriority: string;
        trackingErrorPriority: string;
        aumPriority: string;
    };
}

const tools: Anthropic.Tool[] = [
    {
        name: "searchFunds",
        description: "Search for Indian mutual funds or index funds by name or category keyword.",
        input_schema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Fund name, AMC, or category e.g. 'Nifty 50 index', 'Nippon nifty 50', 'flexi cap'",
                },
            },
            required: ["query"],
        },
    },
    {
        name: "getFundDetails",
        description: "Get detailed NAV history, CAGR returns (1Y/3Y/5Y/overall), expense ratio, tracking error, and AUM by scheme code.",
        input_schema: {
            type: "object",
            properties: {
                schemeCode: {
                    type: "string",
                    description: "The unique scheme code of the mutual fund",
                },
            },
            required: ["schemeCode"],
        },
    },
    {
        name: "getIndexFunds",
        description: "Get a curated list of popular Indian index funds with expense ratios, tracking errors, and AUM. Supports optional category filter.",
        input_schema: {
            type: "object",
            properties: {
                category: {
                    type: "string",
                    enum: ["nifty50", "nifty_next50", "midcap", "smallcap", "international", "all"],
                    description: "Filter by index category. Use 'all' to get everything.",
                },
            },
        },
    },
];

async function executeTool(name: string, input: any): Promise<any> {
    if (name === "searchFunds")   return await searchFundsTool.execute!(input, {} as any);
    if (name === "getFundDetails") return await getFundDetailsTool.execute!(input, {} as any);
    if (name === "getIndexFunds")  return await getIndexFundsTool.execute!(input, {} as any);
    throw new Error(`Unknown tool: ${name}`);
}

function extractJSON(text: string): AgentResponse {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON found in response: " + text.substring(0, 200));
    return JSON.parse(match[0]);
}

export async function runFundRecommendationAgent(preference: UserPreference): Promise<AgentResponse> {
    const userContext = `
Risk Appetite: ${preference.riskAppetite}
Investment Goal: ${preference.investmentGoal}
Time Horizon: ${preference.horizon}
${preference.monthlyAmount ? `Monthly SIP Amount: ₹${preference.monthlyAmount}` : ""}
${preference.preferIndex ? "User prefers index/passive funds" : ""}
${preference.freeText ? `Additional context: ${preference.freeText}` : ""}
    `.trim();

    const messages: Anthropic.MessageParam[] = [
        {
            role: "user",
            content: `Based on these user preferences, find and recommend exactly 3 mutual funds:\n\n${userContext}`,
        },
    ];

    const systemPrompt = `You are an expert Indian mutual fund advisor — objective, data-driven, and focused on long-term wealth creation.
Your job is to recommend exactly 3 funds tailored to the user's preferences.

═══════════════════════════════════════════════
SCORING RUBRIC — compute qualityScore (1–10)
═══════════════════════════════════════════════
For INDEX funds (passive), score on three factors:

  Expense Ratio (50% weight — most important over long horizon):
    ≤ 0.10%  → 10 points
    ≤ 0.15%  →  8 points
    ≤ 0.20%  →  6 points
    ≤ 0.25%  →  4 points
    > 0.25%  →  2 points

  Tracking Error (30% weight — measures execution quality):
    ≤ 0.03%  → 10 points
    ≤ 0.05%  →  8 points
    ≤ 0.10%  →  6 points
    ≤ 0.20%  →  4 points
    > 0.20%  →  2 points

  AUM (20% weight — proxy for liquidity and fund maturity):
    > ₹10,000 Cr → 10 points
    > ₹5,000 Cr  →  8 points
    > ₹2,000 Cr  →  6 points
    > ₹1,000 Cr  →  4 points
    ≤ ₹1,000 Cr  →  2 points

  qualityScore = round((expScore*0.5 + teScore*0.3 + aumScore*0.2))

For ACTIVE funds, weight 3Y/5Y CAGR vs benchmark more heavily.

═══════════════════════════════════════════════
BADGES — assign based on actual data
═══════════════════════════════════════════════
  "Lowest Cost"       if expenseRatio ≤ 0.07%
  "Low Cost"          if expenseRatio ≤ 0.15%
  "Very Low Tracking" if trackingError ≤ 0.03%
  "Low Tracking"      if trackingError ≤ 0.05%
  "Large AUM"         if AUM > ₹10,000 Cr
  "High AUM"          if AUM > ₹5,000 Cr
  "Long Track Record" if fundAgeYears ≥ 7
  "Newer Fund"        if fundAgeYears < 3

═══════════════════════════════════════════════
FUND SELECTION GUIDELINES
═══════════════════════════════════════════════
  Low risk / preferIndex = true:
    → Focus on Nifty 50 passive funds
    → Call getIndexFunds(category="nifty50") first
    → Top picks by score: Nippon (118834), Bandhan (125497), Navi (145552), SBI (147623)
    → Do NOT dismiss a fund just because its AUM is smaller — Nippon (118834) has
      the best expense ratio (0.07%) among established Nifty 50 funds with 5Y history.

  Medium risk:
    → Consider Nifty 50 + Nifty Next 50 mix, or flexi cap / large & mid cap active
    → Use searchFunds for active fund options

  High risk:
    → Midcap 150, Smallcap 250 index funds OR active mid/small cap funds
    → Call getIndexFunds(category="midcap") or getIndexFunds(category="smallcap")

  International allocation (optional, for any risk level):
    → Motilal Oswal S&P 500 (135781) for US exposure
    → Note: tracking error for international funds is higher due to currency translation — this is normal, do NOT penalise it the same way as domestic index tracking error

═══════════════════════════════════════════════
RETURNS — important notes for your explanation
═══════════════════════════════════════════════
  - All returns from getFundDetails are CAGR (annualised), NOT absolute %
  - For funds with no 5Y history, use returnsOverall (since inception CAGR) as proxy
  - NEVER compare a fund with <3Y history against one with 5Y+ history on returns alone
  - If two funds have almost identical CAGR (within 0.3%), the one with lower expense
    ratio is strictly better — the difference WILL compound over 7+ years

═══════════════════════════════════════════════
STEPS YOU MUST FOLLOW
═══════════════════════════════════════════════
  1. Call getIndexFunds with appropriate category filter based on user risk
  2. Shortlist 4–5 candidates from the list
  3. Call getFundDetails for each shortlisted fund to get CAGR returns and verify data
  4. Score each candidate using the SCORING RUBRIC above
  5. Pick top 3 by score; break ties by lower expense ratio
  6. Assign badges and write a whyChosen explanation (2–3 sentences) that references
     the actual expense ratio, tracking error, and CAGR numbers — be specific

═══════════════════════════════════════════════
OUTPUT — raw JSON only, no markdown, no preamble
═══════════════════════════════════════════════
{
  "recommendations": [
    {
      "rank": 1,
      "schemeName": "...",
      "schemeCode": "...",
      "fundHouse": "...",
      "category": "...",
      "currentNAV": "...",
      "returns30Days": "...",
      "returns1Year": "...",
      "returns3Year": "...",
      "returns5Year": "13.46% CAGR",
      "returnsOverall": "14.20% CAGR",
      "inceptionDate": "...",
      "fundAgeYears": 7.2,
      "expenseRatio": "0.07%",
      "trackingError": "0.03%",
      "aum": "₹3,030 Cr",
      "whyChosen": "At 0.07% expense ratio, this is the lowest-cost established Nifty 50 fund with a verified 5-year track record. Its tracking error of 0.03% ensures you capture the index return accurately, and the 5Y CAGR of 13.46% matches the best in the category.",
      "qualityScore": 9,
      "badges": ["Lowest Cost", "Very Low Tracking", "Long Track Record"]
    }
  ],
  "summary": "...",
  "selectionCriteria": {
    "expenseRatioPriority": "...",
    "trackingErrorPriority": "...",
    "aumPriority": "..."
  }
}`;

    for (let step = 0; step < 12; step++) {
        const response = await client.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 4096,
            system: systemPrompt,
            tools,
            messages,
        });

        messages.push({ role: "assistant", content: response.content });

        if (response.stop_reason === "end_turn") {
            const textBlock = response.content.find((b) => b.type === "text");
            if (!textBlock || textBlock.type !== "text") {
                throw new Error("No text response from agent");
            }
            return extractJSON(textBlock.text);
        }

        if (response.stop_reason === "tool_use") {
            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            for (const block of response.content) {
                if (block.type === "tool_use") {
                    console.log(`🔧 Tool called: ${block.name}`, block.input);
                    try {
                        const result = await executeTool(block.name, block.input);
                        toolResults.push({
                            type: "tool_result",
                            tool_use_id: block.id,
                            content: JSON.stringify(result),
                        });
                    } catch (err: any) {
                        toolResults.push({
                            type: "tool_result",
                            tool_use_id: block.id,
                            content: `Error: ${err.message}`,
                            is_error: true,
                        });
                    }
                }
            }

            messages.push({ role: "user", content: toolResults });
        }
    }

    throw new Error("Agent exceeded maximum steps without finishing");
}