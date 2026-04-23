import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { runFundRecommendationAgent } from "../agent/fundAgent";

const fund = new Hono();

const preferenceSchema = z.object({
    riskAppetite: z.enum(["low", "medium", "high"]),
    investmentGoal: z.string().min(2),
    horizon: z.string().min(1),
    monthlyAmount: z.number().optional(),
    preferIndex: z.boolean().optional(),
    freeText: z.string().optional(),
});

fund.post(
    "/recommend",
    zValidator("json", preferenceSchema),
    async (c) => {
        try {
            const preference = c.req.valid("json");
            const result = await runFundRecommendationAgent(preference);
            return c.json({ success: true, data: result });
        } catch (err: any) {
            console.error(err);
            return c.json({ success: false, error: err.message }, 500);
        }
    }
);

export default fund;