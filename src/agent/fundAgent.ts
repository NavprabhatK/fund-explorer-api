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

// Shape returned to the UI for each fund card
export interface FundRecommendation {
    rank: number;
    schemeName: string;
    schemeCode: string;
    fundHouse: string;
    category: string;
    currentNAV: string;
    returns30Days: string;
    returns1Year: string;
    returns5Year: string;       // absolute % since 5 years ago, or "N/A (fund < 5 years old)"
    returnsOverall: string;     // absolute % since inception
    inceptionDate: string;      // date of oldest available NAV
    expenseRatio: string;       // e.g. "0.05%" or "N/A"
    trackingError: string;      // e.g. "0.03%" or "N/A"
    aum: string;                // e.g. "₹22,000 Cr" or "N/A"
    whyChosen: string;
    qualityScore: number;       // 1–10 composite score (expense + tracking + AUM)
    badges: string[];           // e.g. ["Low Cost", "High AUM", "Low Tracking Error"]
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
                    description: "Fund name, AMC, or category e.g. 'Nifty 50 index', 'flexi cap'",
                },
            },
            required: ["query"],
        },
    },
    {
        name: "getFundDetails",
        description: "Get detailed NAV history, fund metadata, expense ratio, tracking error, and AUM by scheme code.",
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
        description: "Get a curated list of popular Indian index funds with expense ratios, tracking errors, and AUM.",
        input_schema: {
            type: "object",
            properties: {},
        },
    },
];

async function executeTool(name: string, input: any): Promise<any> {
    if (name === "searchFunds") return await searchFundsTool.execute!(input, {} as any);
    if (name === "getFundDetails") return await getFundDetailsTool.execute!(input, {} as any);
    if (name === "getIndexFunds") return await getIndexFundsTool.execute!(input, {} as any);
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

    const systemPrompt = `You are an expert Indian mutual fund advisor.
Your job is to recommend exactly 3 funds tailored to the user's preferences.

SELECTION CRITERIA — pick funds with the best combination of:
1. LOW expense ratio (prefer funds below 0.20% for index, below 1.5% for active)
2. VERY LOW tracking error (for index funds — prefer below 0.10%)
3. LARGE AUM (prefer funds above ₹5,000 Cr for index; ₹3,000 Cr for active — larger AUM = more liquid and trustworthy)

Guidelines by risk appetite:
- Low risk: index funds (Nifty 50 / Sensex) or large cap / debt-oriented hybrid
- Medium risk: flexi cap, large & mid cap, or balanced advantage
- High risk: mid cap, small cap, or sectoral/thematic

Steps you MUST follow:
1. Call getIndexFunds if the user prefers index or has low risk
2. Call searchFunds for the appropriate category based on risk
3. Call getFundDetails for at least 4–5 candidates to compare their expense ratio, tracking error, AUM, and returns
4. Pick the best 3 based on the SELECTION CRITERIA above
5. Assign badges: "Low Cost" if expenseRatio ≤ 0.10%, "Very Low Cost" if ≤ 0.05%, "Large AUM" if AUM > ₹10,000 Cr, "Low Tracking Error" if trackingError ≤ 0.05%
6. Assign qualityScore 1–10: 10 = best possible (lowest expense + lowest tracking + highest AUM)
7. Output ONLY the raw JSON object below — no markdown, no explanation, no text before or after

Output ONLY this exact JSON structure:
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
      "returns5Year": "...",
      "returnsOverall": "...",
      "inceptionDate": "...",
      "expenseRatio": "0.05%",
      "trackingError": "0.03%",
      "aum": "₹22,000 Cr",
      "whyChosen": "2–3 sentence personalized explanation referencing expense ratio, tracking error, or AUM",
      "qualityScore": 9,
      "badges": ["Low Cost", "Large AUM", "Low Tracking Error"]
    }
  ],
  "summary": "Overall 2–3 sentence strategy explanation mentioning why these funds were chosen based on cost and quality.",
  "selectionCriteria": {
    "expenseRatioPriority": "Funds with expense ratio below 0.10% were preferred to maximize net returns",
    "trackingErrorPriority": "Index funds with tracking error below 0.05% were preferred for accurate benchmark replication",
    "aumPriority": "Funds with AUM above ₹10,000 Cr were preferred for liquidity and stability"
  }
}`;

    for (let step = 0; step < 10; step++) {
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